// Payment records, their imports and the saved column mappings. Until the database lands this is
// one JSON file under the git-ignored .data/ directory (like Files A and B); tests use memory.
// Imports append: providers send reports per period, and overlapping exports are normal. A row
// already held (same identifier, same content) adds a source to that record: a duplicate
// record, not a second payment.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RowError } from "../csv/files";
import { fileLockKey, LockedStore, writeAtomic, type Store } from "../lock";

export { LockedStore, type Store } from "../lock";
import type { LedgerRow } from "../types";
import { checkMapping, importWithMapping, type ColumnMapping } from "./mapping";
import { PRESET_MAPPINGS } from "./presets";
import type {
  BankRecord, ChainLookupSummary, ChainTransferRecord, ImportKind, InstructionRecord, LedgerEntryRecord, MatchResult,
  PaymentRecord, PaymentRedirect, ProviderRecord, ReviewDecision,
} from "./types";

export interface ImportLog {
  importId: string;
  kind: ImportKind;
  fileName: string;
  sha256: string;
  mappingId: string;
  mappingVersion: number;
  at: string;
  outcome: "imported" | "no_change" | "rejected";
  acceptedRows: number;
  rejectedRows: number;
  /** Accepted rows that were new records. */
  newRecords: number;
  /** Accepted rows already held (same identifier and content): kept as an extra source. */
  duplicateRows: number;
  rowErrors: RowError[];
  fileErrors: string[];
  notes: string[];
  ignoredColumns: string[];
}

export interface PaymentsData {
  /** Saved versions only; the presets are version 1 of their mapping IDs. */
  mappings: ColumnMapping[];
  imports: ImportLog[];
  records: { instruction: InstructionRecord[]; provider: ProviderRecord[]; bank: BankRecord[]; ledger: LedgerEntryRecord[] };
  chain: { transfers: ChainTransferRecord[]; lookups: ChainLookupSummary[] };
  /** The latest match, and the File B rows it read as deposit-ledger entries (not stored elsewhere). */
  match?: { result: MatchResult; at: string; depositLedger?: LedgerEntryRecord[] };
  /** Payment IDs assigned so far, by anchor key. They never change once assigned. */
  paymentIds?: Record<string, string>;
  /** Where each retired payment ID leads. */
  paymentRedirects?: Record<string, PaymentRedirect>;
  /** Review resolutions made in the app, applied on every run. Kept across Clear records. */
  decisions?: ReviewDecision[];
  /** Bumped on every saved change, so a match computed on an older snapshot is never saved over newer records. */
  rev?: number;
}

/** Remove every imported record, import log and match result. Mappings, assigned payment IDs, redirects and review decisions stay. */
export function clearRecords(d: PaymentsData): PaymentsData {
  return { ...emptyPayments(), mappings: d.mappings, paymentIds: d.paymentIds, paymentRedirects: d.paymentRedirects, decisions: d.decisions };
}

export const emptyPayments = (): PaymentsData => ({
  mappings: [], imports: [], records: { instruction: [], provider: [], bank: [], ledger: [] }, chain: { transfers: [], lookups: [] },
});

export type PaymentsStore = Store<PaymentsData>;

export class MemoryPaymentsStore extends LockedStore<PaymentsData> {
  protected readonly lockKey = `memory:${randomUUID()}`;
  private data = emptyPayments();
  async load() { return structuredClone(this.data); }
  protected async write(d: PaymentsData) { this.data = structuredClone(d); }
  protected revOf(d: PaymentsData) { return d.rev ?? 0; }
  protected withRev(d: PaymentsData, rev: number) { return { ...d, rev }; }
}

export class FilePaymentsStore extends LockedStore<PaymentsData> {
  protected readonly lockKey: string;
  constructor(private readonly file: string) { super(); this.lockKey = fileLockKey(file); }
  protected revOf(d: PaymentsData) { return d.rev ?? 0; }
  protected withRev(d: PaymentsData, rev: number) { return { ...d, rev }; }
  async load(): Promise<PaymentsData> {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8")) as Partial<PaymentsData>;
      const empty = emptyPayments();
      // Files written before a record kind existed lack its bucket.
      return { ...empty, ...saved, records: { ...empty.records, ...saved.records } } as PaymentsData;
    } catch {
      return emptyPayments();
    }
  }
  protected write(d: PaymentsData) { return writeAtomic(this.file, JSON.stringify(d)); }
}

// ---- Mappings ----

/** Every version of every mapping, presets included, oldest version first. */
export function allMappings(data: PaymentsData): ColumnMapping[] {
  return [...PRESET_MAPPINGS, ...data.mappings].sort((a, b) => (a.mappingId < b.mappingId ? -1 : a.mappingId > b.mappingId ? 1 : a.version - b.version));
}

export function findMapping(data: PaymentsData, mappingId: string, version?: number): ColumnMapping | undefined {
  const versions = allMappings(data).filter((m) => m.mappingId === mappingId);
  return version === undefined ? versions[versions.length - 1] : versions.find((m) => m.version === version);
}

/** Key order doesn't make two mappings different. */
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
const comparable = (m: ColumnMapping) => JSON.stringify(stable({ ...m, version: 0, createdAt: "" }));

/**
 * Save a mapping as the next version of its mapping ID (version 1 for a new ID). Identical to the
 * latest version: nothing is saved. Earlier versions are never changed, so every import still
 * names the exact mapping that read it.
 */
export async function saveMappingVersion(store: PaymentsStore, m: Omit<ColumnMapping, "version" | "createdAt">, now: Date):
  Promise<{ mapping?: ColumnMapping; errors: string[]; unchanged?: boolean }> {
  return store.update((data) => {
    const latest = findMapping(data, m.mappingId);
    if (latest && latest.kind !== m.kind) return [undefined, { errors: [`Mapping ${m.mappingId} reads ${latest.kind} files; it can't change kind.`] }];
    const next: ColumnMapping = { ...m, version: (latest?.version ?? 0) + 1, createdAt: now.toISOString() };
    const errors = checkMapping(next);
    if (errors.length) return [undefined, { errors }];
    if (latest && comparable(latest) === comparable(next)) return [undefined, { mapping: latest, errors: [], unchanged: true }];
    data.mappings.push(next);
    return [data, { mapping: next, errors: [] }];
  });
}

// ---- Imports ----

const SHOWN_ROW_ERRORS = 500;

export async function applyImport(store: PaymentsStore, kind: ImportKind, fileName: string, bytes: Uint8Array,
  mappingId: string, mappingVersion: number | undefined, now: Date): Promise<ImportLog> {
  // Inside the store's lock: the import ID and the merge see every import before this one.
  return store.update((data) => importInto(data, kind, fileName, bytes, mappingId, mappingVersion, now));
}

function importInto(data: PaymentsData, kind: ImportKind, fileName: string, bytes: Uint8Array,
  mappingId: string, mappingVersion: number | undefined, now: Date): [PaymentsData, ImportLog] {
  const mapping = findMapping(data, mappingId, mappingVersion);
  const importId = `IMP-${String(data.imports.length + 1).padStart(4, "0")}`;
  const base = { importId, kind, fileName, mappingId, mappingVersion: mapping?.version ?? mappingVersion ?? 0, at: now.toISOString(),
    newRecords: 0, duplicateRows: 0, notes: [] as string[], ignoredColumns: [] as string[], rowErrors: [] as RowError[] };
  const finish = (log: ImportLog): [PaymentsData, ImportLog] => { data.imports = [log, ...data.imports]; return [data, log]; };

  if (!mapping || mapping.kind !== kind) {
    return finish({ ...base, sha256: "", outcome: "rejected", acceptedRows: 0, rejectedRows: 0,
      fileErrors: [mapping ? `Mapping ${mappingId} reads ${mapping.kind} files, not ${kind} files.` : `No mapping ${mappingId}${mappingVersion ? ` version ${mappingVersion}` : ""}.`] });
  }
  const res = importWithMapping(bytes, mapping, { importId, fileName, now });
  const logBase = { ...base, sha256: res.sha256, notes: res.notes, ignoredColumns: res.ignoredColumns,
    rowErrors: res.rowErrors.slice(0, SHOWN_ROW_ERRORS), fileErrors: res.fileErrors };
  if (res.fileErrors.length) return finish({ ...logBase, outcome: "rejected", acceptedRows: 0, rejectedRows: res.rowErrors.length });
  // Same bytes again: nothing to do (spec 4: a same-SHA-256 re-upload is a no-op).
  const prior = data.imports.find((i) => i.kind === kind && i.sha256 === res.sha256 && i.outcome === "imported");
  if (prior) {
    return finish({ ...logBase, outcome: "no_change", acceptedRows: 0, rejectedRows: 0, rowErrors: [],
      notes: [`Identical to ${prior.fileName} (${prior.importId}); nothing imported.`] });
  }
  const bucket = data.records[kind] as PaymentRecord[];
  const { added, duplicates } = mergeRecords(bucket, res.rows);
  return finish({ ...logBase, outcome: "imported", acceptedRows: res.rows.length, rejectedRows: res.rowErrors.length,
    newRecords: added, duplicateRows: duplicates });
}

/** Add records in place. A record already held gains a source instead of a copy. */
export function mergeRecords(bucket: PaymentRecord[], incoming: PaymentRecord[]): { added: number; duplicates: number } {
  const byId = new Map(bucket.map((r) => [r.recordId, r]));
  let added = 0;
  let duplicates = 0;
  for (const r of incoming) {
    const held = byId.get(r.recordId);
    if (held) { held.sources.push(...r.sources); duplicates++; }
    else { bucket.push(r); byId.set(r.recordId, r); added++; }
  }
  return { added, duplicates };
}

/** File B rows as ledger entries, so a payment's ledger leg can join on its on-chain transfer. */
/** File B rows as deposit-ledger entries. Its statuses are the spec's fixed set, mapped here. */
const FILE_B_MEANING = { CREDITED: "posted", PENDING: "pending", HELD: "pending", REVIEW: "pending", REJECTED: "failed" } as const;

export function ledgerFromFileB(rows: LedgerRow[], fileSha256: string, observedTime: string): LedgerEntryRecord[] {
  return rows.map((r) => ({
    recordId: `ldg:${r.depositId}`, kind: "ledger", ledger: "deposit", entryId: r.depositId, chain: r.chain,
    ...(r.txHash ? { txHash: r.txHash.toLowerCase().replace(/^0x/, "") } : {}),
    ...(r.transferIndex !== undefined ? { transferIndex: r.transferIndex } : {}),
    amount: r.amount, currency: r.token, status: r.status, statusMeaning: FILE_B_MEANING[r.status], eventTime: r.creditedAt, observedTime,
    toAddress: r.toAddress,
    identifiers: [
      { role: "ledger_entry_id", sourceField: "deposit_id", value: r.depositId },
      ...(r.txHash ? [{ role: "tx_hash", sourceField: "tx_hash", value: r.txHash }] : []),
      ...(r.transferIndex !== undefined ? [{ role: "transfer_index", sourceField: "transfer_index", value: String(r.transferIndex) }] : []),
    ],
    sources: [{ kind: "deposit_ledger", line: r.row, fileSha256 }],
    original: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])),
  }));
}
