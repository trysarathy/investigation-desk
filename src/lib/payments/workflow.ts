// Inbox workflow: keep the inbox in step with matching, apply people's actions, resolve reviews,
// and change route settings. Every change lands in the audit log. Stores and the re-match step are
// passed in, so the same code runs on files in the app and in memory in tests.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkActor, type AuditDraft, type AuditLog } from "./audit";
import { computeExceptions, recordsOf, type DepositCaseRow } from "./exceptions";
import { applyAction, candidatesFrom, emptyInbox, syncInbox, type InboxAction, type InboxData } from "./inbox";
import { recordKeyOf, resolvePaymentRef } from "./match";
import { checkRoutes, type RouteSetting } from "./settings";
import type { PaymentsData, PaymentsStore } from "./store";
import type { ReviewDecision } from "./types";

export interface InboxStore {
  load(): Promise<InboxData>;
  save(d: InboxData): Promise<void>;
}

export class MemoryInboxStore implements InboxStore {
  private data = emptyInbox();
  async load() { return structuredClone(this.data); }
  async save(d: InboxData) { this.data = structuredClone(d); }
}

export class FileInboxStore implements InboxStore {
  constructor(private readonly file: string) {}
  async load(): Promise<InboxData> {
    try { return { ...emptyInbox(), ...JSON.parse(await readFile(this.file, "utf8")) }; } catch { return emptyInbox(); }
  }
  async save(d: InboxData) {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(d));
    await rename(`${this.file}.tmp`, this.file);
  }
}

export interface Stores {
  payments: PaymentsStore;
  inbox: InboxStore;
  audit: AuditLog;
}

export interface Who { actor: string; ip?: string }

/** Recompute exceptions from the latest match and bring the inbox up to date. */
export async function syncAll(stores: Stores, opts: { now: Date; cases?: DepositCaseRow[] }): Promise<InboxData> {
  const data = await stores.payments.load();
  const inbox = await stores.inbox.load();
  const exceptions = computeExceptions({ data, settings: inbox.settings, now: opts.now, cases: opts.cases });
  const result = data.match?.result;
  const run = candidatesFrom(exceptions, result?.reviews ?? []);
  const paymentOf = (id: string) => (result ? resolvePaymentRef(result, id).payment?.paymentId : undefined) ?? id;
  const synced = syncInbox(inbox, run, { now: opts.now, decisions: data.decisions ?? [], paymentOf });
  await stores.inbox.save(synced.inbox);
  await stores.audit.append(synced.audit);
  return synced.inbox;
}

export async function act(stores: Stores, itemId: string, action: InboxAction, who: Who, now: Date): Promise<{ error?: string }> {
  const actorErr = checkActor(who.actor);
  if (actorErr) return { error: actorErr };
  const res = applyAction(await stores.inbox.load(), itemId, action, who, now);
  if (res.error || !res.inbox) return { error: res.error };
  await stores.inbox.save(res.inbox);
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
  const data = await stores.payments.load();
  const result = data.match?.result;
  if (!result) return { error: "Nothing has been matched yet." };
  const found = resolvePaymentRef(result, req.reviewId);
  const review = found.review;
  if (!review) return { error: `Review ${req.reviewId} is not open any more.` };
  const candidate = review.candidates.find((c) => c.recordId === req.recordId);
  if (!candidate) return { error: `${req.recordId} is not a candidate in review ${review.reviewId}.` };
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
  const next = await rematch({ ...data, decisions: [...(data.decisions ?? []), decision] });
  await stores.payments.save(next);

  // The decision goes on the review's history whatever happens next; the sync then closes the
  // review if the decision settled it, or leaves it open if candidates remain.
  const inbox = await stores.inbox.load();
  const item = inbox.items[review.reviewId];
  if (item) {
    item.history.push({ at: decision.at, by: who.actor, action: "decision", why: `${req.action === "confirm" ? "Confirmed" : "Rejected"} ${record.recordId}: ${decision.why}` });
    await stores.inbox.save(inbox);
  }
  const entry: AuditDraft = { at: decision.at, actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: `review.${req.action}`, subject: review.reviewId,
    detail: `${req.action === "confirm" ? "Confirmed" : "Rejected"} ${record.recordId} for the ${review.leg} leg of ${payment.paymentId} (${decision.decisionId}): ${decision.why}`,
    after: decision };
  await stores.audit.append([entry]);
  await syncAll(stores, { now, cases });
  return { decision };
}

export async function saveRoutes(stores: Stores, routes: RouteSetting[], who: Who, now: Date, cases?: DepositCaseRow[]): Promise<{ errors: string[] }> {
  const actorErr = checkActor(who.actor);
  if (actorErr) return { errors: [actorErr] };
  const errors = checkRoutes(routes);
  if (errors.length) return { errors };
  const inbox = await stores.inbox.load();
  const before = inbox.settings;
  inbox.settings = { version: before.version + 1, updatedAt: now.toISOString(), updatedBy: who.actor, routes };
  await stores.inbox.save(inbox);
  await stores.audit.append([{ at: now.toISOString(), actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: "settings.routes", subject: `routes v${inbox.settings.version}`, detail: `Routes changed (v${before.version} → v${inbox.settings.version})`,
    before: before.routes, after: routes }]);
  await syncAll(stores, { now, cases });
  return { errors: [] };
}
