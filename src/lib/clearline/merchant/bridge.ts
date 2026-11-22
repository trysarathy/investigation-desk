/**
 * rc6 step 5: grouping and the settlement bridge. For every settlement batch, the bridge runs from the merchant's
 * day (entity time zone) to the bank credit: prior-batch timing, held, next-day timing, fees, refunds. A batch is
 * tied only when gross − fees − refunds = net = the bank line, to the cent. Without a batch ID a grouping is only
 * proposed (status "proposed_needs_confirmation") and never closed by the engine.
 */
import { fmtFiat, localDate, sum } from "./amounts";
import { active } from "./rules";
import type { BankLine, DifferenceType, FiatCurrency, ReconcileInput, TimeZoneRef } from "./types";
import { IMPORTED_BANK_LINE_LABEL, TEST_MODE_LABEL, type TestModeLabel } from "./types";

export type BridgeLineKind = "merchant_day" | "timing_prior_batch" | "held_by_provider" | "timing_next_batch" | "unexplained" | "gross" | "provider_fee" | "refund_netted" | "net";

export interface BridgeLine {
  kind: BridgeLineKind;
  label: string;
  amountMinor: bigint;
  /** Provider payment ids (or refund ids) behind the line, so the UI can open each payment. */
  paymentIds: string[];
  orderIds: string[];
  differenceType?: DifferenceType;
  reason: string;
}

export interface BatchBridge {
  label: TestModeLabel;
  batchId: string;
  currency: FiatCurrency;
  merchantDay: string;
  merchantTimeZone: TimeZoneRef;
  providerDay: string;
  providerTimeZone: TimeZoneRef;
  lines: BridgeLine[];
  paymentIds: string[];
  bankLineId: string | null;
  bankLineSource: BankLine["source"] | null;
  bankLineLabel: typeof IMPORTED_BANK_LINE_LABEL | null;
  checks: { linesEqualGross: boolean; bridgeEqualsGross: boolean; grossLessFeesRefundsEqualsNet: boolean; netEqualsBankLine: boolean; noUnexplained: boolean };
  tied: boolean;
  settlementVerified: boolean;
}

export interface ProposedGrouping {
  id: string;
  status: "proposed_needs_confirmation";
  currency: FiatCurrency;
  providerDay: string;
  paymentIds: string[];
  orderIds: string[];
  totalMinor: bigint;
  candidateBankLineIds: string[];
  reason: string;
}

interface Payment { paymentId: string; orderId: string; creditedMinor: bigint; merchantDay?: string; providerDay?: string; held: boolean }

const DEFAULT_PROVIDER_TZ: TimeZoneRef = { name: "UTC", utcOffsetMinutes: 0 }; // [ASSUMPTION] when no batch names the provider's day

function payments(input: ReconcileInput, orderOf: (paymentId: string) => string): Payment[] {
  const ptz = input.batches[0]?.providerTimeZone ?? DEFAULT_PROVIDER_TZ;
  return input.providerRecords.map((r) => {
    const t = r.transferRef && input.transfers.find((x) => x.network === r.transferRef!.network && x.txHash === r.transferRef!.txHash && x.logIndex === r.transferRef!.logIndex);
    return {
      paymentId: r.providerPaymentId, orderId: orderOf(r.providerPaymentId), creditedMinor: r.creditedMinor, held: r.statusClaim === "held_for_review" && !r.batchId,
      ...(t ? { merchantDay: localDate(t.timestamp, input.entity.timeZone.utcOffsetMinutes), providerDay: localDate(t.timestamp, ptz.utcOffsetMinutes) } : {}),
    };
  }).sort((a, b) => (a.paymentId < b.paymentId ? -1 : 1));
}

const line = (kind: BridgeLineKind, label: string, ps: { paymentId: string; orderId: string; creditedMinor: bigint }[], sign: 1n | -1n, reason: string, differenceType?: DifferenceType): BridgeLine => ({
  kind, label, amountMinor: sign * sum(ps.map((p) => p.creditedMinor)), paymentIds: ps.map((p) => p.paymentId), orderIds: [...new Set(ps.map((p) => p.orderId))].sort(), reason,
  ...(differenceType ? { differenceType } : {}),
});

export function buildBridges(input: ReconcileInput, orderOf: (paymentId: string) => string): { bridges: BatchBridge[]; groupings: ProposedGrouping[] } {
  const cur = input.entity.functionalCurrency;
  const all = payments(input, orderOf);
  const batchOf = new Map(input.batchLines.filter((l) => l.kind === "payment" && l.providerPaymentId).map((l) => [l.providerPaymentId!, l.batchId]));
  const dayOf = new Map(input.batches.map((b) => [b.batchId, b.providerDay]));
  const bridges = [...input.batches].sort((a, b) => (a.batchId < b.batchId ? -1 : 1)).map((b): BatchBridge => {
    const D = b.providerDay; // the merchant day this batch is bridged from: the same calendar date in the entity's zone
    const inB = all.filter((p) => batchOf.get(p.paymentId) === b.batchId);
    const mDay = all.filter((p) => p.merchantDay === D);
    const out = mDay.filter((p) => batchOf.get(p.paymentId) !== b.batchId);
    const otherDay = (p: Payment) => dayOf.get(batchOf.get(p.paymentId) ?? "") ?? "";
    const lines: BridgeLine[] = [line("merchant_day", `${mDay.length} orders, merchant day ${D} (${input.entity.timeZone.name})`, mDay, 1n, "Payments whose chain transfer falls on the merchant's day.")];
    const outPrior = out.filter((p) => active("M5.bridge.timing_prior_batch") && otherDay(p) !== "" && otherDay(p) < D);
    const outHeld = out.filter((p) => active("M5.bridge.held_by_provider") && p.held);
    const outNext = out.filter((p) => active("M5.bridge.timing_next_batch") && otherDay(p) > D);
    const inPrior = inB.filter((p) => active("M5.bridge.timing_prior_batch") && p.merchantDay !== undefined && p.merchantDay < D);
    const inNext = inB.filter((p) => active("M5.bridge.timing_next_batch") && p.merchantDay !== undefined && p.merchantDay > D);
    const explained = new Set([...outPrior, ...outHeld, ...outNext, ...inPrior, ...inNext].map((p) => p.paymentId));
    const pushIf = (ps: Payment[], kind: BridgeLineKind, sign: 1n | -1n, label: string, reason: string, t: DifferenceType) => { if (ps.length) lines.push(line(kind, label, ps, sign, reason, t)); };
    pushIf(outPrior, "timing_prior_batch", -1n, `${outPrior.length} orders in the prior batch`, "Merchant-day orders the provider settled in an earlier batch (provider day ends earlier).", "timing_prior_batch");
    pushIf(inPrior, "timing_prior_batch", 1n, `${inPrior.length} earlier-day orders`, "Orders from an earlier merchant day settled in this batch.", "timing_prior_batch");
    pushIf(outHeld, "held_by_provider", -1n, `Held for review (${outHeld.map((p) => p.orderId).join(", ")})`, "Shown as completed, in no settlement, held for review.", "held_by_provider");
    pushIf(outNext, "timing_next_batch", -1n, `${outNext.length} orders in a later batch`, "Merchant-day orders settled in a later batch.", "timing_next_batch");
    pushIf(inNext, "timing_next_batch", 1n, `${inNext.length} next-day orders`, "Next merchant-day orders inside this provider day (provider day is in another time zone).", "timing_next_batch");
    const stray = [...out, ...inB.filter((p) => p.merchantDay !== D)].filter((p) => !explained.has(p.paymentId));
    const strayIn = stray.filter((p) => batchOf.get(p.paymentId) === b.batchId);
    const strayOut = stray.filter((p) => batchOf.get(p.paymentId) !== b.batchId);
    pushIf(strayIn, "unexplained", 1n, `${strayIn.length} payments in this batch with no merchant-day explanation`, "In the batch, but their timing could not be explained.", "unexplained");
    pushIf(strayOut, "unexplained", -1n, `${strayOut.length} merchant-day payments in no batch`, "Merchant-day payments the provider has not settled; any grouping is only proposed.", "unexplained");
    const bridgeGross = sum(lines.map((l) => l.amountMinor));
    const refundLines = input.batchLines.filter((l) => l.batchId === b.batchId && l.kind === "refund");
    const allIds = inB.map((p) => p.paymentId);
    lines.push({ kind: "gross", label: `Gross, batch ${b.batchId} (${inB.length} payments)`, amountMinor: b.grossMinor, paymentIds: allIds, orderIds: [...new Set(inB.map((p) => p.orderId))].sort(), reason: "Settlement report gross." });
    lines.push({ kind: "provider_fee", label: "Provider fee", amountMinor: -b.feesMinor, paymentIds: allIds, orderIds: [], differenceType: "provider_fee", reason: `Provider fee on ${fmtFiat(b.grossMinor, cur)} gross.` });
    if (refundLines.length || b.refundsMinor !== 0n)
      lines.push({ kind: "refund_netted", label: `Refund (${refundLines.map((l) => l.orderId).join(", ")})`, amountMinor: -b.refundsMinor, paymentIds: refundLines.map((l) => l.refundId ?? l.orderId), orderIds: refundLines.map((l) => l.orderId), differenceType: "refund_netted", reason: "Refund netted from the settlement." });
    lines.push({ kind: "net", label: "Net = bank credit", amountMinor: b.netMinor, paymentIds: allIds, orderIds: [], reason: "Settlement report net." });
    const bank = [...input.bankLines].sort((x, y) => (x.bankLineId < y.bankLineId ? -1 : 1))
      .find((l) => l.description.includes(b.batchId) && l.account === b.targetBankAccount && l.currency === b.currency);
    const checks = {
      linesEqualGross: sum(inB.map((p) => p.creditedMinor)) === b.grossMinor && sum(refundLines.map((l) => l.amountMinor)) === b.refundsMinor,
      bridgeEqualsGross: bridgeGross === b.grossMinor,
      grossLessFeesRefundsEqualsNet: b.grossMinor - b.feesMinor - b.refundsMinor === b.netMinor,
      netEqualsBankLine: !!bank && bank.amountMinor === b.netMinor,
      noUnexplained: !lines.some((l) => l.kind === "unexplained"),
    };
    const tied = Object.values(checks).every(Boolean);
    const imported = bank?.source === "csv_import";
    const importedBlocks = imported && !input.policy.allowImportedBankLinesAsVerified && active("M5.bank.imported_not_verified");
    return {
      label: TEST_MODE_LABEL, batchId: b.batchId, currency: b.currency, merchantDay: D, merchantTimeZone: input.entity.timeZone, providerDay: b.providerDay,
      providerTimeZone: b.providerTimeZone, lines, paymentIds: allIds, bankLineId: bank?.bankLineId ?? null, bankLineSource: bank?.source ?? null,
      bankLineLabel: imported ? IMPORTED_BANK_LINE_LABEL : null, checks, tied, settlementVerified: tied && !importedBlocks,
    };
  });
  // No batch ID: propose a grouping by provider day and currency. Never closed by the engine.
  const unbatched = all.filter((p) => !batchOf.has(p.paymentId) && !p.held && p.providerDay && active("M5.grouping.proposed_needs_confirmation"));
  const used = new Set(bridges.map((x) => x.bankLineId));
  const days = [...new Set(unbatched.map((p) => p.providerDay!))].sort();
  const groupings = days.map((day): ProposedGrouping => {
    const ps = unbatched.filter((p) => p.providerDay === day);
    return {
      id: `PG-${cur}-${day}`, status: "proposed_needs_confirmation", currency: cur, providerDay: day, paymentIds: ps.map((p) => p.paymentId),
      orderIds: [...new Set(ps.map((p) => p.orderId))].sort(), totalMinor: sum(ps.map((p) => p.creditedMinor)),
      candidateBankLineIds: input.bankLines.filter((l) => l.currency === cur && l.valueDate >= day && !used.has(l.bankLineId)).map((l) => l.bankLineId).sort(),
      reason: "The provider gave no batch ID. This grouping by provider day is a proposal; a person must confirm it against the settlement report and the bank line.",
    };
  });
  return { bridges, groupings };
}
