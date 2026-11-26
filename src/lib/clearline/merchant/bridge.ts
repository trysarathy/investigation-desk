/**
 * rc6 step 5: grouping and the settlement bridge. For every settlement batch, the bridge runs from the merchant's
 * day (entity time zone) to the bank credit: prior-batch timing, held, next-day timing, fees, refunds. A batch is
 * tied only when gross − fees − refunds = net = the bank line, to the cent. Without a batch ID a grouping is only
 * proposed (status "proposed_needs_confirmation") and never closed by the engine.
 */
import { fmtFiat, localDate, sum } from "./amounts";
import { endOfLocalDay, valueIn } from "./fx";
import { indexesOf, transferKey } from "./indexes";
import { active } from "./rules";
import type { BankEvidenceLevel, BankLine, DifferenceType, FiatCurrency, FxValue, ReconcileInput, SettlementPaymentLine, TimeZoneRef } from "./types";
import { BANK_EVIDENCE_RANK, IMPORTED_BANK_LINE_LABEL, TEST_MODE_LABEL, type TestModeLabel } from "./types";

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
  checks: {
    linesEqualGross: boolean; bridgeEqualsGross: boolean; grossLessFeesRefundsEqualsNet: boolean; netEqualsBankLine: boolean; noUnexplained: boolean;
    /**
     * v1, only when a per-payment settlement file names payments in this batch: its lines sum exactly to the batch's
     * gross, fees and net, each line is consistent (gross − fee = net, the batch's currency, a known payment whose credit
     * is the line's gross, its order and batch as the provider record names them), and no payment is put in two batches.
     */
    perPaymentLines?: boolean;
    /**
     * v1 (founder decision 9), present only for a batch in another currency than the entity's or when a currency
     * disagrees: every payment in the batch is in the batch's currency, and the bank line the batch names (by reference
     * and account) is in it too. False is an exception (M5.batch.currency_mismatch); nothing is ever converted to tie.
     */
    currencyAgrees?: boolean;
  };
  tied: boolean;
  settlementVerified: boolean;
  /**
   * v1 (decision 9): for a batch in another currency than the entity's, its net in the entity's currency at the recorded
   * rate at or before the bank line's value date (no more than 24 h older), or "needs a rate". Shown only; it decides nothing.
   */
  entityValue?: FxValue;
  /** v1 Phase 0.5: the evidence level of the batch's bank line ("none" without one). The policy flag never raises it. */
  bankEvidence: BankEvidenceLevel;
  /** Settled = tied to the cent AND bank evidence at least imported_two_person_confirmed. */
  settled: boolean;
}

/**
 * v1 Phase 0.5: the evidence a bank line gives. Only an imported statement line confirmed by a second person gives
 * imported_two_person_confirmed; everything else (an unconfirmed import, a seeded or recorded "feed" line) gives none.
 * `bank_authenticated` is reserved: no code path returns it until a bank connection exists.
 */
export function bankLineEvidence(l: Pick<BankLine, "source" | "secondPersonConfirmed">): BankEvidenceLevel {
  return l.source === "csv_import" && l.secondPersonConfirmed === true ? "imported_two_person_confirmed" : "none";
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

interface Payment { paymentId: string; orderId: string; creditedMinor: bigint; currency: FiatCurrency; merchantDay?: string; providerDay?: string; held: boolean }

const DEFAULT_PROVIDER_TZ: TimeZoneRef = { name: "UTC", utcOffsetMinutes: 0 }; // [ASSUMPTION] when no batch names the provider's day

function payments(input: ReconcileInput, orderOf: (paymentId: string) => string): Payment[] {
  const ptz = input.batches[0]?.providerTimeZone ?? DEFAULT_PROVIDER_TZ;
  return input.providerRecords.map((r) => {
    const t = r.transferRef && indexesOf(input).transferByKey.get(transferKey(r.transferRef));
    return {
      paymentId: r.providerPaymentId, orderId: orderOf(r.providerPaymentId), creditedMinor: r.creditedMinor, currency: r.creditedCurrency ?? input.entity.functionalCurrency,
      held: r.statusClaim === "held_for_review" && !r.batchId,
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
  // v1: per-payment settlement lines link a payment to its batch by the provider's payment ID (a reference, never an
  // amount). Only lines naming a batch in the settlement report link anything; a payment named in two batches, or in
  // another batch than a settlement line puts it in, makes both batches untied.
  const known = new Set(input.batches.map((b) => b.batchId));
  // v1 #174: refund rows are kept apart; only payment rows link a payment to a batch
  const isRefund = (l: SettlementPaymentLine) => l.kind === "refund";
  const allRows = [...(input.settlementPaymentLines ?? [])].filter((l) => known.has(l.batchId));
  const rRows = allRows.filter(isRefund).sort((a, b) => ((a.refundId ?? "") < (b.refundId ?? "") ? -1 : (a.refundId ?? "") > (b.refundId ?? "") ? 1 : a.batchId < b.batchId ? -1 : 1));
  const pLines = allRows.filter((l) => !isRefund(l)).sort((a, b) => (a.providerPaymentId < b.providerPaymentId ? -1 : a.providerPaymentId > b.providerPaymentId ? 1 : a.batchId < b.batchId ? -1 : 1));
  const conflicted = new Set<string>();
  const fromLines = new Map<string, string>();
  for (const l of pLines) {
    const other = fromLines.get(l.providerPaymentId) ?? batchOf.get(l.providerPaymentId);
    if (other !== undefined && other !== l.batchId) { conflicted.add(other); conflicted.add(l.batchId); }
    if (!fromLines.has(l.providerPaymentId)) fromLines.set(l.providerPaymentId, l.batchId);
  }
  for (const [pid, bid] of fromLines) if (!batchOf.has(pid)) batchOf.set(pid, bid);
  const ix = indexesOf(input);
  const dayOf = new Map(input.batches.map((b) => [b.batchId, b.providerDay]));
  const perPayment = (batchId: string) => pLines.filter((l) => l.batchId === batchId);
  const refundRows = (batchId: string) => rRows.filter((l) => l.batchId === batchId);
  // v1 #174: a refund row is valid only when it names a known payment of this merchant (the input is one entity's), in
  // the same currency, with a refund ID used once, a negative amount (fee 0, net = gross) and, with every other refund of
  // that payment, no more than the payment's credit. Any invalid refund row leaves its batch untied.
  const refundIdCount = new Map<string, number>();
  for (const l of rRows) if (l.refundId) refundIdCount.set(l.refundId, (refundIdCount.get(l.refundId) ?? 0) + 1);
  const refundedOf = new Map<string, bigint>();
  for (const l of rRows) refundedOf.set(l.providerPaymentId, (refundedOf.get(l.providerPaymentId) ?? 0n) - l.grossMinor);
  const refundValid = (l: SettlementPaymentLine): boolean => {
    const r = ix.recordByPaymentId.get(l.providerPaymentId);
    return !!l.refundId && refundIdCount.get(l.refundId) === 1 && !!r && r.creditedMinor > 0n
      && l.grossMinor < 0n && l.feeMinor === 0n && l.netMinor === l.grossMinor
      && l.currency === (r.creditedCurrency ?? cur) && (refundedOf.get(l.providerPaymentId) ?? 0n) <= r.creditedMinor
      && (l.orderId === undefined || l.orderId === orderOf(l.providerPaymentId));
  };
  const perPaymentTie = (b: (typeof input.batches)[number]): boolean => {
    const ls = perPayment(b.batchId);
    const rs = refundRows(b.batchId);
    // gross and fees from the payment rows; refunds from the refund rows (when the file has any); every row's net sums to
    // the batch's net (gross − fees − refunds = net, exactly)
    const refunded = -sum(rs.map((l) => l.grossMinor));
    const sums = sum(ls.map((l) => l.grossMinor)) === b.grossMinor && sum(ls.map((l) => l.feeMinor)) === b.feesMinor && sum(ls.map((l) => l.netMinor)) - b.refundsMinor === b.netMinor
      && (rs.length === 0 || (refunded === b.refundsMinor && sum([...ls, ...rs].map((l) => l.netMinor)) === b.netMinor && rs.every((l) => l.currency === b.currency && refundValid(l))));
    const each = ls.every((l) => {
      const r = ix.recordByPaymentId.get(l.providerPaymentId);
      return l.grossMinor - l.feeMinor === l.netMinor && l.currency === b.currency && !!r && r.creditedMinor === l.grossMinor
        && (l.orderId === undefined || l.orderId === orderOf(l.providerPaymentId)) && (r.batchId === undefined || r.batchId === b.batchId);
    });
    const lined = input.batchLines.filter((l) => l.batchId === b.batchId && l.kind === "payment").map((l) => l.providerPaymentId ?? "").sort();
    const sameSet = lined.length === 0 || JSON.stringify(lined) === JSON.stringify(ls.map((l) => l.providerPaymentId).sort());
    return sums && each && sameSet && !conflicted.has(b.batchId) && new Set(ls.map((l) => l.providerPaymentId)).size === ls.length;
  };
  const bridges = [...input.batches].sort((a, b) => (a.batchId < b.batchId ? -1 : 1)).map((b): BatchBridge => {
    const D = b.providerDay; // the merchant day this batch is bridged from: the same calendar date in the entity's zone
    const inB = all.filter((p) => batchOf.get(p.paymentId) === b.batchId);
    // v1 (decision 9): the merchant-day line holds payments in the batch's own currency only (never summed across currencies)
    const mDay = all.filter((p) => p.merchantDay === D && p.currency === b.currency);
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
    // v1 #174: refunds a per-payment file names (by refund ID, linked to the original payment by its payment ID)
    const rowRefunds = refundRows(b.batchId).map((l) => ({ refundId: l.refundId ?? "", orderId: l.orderId ?? orderOf(l.providerPaymentId), amountMinor: -l.grossMinor }));
    const namedRefunds = [...refundLines, ...(refundLines.length ? [] : rowRefunds)];
    const allIds = inB.map((p) => p.paymentId);
    lines.push({ kind: "gross", label: `Gross, batch ${b.batchId} (${inB.length} payments)`, amountMinor: b.grossMinor, paymentIds: allIds, orderIds: [...new Set(inB.map((p) => p.orderId))].sort(), reason: "Settlement report gross." });
    lines.push({ kind: "provider_fee", label: "Provider fee", amountMinor: -b.feesMinor, paymentIds: allIds, orderIds: [], differenceType: "provider_fee", reason: `Provider fee on ${fmtFiat(b.grossMinor, b.currency)} gross.` });
    if (namedRefunds.length || b.refundsMinor !== 0n)
      lines.push({ kind: "refund_netted", label: `Refund (${namedRefunds.map((l) => l.orderId).join(", ")})`, amountMinor: -b.refundsMinor, paymentIds: namedRefunds.map((l) => l.refundId || l.orderId), orderIds: namedRefunds.map((l) => l.orderId), differenceType: "refund_netted", reason: "Refund netted from the settlement." });
    lines.push({ kind: "net", label: "Net = bank credit", amountMinor: b.netMinor, paymentIds: allIds, orderIds: [], reason: "Settlement report net." });
    const named = [...input.bankLines].sort((x, y) => (x.bankLineId < y.bankLineId ? -1 : 1)).filter((l) => l.description.includes(b.batchId) && l.account === b.targetBankAccount);
    const bank = named.find((l) => l.currency === b.currency);
    // v1 (decision 9): a bank line naming this batch in another currency is a mismatch (an exception), never a tie
    const otherCurrencyLine = !bank && named.some((l) => l.currency !== b.currency);
    const offCurrency = inB.filter((p) => p.currency !== b.currency);
    const currencyCheck = b.currency !== cur || otherCurrencyLine || offCurrency.length > 0;
    const checks = {
      // refunds named by the settlement report's lines, else by the per-payment file's refund rows (both, when both exist)
      linesEqualGross: sum(inB.map((p) => p.creditedMinor)) === b.grossMinor && sum(namedRefunds.map((l) => l.amountMinor)) === b.refundsMinor
        && (rowRefunds.length === 0 || sum(rowRefunds.map((l) => l.amountMinor)) === b.refundsMinor),
      bridgeEqualsGross: bridgeGross === b.grossMinor,
      grossLessFeesRefundsEqualsNet: b.grossMinor - b.feesMinor - b.refundsMinor === b.netMinor,
      netEqualsBankLine: !!bank && bank.amountMinor === b.netMinor,
      noUnexplained: !lines.some((l) => l.kind === "unexplained"),
      ...(perPayment(b.batchId).length || refundRows(b.batchId).length ? { perPaymentLines: perPaymentTie(b) } : {}),
      ...(currencyCheck ? { currencyAgrees: !otherCurrencyLine && offCurrency.length === 0 } : {}),
    };
    const tied = Object.values(checks).every(Boolean);
    const imported = bank?.source === "csv_import";
    const importedBlocks = imported && !input.policy.allowImportedBankLinesAsVerified && active("M5.bank.imported_not_verified");
    const bankEvidence: BankEvidenceLevel = bank ? bankLineEvidence(bank) : "none";
    return {
      label: TEST_MODE_LABEL, batchId: b.batchId, currency: b.currency, merchantDay: D, merchantTimeZone: input.entity.timeZone, providerDay: b.providerDay,
      providerTimeZone: b.providerTimeZone, lines, paymentIds: allIds, bankLineId: bank?.bankLineId ?? null, bankLineSource: bank?.source ?? null,
      bankLineLabel: imported ? IMPORTED_BANK_LINE_LABEL : null, checks, tied, settlementVerified: tied && !importedBlocks,
      bankEvidence, settled: tied && BANK_EVIDENCE_RANK[bankEvidence] >= BANK_EVIDENCE_RANK.imported_two_person_confirmed,
      ...(b.currency !== cur ? { entityValue: valueIn(b.netMinor, b.currency, cur, input.fiatRates ?? [],
        bank ? endOfLocalDay(bank.valueDate, input.entity.timeZone.utcOffsetMinutes) : endOfLocalDay(b.providerDay, b.providerTimeZone.utcOffsetMinutes)) } : {}),
    };
  });
  // No batch ID: propose a grouping by provider day and currency. Never closed by the engine.
  const unbatched = all.filter((p) => !batchOf.has(p.paymentId) && !p.held && p.providerDay && active("M5.grouping.proposed_needs_confirmation"));
  const used = new Set(bridges.map((x) => x.bankLineId));
  // v1 (decision 9): one proposal per provider day AND currency (payments in two currencies are never grouped together)
  const keys = [...new Set(unbatched.map((p) => `${p.providerDay!}|${p.currency}`))].sort();
  const groupings = keys.map((k): ProposedGrouping => {
    const [day, currency] = k.split("|") as [string, FiatCurrency];
    const ps = unbatched.filter((p) => p.providerDay === day && p.currency === currency);
    return {
      id: `PG-${currency}-${day}`, status: "proposed_needs_confirmation", currency, providerDay: day, paymentIds: ps.map((p) => p.paymentId),
      orderIds: [...new Set(ps.map((p) => p.orderId))].sort(), totalMinor: sum(ps.map((p) => p.creditedMinor)),
      candidateBankLineIds: input.bankLines.filter((l) => l.currency === currency && l.valueDate >= day && !used.has(l.bankLineId)).map((l) => l.bankLineId).sort(),
      reason: "The provider gave no batch ID. This grouping by provider day is a proposal; a person must confirm it against the settlement report and the bank line.",
    };
  });
  return { bridges, groupings };
}
