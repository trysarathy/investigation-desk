// Payment records, their imports and the saved column mappings. Until the database lands this is
// one JSON file under the git-ignored .data/ directory (like Files A and B); tests use memory.
// Imports append: providers send reports per period, and overlapping exports are normal. A row
// already held (same identifier, same content) adds a source to that record: a duplicate
// record, not a second payment.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowError } from "../csv/files";
import type { LedgerRow } from "../types";
import { checkMapping, importWithMapping, type ColumnMapping } from "./mapping";
import { PRESET_MAPPINGS } from "./presets";
import type {
  BankRecord, ChainLookupSummary, ChainTransferRecord, ImportKind, InstructionRecord, LedgerEntryRecord, MatchResult,
  PaymentRecord, ProviderRecord,
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
  records: { instruction: InstructionRecord[]; provider: ProviderRecord[]; bank: BankRecord[] };
  chain: { transfers: ChainTransferRecord[]; lookups: ChainLookupSummary[] };
  match?: { result: MatchResult; at: string };
  /** Payment IDs assigned so far, by anchor key. They never change once assigned. */
  paymentIds?: Record<string, string>;
}

export const emptyPayments = (): PaymentsData => ({
  mappings: [], imports: [], records: { instruction: [], provider: [], bank: [] }, chain: { transfers: [], lookups: [] },
});

export interface PaymentsStore {
  load(): Promise<PaymentsData>;
  save(data: PaymentsData): Promise<void>;
}

export class MemoryPaymentsStore implements PaymentsStore {
  private data = emptyPayments();
  async load() { return structuredClone(this.data); }
  async save(d: PaymentsData) { this.data = structuredClone(d); }
}

export class FilePaymentsStore implements PaymentsStore {
  constructor(private readonly file: string) {}
  async load(): Promise<PaymentsData> {
    try { return { ...emptyPayments(), ...JSON.parse(await readFile(this.file, "utf8")) }; } catch { return emptyPayments(); }
  }
  async save(d: PaymentsData) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(d));
    await rename(tmp, this.file);
  }
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
  const data = await store.load();
  const latest = findMapping(data, m.mappingId);
  if (latest && latest.kind !== m.kind) return { errors: [`Mapping ${m.mappingId} reads ${latest.kind} files; it can't change kind.`] };
  const next: ColumnMapping = { ...m, version: (latest?.version ?? 0) + 1, createdAt: now.toISOString() };
  const errors = checkMapping(next);
  if (errors.length) return { errors };
  if (latest && comparable(latest) === comparable(next)) return { mapping: latest, errors: [], unchanged: true };
  data.mappings.push(next);
  await store.save(data);
  return { mapping: next, errors: [] };
}

// ---- Imports ----

const SHOWN_ROW_ERRORS = 500;

export async function applyImport(store: PaymentsStore, kind: ImportKind, fileName: string, bytes: Uint8Array,
  mappingId: string, mappingVersion: number | undefined, now: Date): Promise<ImportLog> {
  const data = await store.load();
  const mapping = findMapping(data, mappingId, mappingVersion);
  const importId = `IMP-${String(data.imports.length + 1).padStart(4, "0")}`;
  const base = { importId, kind, fileName, mappingId, mappingVersion: mapping?.version ?? mappingVersion ?? 0, at: now.toISOString(),
    newRecords: 0, duplicateRows: 0, notes: [] as string[], ignoredColumns: [] as string[], rowErrors: [] as RowError[] };
  const finish = async (log: ImportLog) => { data.imports = [log, ...data.imports]; await store.save(data); return log; };

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
export function ledgerFromFileB(rows: LedgerRow[], fileSha256: string, observedTime: string): LedgerEntryRecord[] {
  return rows.map((r) => ({
    recordId: `ldg:${r.depositId}`, kind: "ledger", entryId: r.depositId, chain: r.chain,
    ...(r.txHash ? { txHash: r.txHash.toLowerCase().replace(/^0x/, "") } : {}),
    ...(r.transferIndex !== undefined ? { transferIndex: r.transferIndex } : {}),
    amount: r.amount, status: r.status, eventTime: r.creditedAt, observedTime,
    identifiers: [
      { role: "ledger_entry_id", sourceField: "deposit_id", value: r.depositId },
      ...(r.txHash ? [{ role: "tx_hash", sourceField: "tx_hash", value: r.txHash }] : []),
      ...(r.transferIndex !== undefined ? [{ role: "transfer_index", sourceField: "transfer_index", value: String(r.transferIndex) }] : []),
    ],
    sources: [{ kind: "deposit_ledger", line: r.row, fileSha256 }],
    original: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])),
  }));
}
