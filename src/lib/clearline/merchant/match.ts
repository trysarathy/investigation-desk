/**
 * rc6 merchant matching, steps 1–4 (identity → reference → checks → explained tolerance). Pure and deterministic:
 * inputs are re-sorted canonically, so arrival order never changes a result. The sender never decides a match and
 * an amount alone never closes one: a transfer is tied to an order only through a deposit address issued for it.
 */
import { abs, bpsOf, fmtFiat, fmtPct, fmtToken, instantMs, minBig, parseRate, sum, toFiatMinor } from "./amounts";
import { normAddress } from "./config";
import { active, type RuleId } from "./rules";
import type {
  Attention, ChainTransfer, ChainTransferView, Decision, Difference, DifferenceType, ExceptionItem, HistoryEntry, Invoice, MatchRecord,
  Owner, PaymentLink, ProviderPaymentRecord, Quote, ReconcileInput, Step, TokenConfig, TokenRef, TransferFinding, TransferRef, WriteOffProposal,
} from "./types";
import { TEST_MODE_LABEL } from "./types";

interface DepositRef { orderId: string; quoteId: string; linkId?: string; token: TokenRef }
interface TState { t: ChainTransfer; token?: TokenConfig; ref?: DepositRef; inbound: boolean; fail?: { ruleId: RuleId; detail: string }; pending: boolean }
interface Verdict { decision: Decision; step: Step; ruleId: RuleId; attention?: Attention }

export interface MatchOutput { records: MatchRecord[]; transferFindings: TransferFinding[]; exceptions: ExceptionItem[]; writeOffs: WriteOffProposal[] }

const tkey = (r: TransferRef): string => `${r.network}|${r.txHash}|${r.logIndex}`;
const refOf = (t: ChainTransfer): TransferRef => ({ network: t.network, txHash: t.txHash, logIndex: t.logIndex });
const byKey = <T>(key: (x: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const sameRate = (a: string, b: string): boolean => { const x = parseRate(a), y = parseRate(b); return x.num * y.den === y.num * x.den; };
const BALANCE_LABEL = { nothing_received: "nothing received yet", part_paid: "part paid", short_paid: "short paid", fully_credited: "fully credited", over_credited: "over credited" } as const;
const att = (owner: Owner, reason: string, nextStep: string): Attention => ({ owner, reason, nextStep });

export function buildDepositIndex(input: ReconcileInput): Map<string, DepositRef> {
  const index = new Map<string, DepositRef>();
  for (const q of [...input.quotes].sort(byKey((x: Quote) => x.quoteId)))
    index.set(`${q.network}|${normAddress(q.network, q.depositAddress)}`, { orderId: q.orderId, quoteId: q.quoteId, token: q.token });
  for (const l of [...input.paymentLinks].sort(byKey((x: PaymentLink) => x.linkId)))
    index.set(`${l.token.network}|${normAddress(l.token.network, l.depositAddress)}`, { orderId: l.orderId, quoteId: l.quoteId, linkId: l.linkId, token: l.token });
  return index;
}

/** Steps 1 and 2 for one transfer: identity, finality, then the deposit-address reference. Never the sender or amount. */
function identifyAndReference(t: ChainTransfer, input: ReconcileInput, deposits: Map<string, DepositRef>): TState {
  const s: TState = { t, inbound: true, pending: false };
  const fwd = deposits.get(`${t.network}|${normAddress(t.network, t.to)}`);
  const back = deposits.get(`${t.network}|${normAddress(t.network, t.from)}`);
  s.ref = fwd ?? back;
  s.inbound = !fwd && !!back ? false : true;
  const net = input.networks.find((n) => n.network === t.network);
  if (active("M1.identity.network_disabled") && (!net || !net.enabled)) return { ...s, fail: { ruleId: "M1.identity.network_disabled", detail: `Network ${t.network} is not enabled.` } };
  s.token = input.tokens.find((k) => k.network === t.network && normAddress(t.network, k.contract) === normAddress(t.network, t.tokenContract) && k.decimals === t.decimals);
  if (!s.token) {
    const lookalike = !!t.claimedSymbol && input.tokens.some((k) => k.symbol === t.claimedSymbol);
    if (lookalike && active("M1.identity.lookalike_token"))
      return { ...s, fail: { ruleId: "M1.identity.lookalike_token", detail: `Shown as ${t.claimedSymbol} but contract ${t.tokenContract} is not the configured ${t.claimedSymbol} contract on ${t.network}.` } };
    if (active("M1.identity.unknown_token")) return { ...s, fail: { ruleId: "M1.identity.unknown_token", detail: `Contract ${t.tokenContract} on ${t.network} is not a configured token.` } };
  }
  s.pending = !!net && t.confirmations < net.confirmationsRequired && active("M1.finality.pending");
  return s;
}

function attentionFor(ruleId: RuleId, detail: string): Attention {
  if (ruleId.startsWith("M1.identity")) return att("Treasury", detail, "Do not credit this transfer. Confirm the token with the provider and the customer before anything else.");
  if (ruleId === "M2.reference.unattributed") return att("Payment Operations", `Unattributed transfer. ${detail}`, "Find the order with the customer or the provider. Never assign it by amount or by sender.");
  if (ruleId === "M3.batch.held_by_provider") return att("Treasury", detail, "Ask the provider why the payment is held and when it will be settled.");
  return att("Payment Operations", detail, "Check the order, the quote and the provider record, then decide by hand.");
}

/** Evaluate one order through steps 1–4. Exported pieces are reused by later steps (grouping, partials). */
function evaluateOrder(inv: Invoice, states: TState[], input: ReconcileInput): { record: MatchRecord; writeOff?: WriteOffProposal } {
  const { entity, policy } = input;
  const cur = entity.functionalCurrency;
  const history: HistoryEntry[] = [];
  const differences: Difference[] = [];
  const note = (step: Step, ruleId: string, outcome: HistoryEntry["outcome"], detail: string) => history.push({ step, ruleId, outcome, detail });
  const addDiff = (type: DifferenceType, amountMinor: bigint, ruleId: RuleId, reason: string) => {
    if (amountMinor !== 0n) differences.push({ id: `${inv.orderId}.D${differences.length + 1}`, type, amountMinor, currency: cur, reason, ruleId });
  };
  const final = states.filter((s) => !s.fail && !s.pending);
  const quotes = input.quotes.filter((q) => q.orderId === inv.orderId).sort(byKey((q) => q.quoteId));
  const recFor = (s: TState): ProviderPaymentRecord | undefined =>
    input.providerRecords.find((r) => r.transferRef && tkey(r.transferRef) === tkey(s.t)) ??
    input.providerRecords.find((r) => !r.transferRef && ((s.ref?.linkId && r.ref.linkId === s.ref.linkId) || (!r.ref.linkId && r.ref.quoteId === s.ref?.quoteId)));
  const pairs = final.map((s) => ({ s, rec: recFor(s) })).sort((a, b) => instantMs(a.s.t.timestamp) - instantMs(b.s.t.timestamp));
  const links = input.paymentLinks.filter((l) => l.orderId === inv.orderId).sort(byKey((l) => l.linkId));
  /** The validity window of the reference used: the payment link's when it has one, else the quote's. */
  const windowOf = (s: TState, q: Quote) => links.find((l) => l.linkId === s.ref?.linkId) ?? q;
  const balanceLinkOpen = links.some((l) => l.kind === "balance" && !final.some((s) => s.ref?.linkId === l.linkId));
  const credited = sum(pairs.filter((p) => p.rec && p.s.inbound && p.rec.receivedBaseUnits === p.s.t.amountBaseUnits).map((p) => p.rec!.creditedMinor));
  const partOpen = balanceLinkOpen && credited > 0n && credited < inv.amountMinor && active("M4.partial.balance_link_open");
  const finish = (v: Verdict, writeOff?: WriteOffProposal) => {
    note(v.step, v.ruleId, v.decision === "matched" ? "pass" : "fail", `Decision: ${v.decision}.`);
    const open = inv.amountMinor - credited;
    const balanceState = credited === 0n ? "nothing_received" : partOpen ? "part_paid" : open > 0n ? "short_paid" : open < 0n ? "over_credited" : "fully_credited";
    const records = pairs.map((p) => p.rec).filter((r): r is ProviderPaymentRecord => !!r);
    const held = records.some((r) => r.statusClaim === "held_for_review" && !r.batchId);
    const batchIds = [...new Set(records.map((r) => r.batchId).filter((b): b is string => !!b))].sort();
    const record: MatchRecord = {
      label: TEST_MODE_LABEL,
      orderId: inv.orderId,
      chain: { transfers: states.filter((s) => !s.pending).map((s) => view(s, input)), pending: states.filter((s) => s.pending).map((s) => refOf(s.t)) },
      provider: { records, note: "provider statuses are claims, not proof" },
      bank: { status: held ? "held_by_provider" : batchIds.length ? "in_batch" : "not_in_batch", batchIds, bankLineIds: [], batchTied: false, settlementVerified: false, bankLineLabels: [] },
      ledger: {
        invoice: inv, creditedMinor: credited, openBalanceMinor: open > 0n ? open : 0n, customerOverpaymentMinor: open < 0n ? -open : 0n,
        balanceState, balanceLabel: BALANCE_LABEL[balanceState],
      },
      explanation: { decision: v.decision, decidingStep: v.step, ruleId: v.ruleId, differences, history },
      ...(v.attention ? { attention: v.attention } : {}),
    };
    return { record, writeOff };
  };
  const stop = (step: Step, ruleId: RuleId, detail: string, decision: Decision = "exception") => finish({ decision, step, ruleId, attention: attentionFor(ruleId, detail) });

  // Step 1: identity and finality.
  for (const s of states) {
    if (s.fail) { note(1, s.fail.ruleId, "fail", s.fail.detail); return stop(1, s.fail.ruleId, s.fail.detail); }
    if (s.pending) note(1, "M1.finality.pending", "note", `${s.t.txHash} has ${s.t.confirmations} confirmations; ignored until final.`);
  }
  if (final.length === 0 && states.some((s) => s.pending))
    return finish({ decision: "suggested_for_review", step: 1, ruleId: "M1.finality.pending",
      attention: att("Payment Operations", "No final transfer yet. A provider 'paid' or 'completed' status is a claim, not proof.", "Wait for the network's finality rule, then rerun.") });
  if (final.length === 0 && active("M2.reference.no_chain_transfer")) return stop(2, "M2.reference.no_chain_transfer", "The provider reports a payment, but no transfer reached a deposit address issued for this order. A provider status is a claim, not proof.");
  note(1, "M1.identity.unknown_token", "pass", "Token identified by (network, contract); transfers final.");

  // Step 2: reference first. The deposit address issued for this order links the transfer; sender and amount are not used.
  for (const { s, rec } of pairs) {
    note(2, "M2.reference.unattributed", "pass", `${s.t.txHash} → ${s.ref!.linkId ?? s.ref!.quoteId} (deposit address issued for ${inv.orderId}). Sender ${s.t.from} recorded as a fact only.`);
    if (rec && active("M2.reference.provider_ref_mismatch") && ((rec.ref.linkId && rec.ref.linkId !== s.ref!.linkId) || (rec.ref.quoteId && rec.ref.quoteId !== s.ref!.quoteId)))
      return stop(2, "M2.reference.provider_ref_mismatch", `Provider record ${rec.providerPaymentId} names ${rec.ref.linkId ?? rec.ref.quoteId}, but the transfer reached the address of ${s.ref!.linkId ?? s.ref!.quoteId}.`);
  }

  // Step 3: currency, direction, time window, settlement batch.
  const quote = quotes.find((q) => q.quoteId === pairs[0].s.ref!.quoteId) ?? quotes[0];
  const qTok = input.tokens.find((k) => k.network === quote.token.network && k.contract === quote.token.contract)!;
  if (inv.currency !== cur && active("M3.currency.invoice_currency")) return stop(3, "M3.currency.invoice_currency", `Invoice is in ${inv.currency}; the entity's functional currency is ${cur}.`);
  if (toFiatMinor(quote.quotedBaseUnits, qTok.decimals, quote.rate, cur) !== inv.amountMinor && active("M3.quote.invoice_mismatch"))
    return stop(3, "M3.quote.invoice_mismatch", `Quote ${quote.quoteId} at ${quote.rate} does not equal the invoice ${fmtFiat(inv.amountMinor, cur)}.`);
  for (const { s, rec } of pairs) {
    if (!s.inbound && active("M3.direction.outbound")) return stop(3, "M3.direction.outbound", `${s.t.txHash} leaves the deposit address; it is not a payment in.`);
    if (normAddress(s.t.network, s.t.tokenContract) !== normAddress(s.ref!.token.network, s.ref!.token.contract) && active("M3.currency.token_mismatch"))
      return stop(3, "M3.currency.token_mismatch", `${s.token!.symbol} arrived at an address issued for a different token.`);
    if (s.t.decimals !== qTok.decimals && active("M3.currency.token_mismatch")) return stop(3, "M3.currency.token_mismatch", `${s.token!.symbol} has ${s.t.decimals} decimals; the quote's token has ${qTok.decimals}.`);
    const ts = instantMs(s.t.timestamp);
    const w = windowOf(s, quote);
    if (ts < instantMs(w.createdAt) && active("M3.window.before_quote")) return stop(3, "M3.window.before_quote", `${s.t.txHash} predates quote ${quote.quoteId}.`);
    if (ts > instantMs(w.expiresAt) && rec?.statusClaim !== "re_quoted" && active("M3.window.after_expiry_no_requote"))
      return stop(3, "M3.window.after_expiry_no_requote", `${s.t.txHash} arrived after quote ${quote.quoteId} expired, and the provider did not re-quote.`);
    if (!rec && active("M3.provider.no_record")) return stop(3, "M3.provider.no_record", `Final transfer ${s.t.txHash} has no provider record.`);
    if (!rec) continue;
    if (rec.receivedBaseUnits !== s.t.amountBaseUnits && active("M3.provider.received_mismatch"))
      return stop(3, "M3.provider.received_mismatch", `Provider says ${fmtToken(rec.receivedBaseUnits, s.t.decimals, s.token!.symbol)} received; the chain shows ${fmtToken(s.t.amountBaseUnits, s.t.decimals, s.token!.symbol)}.`);
    if (rec.batchId && !input.batches.some((b) => b.batchId === rec.batchId) && active("M3.batch.unknown_batch"))
      return stop(3, "M3.batch.unknown_batch", `Provider names settlement batch ${rec.batchId}, which is not in the settlement report.`);
    if (rec.statusClaim === "held_for_review" && !rec.batchId && active("M3.batch.held_by_provider"))
      return stop(3, "M3.batch.held_by_provider", `${rec.displayedStatus === "completed" ? "Shown as completed, in no settlement, held for review" : "Held for review by the provider, in no settlement"}.`);
  }
  note(3, "M3.currency.invoice_currency", "pass", "Currency, direction, time window and settlement batch checked.");

  // Step 4: explained tolerance. Typed items first, then the band.
  let explainedCredit = 0n; // credited as recomputed from the chain amount and the executed rate
  for (const { s, rec } of pairs) {
    const recomputed = toFiatMinor(s.t.amountBaseUnits, s.t.decimals, rec!.executedRate, cur);
    const checked = active("M4.provider.credit_mismatch");
    explainedCredit += checked ? recomputed : rec!.creditedMinor;
    if (recomputed !== rec!.creditedMinor && checked)
      addDiff("unexplained", rec!.creditedMinor - recomputed, "M4.provider.credit_mismatch", `Provider credited ${fmtFiat(rec!.creditedMinor, cur)}, but ${fmtToken(s.t.amountBaseUnits, s.t.decimals, s.token!.symbol)} at ${rec!.executedRate} is ${fmtFiat(recomputed, cur)}.`);
  }
  const received = sum(pairs.map((p) => p.s.t.amountBaseUnits));
  const valueAtQuote = toFiatMinor(received, qTok.decimals, quote.rate, cur);
  const tokenPart = valueAtQuote - inv.amountMinor;
  const ratePart = explainedCredit - valueAtQuote;
  const d = received - quote.quotedBaseUnits;
  const recs = pairs.map((p) => p.rec!);
  const q = (u: bigint) => fmtToken(u, qTok.decimals, qTok.symbol);
  if (partOpen) {
    const open = links.filter((l) => l.kind === "balance" && !final.some((s) => s.ref?.linkId === l.linkId)).map((l) => l.linkId).join(", ");
    addDiff("partial_payment_open", credited - inv.amountMinor, "M4.partial.balance_link_open", `Part paid: ${fmtFiat(inv.amountMinor - credited, cur)} is still open on balance link ${open}. This is not overdue; rate and fee differences are settled when the balance arrives.`);
  } else if (d < 0n && abs(d) <= policy.senderFeeBoundBaseUnits && recs[recs.length - 1].statusClaim === "paid" && active("M4.tolerance.sender_side_fee")) {
    addDiff("sender_side_fee", tokenPart, "M4.tolerance.sender_side_fee", `Received ${q(received)} of ${q(quote.quotedBaseUnits)}. The ${q(-d)} gap is within the network-fee bound and the provider claims paid, so it is treated as a fee deducted on the sender's side.`);
  } else if (d < 0n && active("M4.tolerance.underpayment")) {
    addDiff("underpayment", tokenPart, "M4.tolerance.underpayment", `Customer paid ${q(received)} of ${q(quote.quotedBaseUnits)} (${fmtPct(d, quote.quotedBaseUnits)} short). ${fmtFiat(-tokenPart, cur)} at the quoted rate is still owed.`);
  } else if (d > 0n && active("M4.tolerance.overpayment")) {
    addDiff("overpayment", tokenPart, "M4.tolerance.overpayment", `Customer paid ${q(received)} against ${q(quote.quotedBaseUnits)} (${fmtPct(d, quote.quotedBaseUnits)} over). The excess is a customer-overpayment liability.`);
  } else addDiff("unexplained", tokenPart, "M4.tolerance.unexplained", `Received ${q(received)} against ${q(quote.quotedBaseUnits)} with no typed explanation.`);
  if (!partOpen && ratePart !== 0n) {
    const late = pairs.find((p) => instantMs(p.s.t.timestamp) > instantMs(windowOf(p.s, quote).expiresAt));
    const requoted = recs.find((r) => r.statusClaim === "re_quoted");
    if (late && requoted && active("M4.tolerance.requote_after_expiry")) {
      const mins = (BigInt(instantMs(late.s.t.timestamp)) - BigInt(instantMs(windowOf(late.s, quote).expiresAt))) / 60_000n;
      addDiff("requote_after_expiry", ratePart, "M4.tolerance.requote_after_expiry", `Paid ${mins} min after quote ${quote.quoteId} expired; the provider re-quoted at ${requoted.executedRate} instead of ${quote.rate}.`);
    } else if (recs.some((r) => !sameRate(r.executedRate, quote.rate)) && active("M4.tolerance.rate_difference")) {
      addDiff("rate_difference", ratePart, "M4.tolerance.rate_difference", `Executed at ${[...new Set(recs.map((r) => r.executedRate))].join(" and ")} against the quoted ${quote.rate}.`);
    } else addDiff("unexplained", ratePart, "M4.tolerance.unexplained", `Credited differs from the quoted value by ${fmtFiat(ratePart, cur)} with no rate or re-quote explanation.`);
  }
  const total = sum(differences.map((x) => x.amountMinor));
  if (total === 0n && active("M4.match.no_difference")) return finish({ decision: "matched", step: 4, ruleId: "M4.match.no_difference" });
  const band = minBig(bpsOf(inv.amountMinor, policy.tolerancePct), policy.toleranceAbsMinor);
  const types = new Set(differences.map((x) => x.type));
  note(4, "M4.tolerance.within_band", "note", `Difference ${fmtFiat(total, cur)}; band min(${policy.tolerancePct} bps, ${fmtFiat(policy.toleranceAbsMinor, cur)}) = ${fmtFiat(band, cur)}.`);
  if (types.has("unexplained") && active("M4.tolerance.unexplained"))
    return stop(4, "M4.tolerance.unexplained", differences.find((x) => x.type === "unexplained")!.reason);
  if (abs(total) <= band && !partOpen && active("M4.tolerance.within_band")) {
    if (abs(total) > policy.writeoffThresholdMinor && active("M4.tolerance.writeoff_threshold"))
      return finish({ decision: "suggested_for_review", step: 4, ruleId: "M4.tolerance.writeoff_threshold", attention: att("Finance Controller", `Within the band but above the write-off threshold ${fmtFiat(policy.writeoffThresholdMinor, cur)}.`, "Decide the write-off by hand.") });
    const writeOff: WriteOffProposal = {
      id: `WO-${inv.orderId}`, orderId: inv.orderId, amountMinor: abs(total), direction: total < 0n ? "shortfall" : "excess", currency: cur,
      differenceIds: differences.map((x) => x.id), status: "proposed", preparedBy: "engine", approverRoles: policy.approverRoles,
    };
    return finish({ decision: "matched_with_difference", step: 4, ruleId: "M4.tolerance.within_band" }, writeOff);
  }
  if (types.has("underpayment") && active("M4.tolerance.underpayment_beyond_band"))
    return finish({ decision: "exception", step: 4, ruleId: "M4.tolerance.underpayment_beyond_band", attention: att("Payment Operations", differences.find((x) => x.type === "underpayment")!.reason, `Ask the customer for the remaining ${fmtFiat(-total, cur)} through a balance payment link, or propose a write-off for approval.`) });
  if (types.has("overpayment") && active("M4.tolerance.overpayment_beyond_band"))
    return finish({ decision: "exception", step: 4, ruleId: "M4.tolerance.overpayment_beyond_band", attention: att("Payment Operations", differences.find((x) => x.type === "overpayment")!.reason, `Agree with the customer whether to refund ${fmtFiat(total, cur)} or keep it as credit. Until then it is held as a customer-overpayment liability.`) });
  if (active("M4.tolerance.explained_outside_band"))
    return finish({ decision: "suggested_for_review", step: 4, ruleId: "M4.tolerance.explained_outside_band", attention: att("Payment Operations", `${differences.map((x) => x.reason).join(" ")} Outside the ${fmtFiat(band, cur)} band.`, partOpen ? "Wait for the balance link to be paid; nothing is overdue." : "Review the explained difference and accept or reject it.") });
  return stop(4, "M4.tolerance.unexplained", "Difference outside the band.");
}

function view(s: TState, input: ReconcileInput): ChainTransferView {
  const factsOf = (a: string) => input.addressFacts.filter((f) => f.network === s.t.network && normAddress(f.network, f.address) === normAddress(s.t.network, a)).map((f) => f.fact);
  const pathFacts = (s.t.priorHops ?? []).flatMap((h) => [h.from, h.to]).filter((a, i, xs) => xs.indexOf(a) === i).map((address) => ({ address, facts: factsOf(address) }));
  return { ...s.t, symbol: s.token?.symbol ?? "unknown", senderFacts: factsOf(s.t.from), pathFacts, ...(s.ref?.linkId ? { linkId: s.ref.linkId } : {}), ...(s.ref ? { quoteId: s.ref.quoteId } : {}) };
}

/** Steps 1–4 over every order and transfer. Output order is canonical (order id, then transfer key). */
export function matchPayments(input: ReconcileInput): MatchOutput {
  const deposits = buildDepositIndex(input);
  const states = [...input.transfers].sort(byKey(tkey)).map((t) => identifyAndReference(t, input, deposits));
  const transferFindings: TransferFinding[] = [];
  const exceptions: ExceptionItem[] = [];
  for (const s of states) {
    if (s.ref) continue; // attached to an order: its failures are reported on that order's record
    const ruleId: RuleId | undefined = s.fail?.ruleId ?? (s.pending ? undefined : active("M2.reference.unattributed") ? "M2.reference.unattributed" : undefined);
    if (!ruleId) {
      if (s.pending) transferFindings.push({ transfer: refOf(s.t), step: 1, ruleId: "M1.finality.pending", kind: "pending", detail: "Not final; ignored and recorded as pending." });
      continue;
    }
    const detail = s.fail?.detail ?? `${fmtToken(s.t.amountBaseUnits, s.t.decimals, s.token?.symbol ?? "units")} to ${s.t.to}, an address not issued for any order.`;
    const step: Step = ruleId.startsWith("M1") ? 1 : 2;
    transferFindings.push({ transfer: refOf(s.t), step, ruleId, kind: "exception", detail });
    exceptions.push({ id: `EX-${s.t.txHash}-${s.t.logIndex}`, step, ruleId, transfer: refOf(s.t), ...attentionFor(ruleId, detail) });
  }
  const records: MatchRecord[] = [];
  const writeOffs: WriteOffProposal[] = [];
  const orderIds = new Set(input.providerRecords.flatMap((r) => [r.ref.quoteId, r.ref.linkId]).map((id) => input.quotes.find((q) => q.quoteId === id)?.orderId ?? input.paymentLinks.find((l) => l.linkId === id)?.orderId));
  for (const inv of [...input.invoices].sort(byKey((i) => i.orderId))) {
    const mine = states.filter((s) => s.ref?.orderId === inv.orderId);
    if (mine.length === 0 && !orderIds.has(inv.orderId)) continue;
    const { record, writeOff } = evaluateOrder(inv, mine, input);
    records.push(record);
    if (writeOff) writeOffs.push(writeOff);
    if (record.explanation.decision === "exception")
      exceptions.push({ id: `EX-${inv.orderId}`, step: record.explanation.decidingStep, ruleId: record.explanation.ruleId, orderId: inv.orderId, ...record.attention! });
  }
  return { records, transferFindings, exceptions: exceptions.sort(byKey((e) => e.id)), writeOffs };
}
