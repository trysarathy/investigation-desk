import { add, sub, sum } from "../payments/money";
import { allocateCapped } from "../advances/allocation";
import {
  compare,
  instant,
  visible,
  type Currency,
  type FundingData,
} from "./model";
export interface Allocation {
  receipt_id: string;
  advance_id: string;
  amount: string;
  source: string;
}
export interface LedgerException {
  code: string;
  advance_id: string;
  receipt_id: string;
  amount: string;
  currency: Currency;
  reason: string;
  sources: string[];
}
export interface OwedRow {
  advance_id: string;
  customer_id: string;
  account: string;
  currency: Currency;
  invoice_ref: string;
  due_at: string;
  approved_amount: string;
  paid: string;
  repaid: string;
  written_off: string;
  outstanding: string;
  remaining_commitment: string;
  state: string;
  supplier_delivery: "not_observed" | "partly_paid" | "paid";
  sources: string[];
}
const normalize = (v: string) =>
  v.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
export function canonicalPayouts(data: FundingData, at: string) {
  const accepted: FundingData["payouts"] = [],
    duplicates: FundingData["payouts"] = [];
  const seen = new Set<string>();
  for (const payout of data.payouts.filter((p) => visible(p, at))) {
    const key = JSON.stringify([
      payout.account,
      payout.currency,
      payout.reference,
      add(payout.amount, "0"),
      payout.effective_at,
    ]);
    if (seen.has(key)) duplicates.push(payout);
    else {
      seen.add(key);
      accepted.push(payout);
    }
  }
  return { accepted, duplicates };
}
export function fundingLedger(data: FundingData, at: string) {
  instant(at);
  const advances = data.advances.filter((a) => visible(a, at));
  const { accepted: payouts, duplicates: duplicatePayouts } = canonicalPayouts(
    data,
    at,
  );
  const events = data.events.filter((e) => instant(e.at) <= instant(at));
  const allocations: Allocation[] = [];
  const exceptions: LedgerException[] = [];
  const rows: OwedRow[] = advances.map((a) => {
    const paid = sum(
      payouts.filter((p) => p.advance_id === a.id).map((p) => p.amount),
    );
    const approved = events.some(
      (e) => e.action === "approve" && e.advance_id === a.id,
    );
    return {
      advance_id: a.id,
      customer_id: a.customer_id,
      account: a.account,
      currency: a.currency,
      invoice_ref: a.invoice_ref,
      due_at: a.due_at,
      approved_amount: approved ? a.amount : "0",
      paid,
      repaid: "0",
      written_off: "0",
      outstanding: paid,
      remaining_commitment:
        approved && compare(a.amount, paid) > 0 ? sub(a.amount, paid) : "0",
      state: "proposed",
      supplier_delivery:
        compare(paid, "0") === 0
          ? "not_observed"
          : compare(paid, a.amount) < 0
            ? "partly_paid"
            : "paid",
      sources: [
        a.source,
        ...payouts.filter((p) => p.advance_id === a.id).map((p) => p.source),
      ],
    };
  });
  const flag = (
    code: string,
    reason: string,
    amount: string,
    currency: Currency,
    sources: string[],
    advance_id = "",
    receipt_id = "",
  ) =>
    exceptions.push({
      code,
      reason,
      amount,
      currency,
      sources,
      advance_id,
      receipt_id,
    });
  for (const payout of duplicatePayouts)
    flag(
      "duplicate_payout",
      "Possible duplicate payout; later evidence is quarantined rather than increasing principal.",
      payout.amount,
      payout.currency,
      [payout.source],
      payout.advance_id,
    );
  const fingerprint = (r: FundingData["receipts"][number]) =>
    JSON.stringify([
      r.account,
      r.currency,
      r.customer_id,
      r.reference,
      add(r.amount, "0"),
      r.effective_at,
    ]);
  const first = new Map<string, string>();
  for (const r of data.receipts.filter((r) => visible(r, at)))
    if (!first.has(fingerprint(r))) first.set(fingerprint(r), r.id);
  const receipts = data.receipts
    .filter((r) => visible(r, at))
    .sort(
      (a, b) =>
        instant(a.known_at) - instant(b.known_at) ||
        instant(a.effective_at) - instant(b.effective_at) ||
        a.id.localeCompare(b.id),
    );
  const writeoffs = events.filter((e) => e.action === "write_off");
  const timeline = [
    ...receipts.map((r) => {
      const batchIndex = data.imports.findIndex((b) =>
        r.source.startsWith(`${b.sha256}:`),
      );
      const prior = writeoffs
        .filter((e) => batchIndex >= e.import_count)
        .sort((a, b) => instant(b.at) - instant(a.at))[0];
      const forced = prior && instant(prior.at) >= instant(r.known_at);
      return {
        time: forced ? prior.at : r.known_at,
        order: forced ? 2 : 0,
        receipt: r,
        writeoff: null,
      };
    }),
    ...writeoffs.map((e) => ({
      time: e.at,
      order: 1,
      receipt: null,
      writeoff: e,
    })),
  ].sort(
    (a, b) =>
      instant(a.time) - instant(b.time) ||
      a.order - b.order ||
      (a.receipt?.id ?? a.writeoff!.id).localeCompare(
        b.receipt?.id ?? b.writeoff!.id,
      ),
  );
  for (const item of timeline) {
    if (item.writeoff) {
      const e = item.writeoff;
      const row = rows.find((r) => r.advance_id === e.advance_id);
      if (row) {
        row.written_off = add(row.written_off, e.amount!);
        row.outstanding = sub(row.outstanding, e.amount!);
        row.sources.push(e.id);
      }
      continue;
    }
    const r = item.receipt!;
    if (first.get(fingerprint(r)) !== r.id) {
      flag(
        "duplicate_receipt",
        "Possible duplicate bank event; held for review, not applied.",
        r.amount,
        r.currency,
        [r.source],
        "",
        r.id,
      );
      continue;
    }
    let candidates = rows.filter((row) => {
      const a = advances.find((a) => a.id === row.advance_id)!;
      return (
        visible(a, r.known_at) &&
        payouts.some(
          (p) =>
            p.advance_id === a.id &&
            instant(p.effective_at) <= instant(r.effective_at) &&
            instant(p.known_at) <= instant(r.known_at),
        )
      );
    });
    if (r.reference)
      candidates = candidates.filter(
        (a) =>
          normalize(a.advance_id) === normalize(r.reference) ||
          normalize(a.invoice_ref) === normalize(r.reference),
      );
    else
      candidates = candidates.filter(
        (a) =>
          !!r.customer_id &&
          a.customer_id === r.customer_id &&
          a.currency === r.currency &&
          a.account === r.account &&
          compare(
            sub(
              sub(
                sum(
                  payouts
                    .filter(
                      (p) =>
                        p.advance_id === a.advance_id &&
                        instant(p.effective_at) <= instant(r.effective_at) &&
                        instant(p.known_at) <= instant(r.known_at),
                    )
                    .map((p) => p.amount),
                ),
                a.repaid,
              ),
              a.written_off,
            ),
            r.amount,
          ) === 0,
      );
    if (candidates.length !== 1) {
      flag(
        "unmatched_receipt",
        r.reference
          ? "The reference has no unique eligible paid advance."
          : "Customer and exact outstanding amount do not identify one advance.",
        r.amount,
        r.currency,
        [r.source],
        "",
        r.id,
      );
      continue;
    }
    const row = candidates[0];
    if (
      row.currency !== r.currency ||
      row.account !== r.account ||
      (r.customer_id && row.customer_id !== r.customer_id)
    ) {
      flag(
        "unmatched_receipt",
        "Receipt customer, currency or provider account conflicts with the advance.",
        r.amount,
        r.currency,
        [r.source],
        row.advance_id,
        r.id,
      );
      continue;
    }
    const eligible = sum(
      payouts
        .filter(
          (p) =>
            p.advance_id === row.advance_id &&
            instant(p.effective_at) <= instant(r.effective_at) &&
            instant(p.known_at) <= instant(r.known_at),
        )
        .map((p) => p.amount),
    );
    const eligibleOwed = sub(sub(eligible, row.repaid), row.written_off);
    const { applied, excess } = allocateCapped(
      r.amount,
      compare(eligibleOwed, "0") > 0 ? eligibleOwed : "0",
    );
    if (compare(applied, "0") > 0) {
      allocations.push({
        receipt_id: r.id,
        advance_id: row.advance_id,
        amount: applied,
        source: r.source,
      });
      row.repaid = add(row.repaid, applied);
      row.outstanding = sub(row.outstanding, applied);
      row.sources.push(r.source);
    }
    if (compare(excess, "0") > 0)
      flag(
        "unmatched_receipt",
        "Receipt remains unapplied: no eligible outstanding principal is available. Review excess funds or recovery of written-off debt.",
        excess,
        r.currency,
        [r.source],
        row.advance_id,
        r.id,
      );
  }
  for (const batch of data.imports) {
    if (batch.kind === "receipts" && instant(batch.imported_at) <= instant(at))
      for (const id of batch.duplicates) {
        const r = data.receipts.find((r) => r.id === id && visible(r, at));
        if (r)
          flag(
            "duplicate_receipt",
            "Repeated receipt ID was not applied again.",
            r.amount,
            r.currency,
            [r.source],
            "",
            id,
          );
      }
  }
  for (const row of rows) {
    const positive = compare(row.outstanding, "0") > 0;
    const overdue = positive && instant(row.due_at) <= instant(at);
    const workflow = [...events]
      .reverse()
      .find(
        (e) =>
          e.advance_id === row.advance_id &&
          ["prepare", "approve", "decline"].includes(e.action),
      );
    row.state = overdue
      ? "overdue"
      : positive && compare(row.repaid, "0") > 0
        ? "partly_repaid"
        : !positive &&
            compare(row.remaining_commitment, "0") > 0 &&
            compare(row.paid, "0") > 0
          ? compare(row.written_off, "0") > 0
            ? "drawn_written_off_commitment_open"
            : "drawn_repaid_commitment_open"
          : !positive && compare(row.written_off, "0") > 0
            ? "written_off"
            : !positive && compare(row.paid, "0") > 0
              ? "repaid"
              : row.supplier_delivery === "paid"
                ? "supplier_paid"
                : row.supplier_delivery === "partly_paid"
                  ? "partly_disbursed"
                  : compare(row.approved_amount, "0") > 0
                    ? "approved"
                    : workflow?.action === "decline"
                      ? "declined"
                      : workflow?.action === "prepare"
                        ? "prepared"
                        : "proposed";
    if (overdue) {
      flag(
        "overdue",
        "Repayment is due and principal remains outstanding.",
        row.outstanding,
        row.currency,
        row.sources,
        row.advance_id,
      );
      flag(
        "supplier_paid_unrepaid_by_due",
        "A supplier payout is recorded and repayment remains due; this does not assert full supplier payment.",
        row.outstanding,
        row.currency,
        row.sources,
        row.advance_id,
      );
    }
    if (positive && compare(row.repaid, "0") > 0)
      flag(
        "partial_repayment",
        "Only part of the principal has been repaid.",
        row.outstanding,
        row.currency,
        row.sources,
        row.advance_id,
      );
    if (compare(row.paid, "0") > 0 && compare(row.approved_amount, "0") === 0)
      flag(
        "approval_evidence_missing",
        "Payout exists without a Clearline approval record; the debt still counts.",
        row.paid,
        row.currency,
        row.sources,
        row.advance_id,
      );
  }
  for (const c of data.customers.filter((c) => visible(c, at))) {
    const exposed = rows.filter(
      (r) => r.customer_id === c.id && r.currency === c.currency,
    );
    const total = sum(
      exposed.map((r) => add(sub(r.paid, r.repaid), r.remaining_commitment)),
    );
    if (compare(total, c.credit_limit) > 0)
      flag(
        "over_limit",
        "Paid exposure and undisbursed commitments exceed the recorded limit.",
        total,
        c.currency,
        [c.source, ...exposed.flatMap((r) => r.sources)],
      );
  }
  if (
    new Set(allocations.map((a) => a.receipt_id)).size !== allocations.length ||
    rows.some(
      (r) =>
        compare(r.outstanding, "0") < 0 ||
        compare(add(add(r.repaid, r.written_off), r.outstanding), r.paid) !== 0,
    )
  )
    throw Error(
      "Ledger evidence does not reconcile; review the records before using this result.",
    );
  const totals: Record<Currency, string> = { SGD: "0", USD: "0" };
  for (const row of rows)
    totals[row.currency] = add(totals[row.currency], row.outstanding);
  return { as_of: at, rows, allocations, exceptions, totals };
}
