// Inbox workflow: keep the inbox in step with matching, apply people's actions, resolve reviews,
// and change route settings. Every change lands in the audit log. Stores and the re-match step are
// passed in, so the same code runs on files in the app and in memory in tests.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { KEY_NOT_SET_RE } from "../chain/http";
import { fileLockKey, writeAtomic } from "../lock";
import { checkActor, type AuditDraft, type AuditLog } from "./audit";
import { computeExceptions, recordsOf, type DepositCaseRow } from "./exceptions";
import { applyAction, candidatesFrom, emptyInbox, syncInbox, type InboxAction, type InboxData } from "./inbox";
import { recordKeyOf, resolvePaymentRef } from "./match";
import { checkRoutes, type RouteSetting } from "./settings";
import { applyImport, clearRecords, LockedStore, type ImportLog, type PaymentsData, type PaymentsStore, type Store } from "./store";
import type { ImportKind, ReviewDecision } from "./types";

export type InboxStore = Store<InboxData>;

export class MemoryInboxStore extends LockedStore<InboxData> {
  protected readonly lockKey = `memory:${randomUUID()}`;
  private data = emptyInbox();
  async load() { return structuredClone(this.data); }
  protected async write(d: InboxData) { this.data = structuredClone(d); }
}

export class FileInboxStore extends LockedStore<InboxData> {
  protected readonly lockKey: string;
  constructor(private readonly file: string) { super(); this.lockKey = fileLockKey(file); }
  async load(): Promise<InboxData> {
    try { return { ...emptyInbox(), ...JSON.parse(await readFile(this.file, "utf8")) }; } catch { return emptyInbox(); }
  }
  protected write(d: InboxData) { return writeAtomic(this.file, JSON.stringify(d)); }
}

/**
 * Re-run matching without holding the payments lock through chain lookups: match a snapshot, then
 * save it only if nothing was saved meanwhile (same revision). If something was, match again on
 * the newer data; after three tries, match inside the lock so it always completes.
 */
export async function rematchInto(store: PaymentsStore, rematch: (data: PaymentsData) => Promise<PaymentsData>): Promise<PaymentsData> {
  for (let i = 0; i < 3; i++) {
    const snap = await store.load();
    const next = await rematch(snap);
    const saved = await store.update((cur) => ((cur.rev ?? 0) === (snap.rev ?? 0) ? [next, true] : [undefined, false]));
    if (saved) return store.load();
  }
  await store.update(async (cur) => [await rematch(cur), undefined]);
  return store.load();
}

export interface Stores {
  payments: PaymentsStore;
  inbox: InboxStore;
  audit: AuditLog;
}

export interface Who { actor: string; ip?: string }

/** Recompute exceptions from the latest match and bring the inbox up to date. */
// Lets the event loop turn between long synchronous steps, so other requests keep answering.
const breathe = () => new Promise<void>((r) => setImmediate(r));

export async function syncAll(stores: Stores, opts: { now: Date; cases?: DepositCaseRow[] }): Promise<InboxData> {
  const data = await stores.payments.load();
  await breathe();
  // Inside the inbox's lock, so a person's action in the meantime is kept. A sync from an older
  // match than the inbox already reflects (two syncs finishing out of order) changes nothing.
  const { inbox, audit } = await stores.inbox.update<{ inbox: InboxData; audit: AuditDraft[] }>(async (inbox) => {
    if ((data.rev ?? 0) < (inbox.syncedRev ?? 0)) return [undefined, { inbox, audit: [] }];
    await breathe();
    const exceptions = computeExceptions({ data, settings: inbox.settings, now: opts.now, cases: opts.cases });
    await breathe();
    const result = data.match?.result;
    const run = candidatesFrom(exceptions, result?.reviews ?? []);
    const paymentOf = (id: string) => (result ? resolvePaymentRef(result, id).payment?.paymentId : undefined) ?? id;
    const synced = syncInbox(inbox, run, { now: opts.now, decisions: data.decisions ?? [], paymentOf, redirects: result?.redirects });
    const next = { ...synced.inbox, syncedRev: data.rev ?? 0, syncedAt: opts.now.toISOString() };
    await breathe();
    return [next, { inbox: next, audit: synced.audit }];
  });
  await stores.audit.append(audit);
  return inbox;
}

export async function act(stores: Stores, itemId: string, action: InboxAction, who: Who, now: Date): Promise<{ error?: string }> {
  const actorErr = checkActor(who.actor);
  if (actorErr) return { error: actorErr };
  const res = await stores.inbox.update((inbox) => {
    const r = applyAction(inbox, itemId, action, who, now);
    return [r.error || !r.inbox ? undefined : r.inbox, r];
  });
  if (res.error || !res.inbox) return { error: res.error };
  await stores.audit.append(res.audit);
  return {};
}

/**
 * Resolve a review in the app: confirm the right candidate, or reject a wrong one. Recorded with
 * who, when and why, audit-logged, then matching re-runs with the decision applied and the inbox
 * follows. A review ID that has moved (its payment merged) is resolved through the redirects.
 */
export async function resolveReview(stores: Stores, req: { reviewId: string; recordId: string; action: "confirm" | "reject"; why: string },
  who: Who, now: Date, rematch: (data: PaymentsData) => Promise<PaymentsData>, cases?: DepositCaseRow[]): Promise<{ error?: string; decision?: ReviewDecision }> {
  const actorErr = checkActor(who.actor);
  if (actorErr) return { error: actorErr };
  if (req.action !== "confirm" && req.action !== "reject") return { error: "Choose confirm or reject." };
  if (!req.why?.trim()) return { error: "Say why: it is kept with the decision." };
  if (req.why.length > 1000) return { error: "Reason is longer than 1000 characters." };
  // Checked and recorded inside the payments lock, so two decisions never take the same number.
  type Found = { error: string } | { decision: ReviewDecision; review: { reviewId: string; leg: string }; paymentId: string; recordId: string };
  const found = await stores.payments.update<Found>((data) => {
    const result = data.match?.result;
    if (!result) return [undefined, { error: "Nothing has been matched yet." }];
    const review = resolvePaymentRef(result, req.reviewId).review;
    if (!review) return [undefined, { error: `Review ${req.reviewId} is not open any more.` }];
    const candidate = review.candidates.find((c) => c.recordId === req.recordId);
    if (!candidate) return [undefined, { error: `${req.recordId} is not a candidate in review ${review.reviewId}.` }];
    const payment = result.payments.find((p) => p.paymentId === review.paymentId)!;
    const record = recordsOf(data).get(req.recordId)!;
    const anchor = recordsOf(data).get(payment.anchor.recordId)!;
    const anchorKey = anchor.kind === "instruction" ? `instruction:${anchor.instructionId}`
      : anchor.kind === "provider" ? `provider:${anchor.provider}:${anchor.providerPaymentId}` : payment.anchor.recordId;
    const decision: ReviewDecision = {
      decisionId: `DEC-${String((data.decisions?.length ?? 0) + 1).padStart(4, "0")}`,
      reviewId: review.reviewId, anchorKey, paymentId: payment.paymentId, leg: review.leg, action: req.action,
      recordKey: recordKeyOf(record), recordId: record.recordId, by: who.actor, at: now.toISOString(), why: req.why.trim(),
    };
    return [{ ...data, decisions: [...(data.decisions ?? []), decision] }, { decision, review, paymentId: payment.paymentId, recordId: record.recordId }];
  });
  if ("error" in found) return { error: found.error };
  const { decision, review } = found;
  const record = { recordId: found.recordId };
  const payment = { paymentId: found.paymentId };
  await rematchInto(stores.payments, rematch);

  // The decision goes on the review's history whatever happens next; the sync then closes the
  // review if the decision settled it, or leaves it open if candidates remain.
  await stores.inbox.update((inbox) => {
    const item = inbox.items[review.reviewId];
    if (!item) return [undefined, undefined];
    item.history.push({ at: decision.at, by: who.actor, action: "decision", why: `${req.action === "confirm" ? "Confirmed" : "Rejected"} ${record.recordId}: ${decision.why}` });
    return [inbox, undefined];
  });
  const entry: AuditDraft = { at: decision.at, actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: `review.${req.action}`, subject: review.reviewId,
    detail: `${req.action === "confirm" ? "Confirmed" : "Rejected"} ${record.recordId} for the ${review.leg} leg of ${payment.paymentId} (${decision.decisionId}): ${decision.why}`,
    after: decision };
  await stores.audit.append([entry]);
  await syncAll(stores, { now, cases });
  return { decision };
}

const KEY_ENVS = ["TRONGRID_API_KEY", "ETHERSCAN_API_KEY"] as const;

/**
 * Said when the import returns, before the background match: hashes in this import that a chain
 * whose API key isn't set can't check. The import still succeeds; those legs show as unknown.
 */
export async function missingKeyWarnings(store: PaymentsStore, importId: string): Promise<string[]> {
  const missing = KEY_ENVS.filter((k) => !process.env[k]);
  if (!missing.length) return [];
  const data = await store.load();
  const hashes = new Set([...data.records.instruction, ...data.records.provider]
    .filter((r) => r.txHash && r.sources.some((x) => "importId" in x && x.importId === importId)).map((r) => r.txHash));
  if (!hashes.size) return [];
  return [`${hashes.size} transaction${hashes.size === 1 ? "" : "s"}: chain lookup unavailable: key not set (${missing.join(", ")}). ` +
    "Their on-chain leg shows as unknown until the key is set and matching re-runs."];
}

/** Hashes that couldn't be checked because an API key isn't set: the import still succeeds, with this warning. */
export function keyWarnings(data: PaymentsData): string[] {
  const keyless = data.chain.lookups.filter((l) => l.result !== "found" && l.result !== "not_found" && KEY_NOT_SET_RE.test(l.error ?? ""));
  if (!keyless.length) return [];
  const envs = [...new Set(keyless.flatMap((l) => /key not set \(([^)]+)\)/.exec(l.error!)?.[1].split(", ") ?? []))];
  return [`${keyless.length} transaction${keyless.length === 1 ? "" : "s"}: chain lookup unavailable: key not set (${envs.join(", ")}). ` +
    "Their on-chain leg shows as unknown until the key is set and matching re-runs."];
}

/**
 * Import one file with a mapping, re-match and refresh the inbox. Audit-logged with who did it.
 * With `deferMatch` it returns once the records are saved; the caller matches in the background.
 */
export async function importFile(stores: Stores, req: { kind: ImportKind; fileName: string; bytes: Uint8Array; mappingId: string; mappingVersion?: number },
  who: Who, now: Date, rematch: (data: PaymentsData) => Promise<PaymentsData>, cases?: DepositCaseRow[],
  opts: { deferMatch?: boolean } = {}): Promise<{ error?: string; log?: ImportLog; warnings?: string[] }> {
  const actorErr = checkActor(who.actor);
  if (actorErr) return { error: actorErr };
  const log = await applyImport(stores.payments, req.kind, req.fileName, req.bytes, req.mappingId, req.mappingVersion, now);
  await stores.audit.append([{ at: now.toISOString(), actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: "payments.import", subject: req.fileName,
    detail: `${req.kind} file ${req.fileName} (${log.mappingId} v${log.mappingVersion}): ${log.outcome}, ${log.acceptedRows} accepted, ${log.rejectedRows} rejected; SHA-256 ${log.sha256}`,
    after: { importId: log.importId, newRecords: log.newRecords, duplicateRows: log.duplicateRows, fileErrors: log.fileErrors } }]);
  if (log.outcome === "imported" && !opts.deferMatch) {
    const next = await rematchInto(stores.payments, rematch);
    await syncAll(stores, { now, cases });
    return { log, warnings: keyWarnings(next) };
  }
  return { log, warnings: [] };
}

/** Remove every imported record (mappings, payment IDs, redirects and decisions stay). Audit-logged. */
export async function clearAll(stores: Stores, who: Who, now: Date, cases?: DepositCaseRow[]): Promise<{ error?: string }> {
  const actorErr = checkActor(who.actor);
  if (actorErr) return { error: actorErr };
  const before = await stores.payments.update((d) => [clearRecords(d), d]);
  const counts = `${before.records.instruction.length} instructions, ${before.records.provider.length} provider, ${before.records.bank.length} bank, ${before.records.ledger.length} ledger records`;
  await stores.audit.append([{ at: now.toISOString(), actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: "payments.clear", subject: "payment records", detail: `Cleared ${counts}.` }]);
  await syncAll(stores, { now, cases });
  return {};
}

export async function saveRoutes(stores: Stores, routes: RouteSetting[], who: Who, now: Date, cases?: DepositCaseRow[]): Promise<{ errors: string[] }> {
  const actorErr = checkActor(who.actor);
  if (actorErr) return { errors: [actorErr] };
  const errors = checkRoutes(routes);
  if (errors.length) return { errors };
  const { before, inbox } = await stores.inbox.update((inbox) => {
    const before = inbox.settings;
    inbox.settings = { version: before.version + 1, updatedAt: now.toISOString(), updatedBy: who.actor, routes };
    return [inbox, { before, inbox }];
  });
  await stores.audit.append([{ at: now.toISOString(), actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: "settings.routes", subject: `routes v${inbox.settings.version}`, detail: `Routes changed (v${before.version} → v${inbox.settings.version})`,
    before: before.routes, after: routes }]);
  await syncAll(stores, { now, cases });
  return { errors: [] };
}
