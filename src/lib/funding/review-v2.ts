// Frozen M2 policy: retained solely to verify existing decision snapshots.
// New commands must use review.ts; changing this file would rewrite historical checks.
import { createHash } from "node:crypto";
import { add, sub, sum } from "../payments/money";
import {
  compare,
  instant,
  visible,
  type FundingData,
  type User,
} from "./model";
export interface Check {
  code: "invoice" | "limit" | "overdue" | "terms" | "cash";
  status: "pass" | "fail" | "needs_review";
  reason: string;
  sources: string[];
}
export interface Review {
  checks: Check[];
  free_cash: string | null;
  reserved_cash: string;
  exposure: string;
}
export interface FundingEvent {
  id: string;
  action: "users" | "prepare" | "approve" | "decline";
  at: string;
  import_count: number;
  base_revision: number;
  actor_id: string;
  advance_id: string;
  reason: string;
  users: User[];
  review: Review | null;
}
const normalize = (v: string) =>
  v.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
export function reviewAdvance(
  data: FundingData,
  id: string,
  at: string,
): Review {
  instant(at);
  if (data.events.some((e) => instant(e.at) > instant(at)))
    throw Error("Use an earlier event replay for a historical review.");
  const advance = data.advances.find((a) => a.id === id && visible(a, at));
  if (!advance) throw Error("This advance was not known at the review time.");
  const customer = data.customers.find(
    (c) => c.id === advance.customer_id && visible(c, at),
  );
  const active = data.advances.filter((a) => visible(a, at));
  const paid = (id: string) =>
    data.payouts.filter((p) => p.advance_id === id && visible(p, at));
  const committed = active.filter(
    (a) => a.state === "approved" || paid(a.id).length > 0,
  );
  const exposureOf = (id: string) => {
    const a = active.find((a) => a.id === id)!;
    const payouts = sum(paid(id).map((p) => p.amount));
    return compare(payouts, a.amount) > 0 ? payouts : a.amount;
  };
  const exposure = sum(
    committed
      .filter(
        (a) =>
          a.customer_id === advance.customer_id &&
          a.currency === advance.currency &&
          a.id !== id,
      )
      .map((a) => exposureOf(a.id)),
  );
  const reserved = committed.filter(
    (a) =>
      a.account === advance.account &&
      a.currency === advance.currency &&
      a.id !== id &&
      a.state === "approved",
  );
  const reservedCash = sum(
    reserved.map((a) => {
      const remaining = sub(a.amount, sum(paid(a.id).map((p) => p.amount)));
      return compare(remaining, "0") > 0 ? remaining : "0";
    }),
  );
  const duplicate = active.some(
    (a) =>
      a.id !== id &&
      a.customer_id === advance.customer_id &&
      normalize(a.invoice_ref) === normalize(advance.invoice_ref) &&
      (a.state !== "declined" || paid(a.id).length),
  );
  const checks: Check[] = [];
  const push = (
    code: Check["code"],
    status: Check["status"],
    reason: string,
    sources: string[],
  ) => checks.push({ code, status, reason, sources });
  push(
    "invoice",
    !advance.invoice_ref
      ? "needs_review"
      : duplicate || paid(id).length > 0
        ? "fail"
        : "pass",
    !advance.invoice_ref
      ? "Add the supplier invoice reference."
      : duplicate
        ? "Another advance uses this customer and invoice reference."
        : paid(id).length
          ? "Supplier payment is already recorded; do not fund it again."
          : "Invoice reference is present and unique in the supplied records.",
    [advance.source],
  );
  push(
    "limit",
    !customer
      ? "needs_review"
      : compare(add(exposure, advance.amount), customer.credit_limit) > 0
        ? "fail"
        : "pass",
    !customer
      ? "Customer limit evidence was not known then."
      : `Open exposure ${exposure}; proposed ${advance.amount}; limit ${customer.credit_limit} ${advance.currency}. Receipts are not netted before matching.`,
    customer ? [customer.source, ...committed.map((a) => a.source)] : [],
  );
  const overdue = committed.filter(
    (a) =>
      a.customer_id === advance.customer_id &&
      a.id !== id &&
      instant(a.due_at) <= instant(at),
  );
  push(
    "overdue",
    overdue.length ? "fail" : "pass",
    overdue.length
      ? `${overdue.length} earlier advance(s) are due and have not been matched to repayment.`
      : "No earlier due advance appears in the supplied records.",
    overdue.map((a) => a.source),
  );
  push(
    "terms",
    !customer || !customer.terms
      ? "needs_review"
      : customer.status !== "active"
        ? "fail"
        : "pass",
    !customer || !customer.terms
      ? "Obtain the agreed customer terms."
      : customer.status !== "active"
        ? "The customer is suspended."
        : "Agreed terms are on file and the customer is active.",
    customer ? [customer.source] : [],
  );
  const cash = data.cash.filter(
    (c) =>
      c.account === advance.account &&
      c.currency === advance.currency &&
      visible(c, at),
  );
  const latest = [...cash].sort(
    (a, b) => instant(b.effective_at) - instant(a.effective_at),
  )[0];
  const snapshot = latest
    ? cash.filter((c) => c.snapshot_id === latest.snapshot_id)
    : [];
  const classes = [
    "free",
    "safeguarded customer money",
    "pending payouts",
    "buffer",
  ];
  const tiedSnapshots = new Set(
    cash
      .filter((c) => c.effective_at === latest?.effective_at)
      .map((c) => c.snapshot_id),
  );
  const consistent =
    latest &&
    tiedSnapshots.size === 1 &&
    snapshot.length === 4 &&
    classes.every(
      (k) => snapshot.filter((c) => c.classification === k).length === 1,
    ) &&
    snapshot.every(
      (c) =>
        c.balance === latest.balance &&
        c.effective_at === latest.effective_at &&
        c.known_at === latest.known_at,
    ) &&
    compare(sum(snapshot.map((c) => c.amount)), latest.balance) === 0;
  const stale =
    latest && instant(at) - instant(latest.effective_at) > 24 * 60 * 60 * 1000;
  let free: string | null = null;
  const spentSinceSnapshot = latest
    ? sum(
        data.payouts
          .filter(
            (p) =>
              p.account === advance.account &&
              p.currency === advance.currency &&
              visible(p, at) &&
              instant(p.effective_at) >= instant(latest.effective_at),
          )
          .map((p) => p.amount),
      )
    : "0";
  if (consistent && !stale)
    free = sub(
      sub(
        sub(
          latest.balance,
          sum(
            snapshot
              .filter((c) => c.classification !== "free")
              .map((c) => c.amount),
          ),
        ),
        reservedCash,
      ),
      spentSinceSnapshot,
    );
  push(
    "cash",
    free === null
      ? "needs_review"
      : compare(free, advance.amount) < 0
        ? "fail"
        : "pass",
    free === null
      ? "Supply one complete, consistent cash snapshot no older than 24 hours."
      : `Free cash after local reservations: ${free} ${advance.currency}. Payouts after the snapshot: ${spentSinceSnapshot}. Pending cash and local reservations are deducted conservatively; confirm classifications with your counsel.`,
    snapshot.map((c) => c.source),
  );
  return { checks, free_cash: free, reserved_cash: reservedCash, exposure };
}
export function applyFundingEvent(
  data: FundingData,
  input: Omit<FundingEvent, "id" | "review">,
): FundingData {
  if (!input || typeof input !== "object" || !Array.isArray(input.users))
    throw Error("Invalid workflow event.");
  for (const key of ["at", "actor_id", "advance_id", "reason"] as const)
    if (
      typeof input[key] !== "string" ||
      input[key].length > 1000 ||
      /[\u0000-\u001f]/.test(input[key])
    )
      throw Error("Use plain text for workflow fields.");
  for (const user of input.users) {
    if (
      !user ||
      Object.keys(user).sort().join(",") !== "id,name,role" ||
      [user.id, user.name, user.role].some(
        (v) =>
          typeof v !== "string" ||
          !v.trim() ||
          v.length > 200 ||
          /[\u0000-\u001f]/.test(v),
      )
    )
      throw Error("Use a valid deployment user.");
  }
  if (
    !Number.isSafeInteger(input.import_count) ||
    !Number.isSafeInteger(input.base_revision) ||
    input.import_count < 0 ||
    input.base_revision < 0
  )
    throw Error("Invalid workflow revision.");
  instant(input.at);
  if (!["users", "prepare", "approve", "decline"].includes(input.action))
    throw Error("Choose a supported workflow action.");
  if (
    input.import_count !== data.imports.length ||
    input.base_revision !== data.revision
  )
    throw Error("Records changed. Reload the advance before deciding.");
  if (data.events.some((e) => instant(e.at) > instant(input.at)))
    throw Error("Workflow events cannot be backdated.");
  const next = structuredClone(data);
  let review: Review | null = null;
  if (input.action === "users") {
    if (
      data.events.length ||
      data.users.length ||
      !input.users.length ||
      new Set(input.users.map((u) => u.id)).size !== input.users.length ||
      input.users.some(
        (u) =>
          !u.id ||
          !u.name ||
          !["operator", "approver", "viewer"].includes(u.role),
      )
    )
      throw Error(
        "Initialize one valid deployment roster before workflow events.",
      );
    next.users = structuredClone(input.users);
  } else {
    if (input.users.length)
      throw Error("A workflow action cannot replace the deployment roster.");
    const actor = data.users.find((u) => u.id === input.actor_id);
    const advance = next.advances.find((a) => a.id === input.advance_id);
    if (!actor || !advance) throw Error("Choose a known user and advance.");
    review = reviewAdvance(data, advance.id, input.at);
    if (input.action === "prepare") {
      if (actor.role !== "operator" || advance.state !== "proposed")
        throw Error("Only an operator can prepare a proposed advance.");
      advance.state = "prepared";
    } else {
      const preparation = [...data.events]
        .reverse()
        .find((e) => e.action === "prepare" && e.advance_id === advance.id);
      if (
        actor.role !== "approver" ||
        !preparation ||
        preparation.actor_id === actor.id ||
        advance.state !== "prepared"
      )
        throw Error(
          "A different treasury approver must decide a prepared advance.",
        );
      if (!input.reason.trim() || input.reason.length > 1000)
        throw Error("Record a short reason for the decision.");
      if (
        input.action === "approve" &&
        review.checks.some((c) => c.status !== "pass")
      )
        throw Error("Resolve every failed or uncertain check before approval.");
      advance.state = input.action === "approve" ? "approved" : "declined";
      next.decisions.push({
        id: `decision-${data.events.length}`,
        advance_id: advance.id,
        actor_id: actor.id,
        outcome: input.action,
        reason: input.reason,
        prepared_by: preparation.actor_id,
        revision: input.base_revision,
        effective_at: input.at,
        known_at: input.at,
        source: `event-${data.events.length}`,
      });
    }
  }
  const id = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  if (input.action === "approve" || input.action === "decline")
    next.decisions[next.decisions.length - 1].source = id;
  next.events.push({ ...structuredClone(input), id, review });
  return next;
}
