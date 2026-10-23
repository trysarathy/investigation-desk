// The exception inbox (spec 23 Oct): exceptions and matching reviews, filled automatically from
// every matching run, each with an owner, status, follow-up date, notes and full history.
// Pure: sync and actions take the inbox and return the new inbox plus audit entries to append.
//
// Status: open, awaiting provider, under review, closed, reopened.
//   - New exceptions and reviews open by themselves. One whose condition is gone after a run is
//     closed by the system ("resolved" for a review a person decided; "condition no longer present"
//     otherwise). History is never removed.
//   - A closed item whose evidence changes reopens.
//   - A newly arrived contradiction reopens the exceptions a person closed on the same payment.

import type { Confidence } from "../types";
// Type-only from audit.ts (Node file APIs): the inbox screen imports this module in the browser.
import type { AuditDraft } from "./audit";
import type { ExceptionEvidence, ExceptionSubject, PaymentException } from "./exceptions";
import { DEFAULT_SETTINGS, type ExceptionSettings } from "./settings";
import type { PaymentRedirect, ReviewDecision, ReviewItem } from "./types";

export type InboxStatus = "open" | "awaiting_provider" | "under_review" | "closed" | "reopened";
export const INBOX_STATUSES: InboxStatus[] = ["open", "awaiting_provider", "under_review", "closed", "reopened"];
export const STATUS_LABELS: Record<InboxStatus, string> = {
  open: "Open", awaiting_provider: "Awaiting provider", under_review: "Under review", closed: "Closed", reopened: "Reopened",
};

export interface HistoryEntry {
  at: string;
  by: string;
  action: "opened" | "status" | "owner" | "follow_up" | "note" | "reopened" | "closed_by_system" | "resolved" | "evidence_changed" | "decision"
    | "moved" | "held";
  from?: string;
  to?: string;
  why?: string;
}

export interface InboxItem {
  /** The exception ID, or the review ID for a matching review. */
  itemId: string;
  kind: "exception" | "review";
  family: "payment" | "deposit" | "review";
  code: string;
  subject: ExceptionSubject;
  status: InboxStatus;
  owner?: string;
  /** YYYY-MM-DD. */
  followUp?: string;
  notes: { at: string; by: string; text: string }[];
  history: HistoryEntry[];
  firstSeen: string;
  lastSeen: string;
  /** Still produced by the latest run. */
  current: boolean;
  fingerprint: string;
  /** The latest computed content. */
  title: string;
  confidence?: Confidence;
  evidence: ExceptionEvidence[];
  nextStep: string;
  sample?: boolean;
  /** Its payment merged into another: the item continues under this ID. */
  movedTo?: string;
}

export interface InboxData {
  items: Record<string, InboxItem>;
  settings: ExceptionSettings;
}

export const emptyInbox = (): InboxData => ({ items: {}, settings: structuredClone(DEFAULT_SETTINGS) });

/** What a run produced, as inbox candidates. */
export function candidatesFrom(exceptions: PaymentException[], reviews: ReviewItem[]): Omit<InboxItem, "status" | "notes" | "history" | "firstSeen" | "lastSeen" | "current">[] {
  return [
    ...exceptions.map((e) => ({
      itemId: e.exceptionId, kind: "exception" as const, family: e.family, code: e.code, subject: e.subject,
      fingerprint: e.fingerprint, title: e.title, confidence: e.confidence, evidence: e.evidence, nextStep: e.nextStep, sample: e.sample,
    })),
    ...reviews.map((r) => ({
      itemId: r.reviewId, kind: "review" as const, family: "review" as const, code: `review:${r.reason}`,
      subject: { kind: "payment" as const, paymentId: r.paymentId },
      fingerprint: `${r.reason} ${r.candidates.map((c) => c.recordId).sort().join(" ")}`,
      title: `Review (${r.leg}): ${r.message}`,
      evidence: r.candidates.map((c) => ({ label: "Candidate", value: c.recordId, recordId: c.recordId,
        ...(c.reasons.length ? { source: `rank ${c.score}: ${c.reasons.join(", ")}` } : {}) })),
      nextStep: "Confirm the right candidate or reject the wrong one. The decision is recorded with who, when and why.",
    })),
  ];
}

const SYSTEM = { actor: "system", actorKind: "system" as const };
const audit = (at: string, item: InboxItem, action: string, detail: string, extra: Partial<AuditDraft> = {}): AuditDraft =>
  ({ at, ...SYSTEM, action, subject: item.itemId, detail, ...extra });

/**
 * Bring the inbox up to date with one run. `paymentOf` resolves any payment ID (current or
 * retired) to the payment that carries it now, so subjects compare correctly after merges.
 */
export function syncInbox(inbox: InboxData, run: ReturnType<typeof candidatesFrom>, opts: {
  now: Date; decisions: ReviewDecision[]; paymentOf: (id: string) => string | undefined;
  /** Retired payment IDs and where they lead (the match result's redirects). */
  redirects?: Record<string, PaymentRedirect>;
}): { inbox: InboxData; audit: AuditDraft[] } {
  const at = opts.now.toISOString();
  const items = structuredClone(inbox.items);
  const log: AuditDraft[] = [];
  const seen = new Set<string>();
  const newContradictions: InboxItem[] = [];
  const paymentOf = (id: string) => opts.paymentOf(id) ?? id;
  const moveWhy = (from: string, to: string) => {
    const r = opts.redirects?.[from];
    return r?.reason === "held_in_review" ? `${from} is held in review ${r.to.reviewId} on ${to}` : `${from} merged into ${to}`;
  };

  for (const c of run) {
    seen.add(c.itemId);
    let prev = items[c.itemId];
    // An item of a payment that merged into this one carries over: status, owner, notes, history.
    const old = !prev ? carriedFrom(items, c, paymentOf) : undefined;
    if (old) {
      const why = `${moveWhy(old.subject.kind === "payment" ? old.subject.paymentId : "", paymentOf(c.subject.kind === "payment" ? c.subject.paymentId : ""))}; this item was ${old.itemId}.`;
      items[old.itemId] = { ...old, movedTo: c.itemId, history: [...old.history, { at, by: "system", action: "moved", to: c.itemId, why }] };
      prev = { ...old, itemId: c.itemId, subject: c.subject, movedTo: undefined, history: [...old.history, { at, by: "system", action: "moved", from: old.itemId, why }] };
      log.push({ at, ...SYSTEM, action: "inbox.moved", subject: c.itemId, detail: why, before: old.itemId, after: c.itemId });
    }
    if (!prev) {
      const item: InboxItem = { ...c, status: "open", notes: [], history: [{ at, by: "system", action: "opened", why: "Found by the matching run." }],
        firstSeen: at, lastSeen: at, current: true };
      items[c.itemId] = item;
      log.push(audit(at, item, "inbox.opened", item.title));
      if (c.code === "contradiction") newContradictions.push(item);
      continue;
    }
    const changed = prev.fingerprint !== c.fingerprint;
    const item: InboxItem = { ...prev, ...c, status: prev.status, notes: prev.notes, history: [...prev.history], firstSeen: prev.firstSeen, lastSeen: at, current: true };
    if (prev.status === "closed" && (changed || !prev.current)) {
      // Closed, and the condition is back or its evidence changed.
      const why = changed ? `New evidence: ${c.title}` : `The condition is present again: ${c.title}`;
      item.status = "reopened";
      item.history.push({ at, by: "system", action: "reopened", from: "closed", to: "reopened", why });
      log.push(audit(at, item, "inbox.reopened", why, { before: "closed", after: "reopened" }));
      if (c.code === "contradiction") newContradictions.push(item);
    } else if (changed) {
      item.history.push({ at, by: "system", action: "evidence_changed", why: c.title });
      log.push(audit(at, item, "inbox.evidence_changed", c.title));
    }
    items[c.itemId] = item;
  }

  // Gone this run: close what was open, saying why. Items reopened by a person while not current stay
  // as they are; items whose payment waits in a review are held, not closed, until it is decided.
  for (const item of Object.values(items)) {
    if (seen.has(item.itemId) || !item.current || item.movedTo) continue;
    const pid = item.subject.kind === "payment" ? item.subject.paymentId : undefined;
    const redirect = pid ? opts.redirects?.[pid] : undefined;
    if (pid && redirect?.reason === "held_in_review") {
      const why = moveWhy(pid, redirect.to.paymentId);
      if (item.history.at(-1)?.why !== why) {
        item.history.push({ at, by: "system", action: "held", why });
        log.push(audit(at, item, "inbox.held", why));
      }
      continue;
    }
    item.current = false;
    if (item.status === "closed") continue;
    const decision = item.kind === "review" ? [...opts.decisions].reverse().find((d) => d.reviewId === item.itemId) : undefined;
    const from = item.status;
    item.status = "closed";
    if (decision) {
      const why = `${decision.action === "confirm" ? "Confirmed" : "Rejected"} ${decision.recordId} (${decision.decisionId}) by ${decision.by}: ${decision.why}`;
      item.history.push({ at, by: "system", action: "resolved", from, to: "closed", why });
      log.push(audit(at, item, "inbox.resolved", why, { before: from, after: "closed" }));
    } else {
      const why = pid && redirect?.reason === "merged"
        ? `${pid} merged into ${redirect.to.paymentId}; the condition is not present there.`
        : "The condition is no longer present after the latest matching run.";
      item.history.push({ at, by: "system", action: "closed_by_system", from, to: "closed", why });
      log.push(audit(at, item, "inbox.closed_by_system", why, { before: from, after: "closed" }));
    }
  }

  // A later contradiction reopens the closed exceptions on its payment.
  for (const contra of newContradictions) {
    if (contra.subject.kind !== "payment") continue;
    const target = paymentOf(contra.subject.paymentId);
    for (const item of Object.values(items)) {
      if (item.itemId === contra.itemId || item.movedTo || item.kind !== "exception" || item.status !== "closed" || item.subject.kind !== "payment") continue;
      // Only what a person closed: that judgement is what a later contradiction can overturn. What the
      // system closed because its condition went away reopens by itself if the condition comes back.
      const closing = [...item.history].reverse().find((h) => h.to === "closed");
      if (!closing || closing.by === "system") continue;
      if (paymentOf(item.subject.paymentId) !== target) continue;
      const why = `Contradiction ${contra.itemId}: ${contra.title}`;
      item.status = "reopened";
      item.history.push({ at, by: "system", action: "reopened", from: "closed", to: "reopened", why });
      log.push(audit(at, item, "inbox.reopened", why, { before: "closed", after: "reopened" }));
    }
  }
  return { inbox: { ...inbox, items }, audit: log };
}

/** "EXC-<payment>-<rest>" or "REV-<payment>-<leg>": the payment part and the rest. */
const PAYMENT_SCOPED = /^(EXC|REV)-([0-9A-F]{10})-(.+)$/;

/** The item, of a payment that now resolves to this candidate's payment, that this candidate continues. */
function carriedFrom(items: Record<string, InboxItem>, c: ReturnType<typeof candidatesFrom>[number], paymentOf: (id: string) => string): InboxItem | undefined {
  const m = PAYMENT_SCOPED.exec(c.itemId);
  if (!m || c.subject.kind !== "payment") return undefined;
  const here = c.subject.paymentId;
  const target = paymentOf(here);
  return Object.values(items).find((i) => {
    if (i.movedTo || i.kind !== c.kind || i.subject.kind !== "payment" || i.subject.paymentId === here) return false;
    const n = PAYMENT_SCOPED.exec(i.itemId);
    return !!n && n[1] === m[1] && n[3] === m[3] && paymentOf(i.subject.paymentId) === target;
  });
}

/** Where an item ID leads now: itself, or the item it moved to when its payment merged. */
export function resolveItemId(inbox: InboxData, itemId: string): string | undefined {
  const seen = new Set<string>();
  let id = itemId;
  while (inbox.items[id]?.movedTo && !seen.has(id)) { seen.add(id); id = inbox.items[id].movedTo!; }
  return inbox.items[id] ? id : undefined;
}

/** Open contradictions on the same payment as this item (for the banner on every item of that payment). */
export function openContradictionsFor(inbox: InboxData, item: InboxItem, paymentOf: (id: string) => string | undefined): InboxItem[] {
  if (item.subject.kind !== "payment") return [];
  const target = paymentOf(item.subject.paymentId) ?? item.subject.paymentId;
  return Object.values(inbox.items).filter((i) => i.itemId !== item.itemId && !i.movedTo && i.code === "contradiction" &&
    i.status !== "closed" && i.subject.kind === "payment" && (paymentOf(i.subject.paymentId) ?? i.subject.paymentId) === target);
}

// ---- People's actions ----

export type InboxAction =
  | { kind: "status"; to: InboxStatus; why?: string }
  | { kind: "owner"; owner: string }
  | { kind: "follow_up"; date: string }
  | { kind: "note"; text: string };

/** Allowed moves. Closing or reopening needs a reason. */
export function checkAction(item: InboxItem, a: InboxAction): string | undefined {
  switch (a.kind) {
    case "status":
      if (!INBOX_STATUSES.includes(a.to)) return "Unknown status.";
      if (a.to === item.status) return `Already ${STATUS_LABELS[a.to].toLowerCase()}.`;
      if (a.to === "reopened" && item.status !== "closed") return "Only a closed item can be reopened.";
      if (item.status === "closed" && a.to !== "reopened") return "Reopen a closed item first.";
      if ((a.to === "closed" || a.to === "reopened") && !a.why?.trim()) return `Say why it is being ${a.to}.`;
      if (item.kind === "review" && a.to === "closed") return "Resolve a review by confirming or rejecting a candidate.";
      return undefined;
    case "owner":
      return a.owner.length > 60 ? "Owner name is longer than 60 characters." : /@/.test(a.owner) ? "Use a name, not an email address." : undefined;
    case "follow_up":
      return a.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(a.date) && !Number.isNaN(Date.parse(`${a.date}T00:00:00Z`)) ? undefined : "Follow-up must be a date (YYYY-MM-DD).";
    case "note":
      return !a.text.trim() ? "A note can't be empty." : a.text.length > 2000 ? "Note is longer than 2000 characters." : undefined;
  }
}

export function applyAction(inbox: InboxData, itemId: string, a: InboxAction, who: { actor: string; ip?: string }, now: Date):
  { inbox?: InboxData; audit: AuditDraft[]; error?: string } {
  const prev = inbox.items[itemId];
  if (!prev) return { audit: [], error: `No inbox item ${itemId}.` };
  const err = checkAction(prev, a);
  if (err) return { audit: [], error: err };
  const at = now.toISOString();
  const item: InboxItem = structuredClone(prev);
  const by = who.actor;
  const entry = (action: string, detail: string, before?: unknown, after?: unknown): AuditDraft =>
    ({ at, actor: by, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}), action, subject: itemId, detail, before, after });
  let log: AuditDraft;
  switch (a.kind) {
    case "status":
      item.status = a.to;
      item.history.push({ at, by, action: a.to === "reopened" ? "reopened" : "status", from: prev.status, to: a.to, why: a.why?.trim() || undefined });
      log = entry(`inbox.status`, a.why?.trim() || `${STATUS_LABELS[prev.status]} → ${STATUS_LABELS[a.to]}`, prev.status, a.to);
      break;
    case "owner":
      item.owner = a.owner.trim() || undefined;
      item.history.push({ at, by, action: "owner", from: prev.owner, to: item.owner });
      log = entry("inbox.owner", item.owner ? `Owner set to ${item.owner}` : "Owner cleared", prev.owner ?? null, item.owner ?? null);
      break;
    case "follow_up":
      item.followUp = a.date || undefined;
      item.history.push({ at, by, action: "follow_up", from: prev.followUp, to: item.followUp });
      log = entry("inbox.follow_up", item.followUp ? `Follow up on ${item.followUp}` : "Follow-up cleared", prev.followUp ?? null, item.followUp ?? null);
      break;
    case "note":
      item.notes.push({ at, by, text: a.text.trim() });
      item.history.push({ at, by, action: "note", why: a.text.trim() });
      log = entry("inbox.note", a.text.trim());
      break;
  }
  return { inbox: { ...inbox, items: { ...inbox.items, [itemId]: item } }, audit: [log] };
}
