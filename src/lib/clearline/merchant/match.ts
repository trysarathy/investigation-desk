/**
 * rc6 merchant matching, steps 1–4 (identity → reference → checks → explained tolerance). Pure and deterministic:
 * inputs are re-sorted canonically, so arrival order never changes a result. The sender never decides a match and
 * an amount alone never closes one: a transfer is tied to an order only through a deposit address issued for it.
 */
import { abs, bpsOf, fmtFiat, fmtPct, fmtToken, instantMs, maxBig, minBig, parseRate, sum, toFiatMinor } from "./amounts";
import { normAddress } from "./config";
import { indexesOf } from "./indexes";
import { resolveClaimedTransfers } from "./claims";
import { active, type RuleId } from "./rules";
import type {
  Attention, ChainTransfer, ChainTransferView, Decision, Difference, DifferenceType, ExceptionItem, HistoryEntry, Invoice, InvoiceTokenPrice, LedgerPart, MatchRecord,
  NetworkId, Owner, PaymentLink, ProviderPaymentRecord, Quote, QuoteTerm, ReconcileInput, Step, TokenConfig, TokenRef, TransferFinding, TransferRef, WriteOffProposal,
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
/** The candidate that comes first in input.providerRecords (reproduces Array.find over an "a || b" predicate). */
const firstOf = <T>(pos: Map<T, number>, a: T | undefined, b: T | undefined): T | undefined =>
  a === undefined ? b : b === undefined ? a : pos.get(a)! <= pos.get(b)! ? a : b;

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
function evaluateOrder(inv: Invoice, states: TState[], input: ReconcileInput, ambiguous: ReadonlyMap<string, string>): { record: MatchRecord; writeOff?: WriteOffProposal } {
  const { entity, policy } = input;
  const cur = entity.functionalCurrency;
  const history: HistoryEntry[] = [];
  const differences: Difference[] = [];
  const note = (step: Step, ruleId: string, outcome: HistoryEntry["outcome"], detail: string) => history.push({ step, ruleId, outcome, detail });
  const addDiff = (type: DifferenceType, amountMinor: bigint, ruleId: RuleId, reason: string) => {
    if (amountMinor !== 0n) differences.push({ id: `${inv.orderId}.D${differences.length + 1}`, type, amountMinor, currency: cur, reason, ruleId });
  };
  const final = states.filter((s) => !s.fail && !s.pending);
  const ix = indexesOf(input);
  const quotes = [...(ix.quotesByOrder.get(inv.orderId) ?? [])].sort(byKey((q) => q.quoteId));
  const recFor = (s: TState): ProviderPaymentRecord | undefined =>
    ix.recordByTransfer.get(tkey(s.t)) ?? firstOf(ix.recordPos,
      s.ref?.linkId ? ix.untransferredByLink.get(s.ref.linkId) : undefined, s.ref?.quoteId !== undefined ? ix.untransferredByQuoteNoLink.get(s.ref.quoteId) : ix.untransferredNoRef);
  const pairs = final.map((s) => ({ s, rec: recFor(s) })).sort((a, b) => instantMs(a.s.t.timestamp) - instantMs(b.s.t.timestamp));
  const links = [...(ix.linksByOrder.get(inv.orderId) ?? [])].sort(byKey((l) => l.linkId));
  /** The validity window of the reference used: the payment link's when it has one, else the quote's. */
  const windowOf = (s: TState, q: Quote) => links.find((l) => l.linkId === s.ref?.linkId) ?? q;
  const balanceLinkOpen = links.some((l) => l.kind === "balance" && !final.some((s) => s.ref?.linkId === l.linkId));
  const credited = sum(pairs.filter((p) => p.rec && p.s.inbound && p.rec.receivedBaseUnits === p.s.t.amountBaseUnits).map((p) => p.rec!.creditedMinor));
  const partOpen = balanceLinkOpen && credited > 0n && credited < inv.amountMinor && active("M4.partial.balance_link_open");
  /** Every provider record that names one of this order's quotes or links (a claim, paired with a transfer or not). */
  const claimsOfOrder = () => [...new Set([...quotes.map((q) => q.quoteId), ...links.map((l) => l.linkId)])].flatMap((id) => ix.recordsByRef.get(id) ?? []);
  // v1: a token-priced invoice's fiat value, from a recorded rate only (undefined for a fiat-priced invoice)
  const fiat = inv.price ? fiatValueOf(inv.price, cur, input, pairs.map((p) => p.s)) : undefined;
  const finish = (v: Verdict, writeOff?: WriteOffProposal) => {
    note(v.step, v.ruleId, v.decision === "matched" ? "pass" : "fail", `Decision: ${v.decision}.`);
    const open = inv.amountMinor - credited;
    let balanceState: LedgerPart["balanceState"] = credited === 0n ? "nothing_received" : partOpen ? "part_paid" : open > 0n ? "short_paid" : open < 0n ? "over_credited" : "fully_credited";
    let ledgerAmounts = { invoice: inv, openBalanceMinor: open > 0n ? open : 0n, customerOverpaymentMinor: open < 0n ? -open : 0n };
    if (inv.price && fiat) {
      // v1: a token-priced invoice is settled in its token: the balance is the token received against the price, its
      // fiat value at the recorded rate (0n when no rate is recorded: the record says so, nothing is invented; every surface
      // shows "needs a rate" for it, never 0: see fiat-value.ts)
      const got = sum(pairs.filter((p) => p.rec && p.s.inbound && p.rec.receivedBaseUnits === p.s.t.amountBaseUnits && sameToken(p.s.t, inv.price!.token)).map((p) => p.s.t.amountBaseUnits));
      const gap = inv.price.baseUnits - got;
      balanceState = got === 0n ? "nothing_received" : partOpen ? "part_paid" : gap > 0n ? "short_paid" : gap < 0n ? "over_credited" : "fully_credited";
      const valueOf = (u: bigint) => (fiat.status === "rated" ? toFiatMinor(u, fiatDecimals(inv.price!, input), fiat.rate, cur) : 0n);
      ledgerAmounts = { invoice: { ...inv, amountMinor: fiat.status === "rated" ? fiat.amountMinor : 0n }, openBalanceMinor: gap > 0n ? valueOf(gap) : 0n, customerOverpaymentMinor: gap < 0n ? valueOf(-gap) : 0n };
    }
    // Every provider claim about this order is shown, paired with a transfer or not (a claim without a transfer is not proof).
    const claims = claimsOfOrder();
    const records = [...new Set([...pairs.map((p) => p.rec).filter((r): r is ProviderPaymentRecord => !!r), ...claims])].sort(byKey((r) => r.providerPaymentId));
    const held = records.some((r) => r.statusClaim === "held_for_review" && !r.batchId);
    const batchIds = [...new Set(records.map((r) => r.batchId).filter((b): b is string => !!b))].sort();
    const record: MatchRecord = {
      label: TEST_MODE_LABEL,
      orderId: inv.orderId,
      chain: { transfers: states.filter((s) => !s.pending).map((s) => view(s, input)), pending: states.filter((s) => s.pending).map((s) => refOf(s.t)) },
      provider: { records, note: "provider statuses are claims, not proof" },
      bank: { status: held ? "held_by_provider" : batchIds.length ? "in_batch" : "not_in_batch", batchIds, bankLineIds: [], batchTied: false, settlementVerified: false, bankLineLabels: [] },
      ledger: {
        ...ledgerAmounts, creditedMinor: credited, balanceState, balanceLabel: BALANCE_LABEL[balanceState], ...(fiat ? { fiatValue: fiat } : {}),
      },
      explanation: { decision: v.decision, decidingStep: v.step, ruleId: v.ruleId, differences, history },
      ...(v.attention ? { attention: v.attention } : {}),
    };
    return { record, writeOff };
  };
  const stop = (step: Step, ruleId: RuleId, detail: string, decision: Decision = "exception") => finish({ decision, step, ruleId, attention: attentionFor(ruleId, detail) });

  /** v1: steps 4 for a token-priced invoice (steps 1–3 have passed). Typed differences, never a write-off. */
  const finishTokenPriced = () => {
    const price = inv.price!;
    const pTok = input.tokens.find((k) => sameToken({ network: k.network, tokenContract: k.contract }, price.token));
    // the provider's credit is still checked against the chain amount and its own rate (it needs no quote term)
    for (const { s, rec } of pairs) {
      const recomputed = toFiatMinor(s.t.amountBaseUnits, s.t.decimals, rec!.executedRate, cur);
      if (recomputed !== rec!.creditedMinor && active("M4.provider.credit_mismatch"))
        addDiff("unexplained", rec!.creditedMinor - recomputed, "M4.provider.credit_mismatch", `Provider credited ${fmtFiat(rec!.creditedMinor, cur)}, but ${fmtToken(s.t.amountBaseUnits, s.t.decimals, s.token!.symbol)} at ${rec!.executedRate} is ${fmtFiat(recomputed, cur)}.`);
    }
    const unexplained = differences.find((x) => x.type === "unexplained");
    if (unexplained && active("M4.tolerance.unexplained")) return stop(4, "M4.tolerance.unexplained", unexplained.reason);
    const symbol = pTok?.symbol ?? "token";
    const want = pTok ? fmtToken(price.baseUnits, pTok.decimals, pTok.symbol) : `${price.baseUnits} base units`;
    const valueOf = (u: bigint) => (fiat?.status === "rated" && pTok ? toFiatMinor(u, pTok.decimals, fiat.rate, cur) : 0n);
    const typed = (type: "price_token_mismatch" | "price_token_amount", ruleId: RuleId, net: TokenRef, decimals: number, sym: string, units: bigint, reason: string) =>
      differences.push({ id: `${inv.orderId}.D${differences.length + 1}`, type, amountMinor: type === "price_token_amount" ? valueOf(units) : 0n, currency: cur, reason, ruleId,
        token: { network: net.network, contract: net.contract, symbol: sym, decimals, baseUnits: units } });
    const wrong = pairs.filter((p) => !sameToken(p.s.t, price.token));
    for (const { s } of wrong)
      typed("price_token_mismatch", "M4.token_priced.token_mismatch", { network: s.t.network, contract: s.t.tokenContract }, s.t.decimals, s.token?.symbol ?? "unknown", s.t.amountBaseUnits,
        `The invoice is priced in ${want} on ${price.token.network}, but ${fmtToken(s.t.amountBaseUnits, s.t.decimals, s.token?.symbol ?? "unknown")} arrived on ${s.t.network}${s.t.network === price.token.network ? " (another token)" : ""}. Nothing is converted between tokens.`);
    const received = sum(pairs.filter((p) => sameToken(p.s.t, price.token)).map((p) => p.s.t.amountBaseUnits));
    const gap = received - price.baseUnits;
    if (gap !== 0n && pTok)
      typed("price_token_amount", "M4.token_priced.amount_difference", price.token, pTok.decimals, pTok.symbol, gap,
        `Received ${fmtToken(received, pTok.decimals, pTok.symbol)} against the invoice's ${want}: ${gap < 0n ? "short" : "over"} by ${fmtToken(gap < 0n ? -gap : gap, pTok.decimals, pTok.symbol)} (${gap < 0n ? -gap : gap} base units).${fiat?.status === "rated" ? "" : " Its fiat value needs a recorded rate."}`);
    const review = (ruleId: RuleId, reason: string, nextStep: string) => {
      note(4, ruleId, "fail", reason);
      return finish({ decision: "suggested_for_review", step: 4, ruleId, attention: att("Payment Operations", reason, nextStep) });
    };
    if (wrong.length && active("M4.token_priced.token_mismatch"))
      return review("M4.token_priced.token_mismatch", differences.find((d) => d.type === "price_token_mismatch")!.reason, "Agree with the customer how the invoice is settled (refund and re-pay in the invoice's token, or re-issue the invoice). Clearline never converts between tokens.");
    if (gap !== 0n && active("M4.token_priced.amount_difference"))
      return review("M4.token_priced.amount_difference", differences.find((d) => d.type === "price_token_amount")?.reason ?? `Received ${received} base units against the invoice's ${price.baseUnits}.`, gap < 0n ? "Ask the customer for the rest in the invoice's token, or decide the shortfall by hand." : "Agree with the customer whether to refund the excess or keep it as credit.");
    const blocker = exactTokenPriced(inv, price, states, pairs, quotes, links, claimsOfOrder(), input, partOpen);
    if (blocker !== undefined || !active("M4.exact.token_priced"))
      return review("M4.token_priced.not_exact", `The token amount is exact, but the payment is not closed automatically: ${blocker ?? "the rule is off"}.`, "Check the order, the provider record and the chain transfer, then decide by hand.");
    const { s, rec } = pairs[0];
    note(4, "M4.exact.token_priced", "pass", `${s.t.txHash} (read from the chain, final, ${symbol} on its configured contract on ${s.t.network}) reached the deposit address issued for ${s.ref!.linkId ?? s.ref!.quoteId}; provider record ${rec!.providerPaymentId} names it; received ${want}, exactly the invoice's price.`);
    note(4, "M4.exact.token_priced", "note", fiat?.status === "rated" ? `Fiat value ${fmtFiat(fiat.amountMinor, cur)} at ${fiat.rate} (${fiat.pair}, ${fiat.source}, ${fiat.at}).` : `Matched for cash; the fiat value needs a recorded rate: ${fiat?.status === "needs_rate" ? fiat.reason : "none"}.`);
    return finish({ decision: "matched", step: 4, ruleId: "M4.exact.token_priced" });
  };

  // Step 1a (rc7): chain data unavailable for this order's deposit addresses or transactions → never matched.
  const down = (input.chainUnavailable ?? []).filter((u) => {
    const addr = (a: string) => normAddress(u.network, a);
    const mine = [...quotes.map((q) => ({ network: q.network, address: q.depositAddress })), ...links.map((l) => ({ network: l.token.network, address: l.depositAddress }))];
    const txs = input.providerRecords.filter((r) => r.transferRef && (quotes.some((q) => q.quoteId === r.ref.quoteId) || links.some((l) => l.linkId === r.ref.linkId))).map((r) => r.transferRef!);
    return (u.address !== undefined && mine.some((m) => m.network === u.network && normAddress(m.network, m.address) === addr(u.address!)))
      || (u.txHash !== undefined && txs.some((t) => t.network === u.network && t.txHash === u.txHash));
  });
  if (down.length > 0 && active("M1.chain.unavailable")) {
    const d = down[0];
    note(1, "M1.chain.unavailable", "fail", `Chain data unavailable (${d.source}, ${d.at}): ${d.reason}`);
    return finish({ decision: "exception", step: 1, ruleId: "M1.chain.unavailable",
      attention: att("Payment Operations", `Chain data unavailable for ${down.length === 1 ? "one" : down.length} ${d.network} read${down.length === 1 ? "" : "s"} (${d.source}, ${d.at}): ${d.reason}. Nothing is treated as received or missing.`, "Clearline retries on the next run. Nothing is matched, written off or closed until the chain can be read.") });
  }

  // Step 1: identity and finality.
  for (const s of states) {
    if (s.fail) { note(1, s.fail.ruleId, "fail", s.fail.detail); return stop(1, s.fail.ruleId, s.fail.detail); }
    if (s.pending) note(1, "M1.finality.pending", "note", `${s.t.txHash} has ${s.t.confirmations} confirmations; ignored until final.`);
  }
  // rc7: a provider record whose transaction (named without a log index) has several transfers to this order's address.
  const unclear = [...quotes.map((q) => q.quoteId), ...links.map((l) => l.linkId)].flatMap((id) => ix.recordsByRef.get(id) ?? []).map((r) => ambiguous.get(r.providerPaymentId)).filter((x): x is string => !!x);
  if (unclear.length && active("M3.provider.transfer_ambiguous")) {
    note(3, "M3.provider.transfer_ambiguous", "fail", unclear[0]);
    return finish({ decision: "exception", step: 3, ruleId: "M3.provider.transfer_ambiguous", attention: att("Payment Operations", `${unclear[0]} Clearline does not choose between them.`, "Ask the provider which transfer (log index) the payment is, then upload a corrected export.") });
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
  // rc7: terms a source file did not carry. Checks that need them are not run; the order then abstains below.
  const unknownTerms = [...new Set([...quotes.flatMap((q) => q.unknown ?? []), ...(links.some((l) => l.windowUnknown) ? ["window" as const] : []),
    ...(links.some((l) => l.requestedUnknown) ? ["quoted_amount" as const] : [])])].sort();
  const knows = (term: QuoteTerm) => !unknownTerms.includes(term);
  if (inv.currency !== cur && active("M3.currency.invoice_currency")) return stop(3, "M3.currency.invoice_currency", `Invoice is in ${inv.currency}; the entity's functional currency is ${cur}.`);
  if (!inv.price && knows("rate") && knows("quoted_amount") && toFiatMinor(quote.quotedBaseUnits, qTok.decimals, quote.rate, cur) !== inv.amountMinor && active("M3.quote.invoice_mismatch"))
    return stop(3, "M3.quote.invoice_mismatch", `Quote ${quote.quoteId} at ${quote.rate} does not equal the invoice ${fmtFiat(inv.amountMinor, cur)}.`);
  for (const { s, rec } of pairs) {
    if (!s.inbound && active("M3.direction.outbound")) return stop(3, "M3.direction.outbound", `${s.t.txHash} leaves the deposit address; it is not a payment in.`);
    if (normAddress(s.t.network, s.t.tokenContract) !== normAddress(s.ref!.token.network, s.ref!.token.contract) && active("M3.currency.token_mismatch"))
      return stop(3, "M3.currency.token_mismatch", `${s.token!.symbol} arrived at an address issued for a different token.`);
    if (s.t.decimals !== qTok.decimals && active("M3.currency.token_mismatch")) return stop(3, "M3.currency.token_mismatch", `${s.token!.symbol} has ${s.t.decimals} decimals; the quote's token has ${qTok.decimals}.`);
    const ts = instantMs(s.t.timestamp);
    const w = windowOf(s, quote);
    const windowKnown = knows("window");
    if (windowKnown && ts < instantMs(w.createdAt) && active("M3.window.before_quote")) return stop(3, "M3.window.before_quote", `${s.t.txHash} predates quote ${quote.quoteId}.`);
    if (windowKnown && ts > instantMs(w.expiresAt) && rec?.statusClaim !== "re_quoted" && active("M3.window.after_expiry_no_requote"))
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
  note(3, "M3.currency.invoice_currency", "pass", unknownTerms.length ? `Currency, direction and settlement batch checked; not checkable without the quote's ${unknownTerms.join(", ")}.` : "Currency, direction, time window and settlement batch checked.");

  // v1 (Phase 0, approval-only): an invoice priced directly in a token. The price is the token amount, so no quote
  // term or rate decides anything; the conditions are decision 1's, with the token amount in place of the fiat credit.
  if (inv.price) return finishTokenPriced();

  // rc7: quote terms missing from the files. The provider's credit is still checked (it needs no quote term); the
  // rest of step 4 would need the quote's rate, amount or window, so the engine abstains instead of assuming them.
  if (unknownTerms.length && active("M3.quote.terms_unknown")) {
    for (const { s, rec } of pairs) {
      const recomputed = toFiatMinor(s.t.amountBaseUnits, s.t.decimals, rec!.executedRate, cur);
      if (recomputed !== rec!.creditedMinor && active("M4.provider.credit_mismatch")) {
        addDiff("unexplained", rec!.creditedMinor - recomputed, "M4.provider.credit_mismatch", `Provider credited ${fmtFiat(rec!.creditedMinor, cur)}, but ${fmtToken(s.t.amountBaseUnits, s.t.decimals, s.token!.symbol)} at ${rec!.executedRate} is ${fmtFiat(recomputed, cur)}.`);
      }
    }
    const unexplained = differences.find((x) => x.type === "unexplained");
    if (unexplained && active("M4.tolerance.unexplained")) return stop(4, "M4.tolerance.unexplained", unexplained.reason);
    // rc8 founder decision 1: without quote terms, only an exact payment linked by reference closes (every condition).
    if (active("M4.exact.no_quote_terms")) {
      const blocker = exactWithoutTerms(inv, cur, states, pairs, quotes, links, claimsOfOrder(), input, partOpen);
      if (blocker === undefined) {
        const { s, rec } = pairs[0];
        note(4, "M4.exact.no_quote_terms", "pass", `${s.t.txHash} (read from the chain, final, ${s.token!.symbol} on its configured contract) reached the deposit address issued for ${s.ref!.linkId ?? s.ref!.quoteId}; provider record ${rec!.providerPaymentId} names it and credited ${fmtFiat(rec!.creditedMinor, cur)}, exactly the invoice. No quote term is needed or assumed.`);
        return finish({ decision: "matched", step: 4, ruleId: "M4.exact.no_quote_terms" });
      }
      note(4, "M4.exact.no_quote_terms", "note", `Not closed without quote terms: ${blocker}.`);
    }
    const missing = unknownTerms.map((x) => (x === "quoted_amount" ? "quoted amount" : x)).join(", ");
    note(3, "M3.quote.terms_unknown", "fail", `The files do not give the quote's ${missing}.`);
    return finish({ decision: "suggested_for_review", step: 3, ruleId: "M3.quote.terms_unknown", attention: att("Payment Operations",
      `The transfer is verified on chain and the provider's credit checks out, but the files do not give quote ${quote.quoteId}'s ${missing}, so differences and timing cannot be explained. Nothing is assumed or derived.`,
      "Upload a provider export that lists the quote's rate, quoted amount and validity window (or get them from the provider), then reconcile again.") });
  }

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
  // Display text only: when the parts were paid in different tokens (USDT and USDC), name each part instead of
  // labelling their sum with the quote's token. The amounts and the decision are unchanged.
  const mixed = new Set(pairs.map((p) => p.s.token!.symbol)).size > 1;
  const paid = mixed ? `${pairs.map((p) => fmtToken(p.s.t.amountBaseUnits, p.s.t.decimals, p.s.token!.symbol)).join(" + ")} (${fmtToken(received, qTok.decimals, "together")})` : q(received);
  if (partOpen) {
    const open = links.filter((l) => l.kind === "balance" && !final.some((s) => s.ref?.linkId === l.linkId)).map((l) => l.linkId).join(", ");
    addDiff("partial_payment_open", credited - inv.amountMinor, "M4.partial.balance_link_open", `Part paid: ${fmtFiat(inv.amountMinor - credited, cur)} is still open on balance link ${open}. This is not overdue; rate and fee differences are settled when the balance arrives.`);
  } else if (d < 0n && abs(d) <= policy.senderFeeBoundBaseUnits && recs[recs.length - 1].statusClaim === "paid" && active("M4.tolerance.sender_side_fee")) {
    addDiff("sender_side_fee", tokenPart, "M4.tolerance.sender_side_fee", `Received ${paid} of ${q(quote.quotedBaseUnits)}. The ${q(-d)} gap is within the network-fee bound and the provider claims paid, so it is treated as a fee deducted on the sender's side.`);
  } else if (d < 0n && active("M4.tolerance.underpayment")) {
    addDiff("underpayment", tokenPart, "M4.tolerance.underpayment", `Customer paid ${paid} of ${q(quote.quotedBaseUnits)} (${fmtPct(d, quote.quotedBaseUnits)} short). ${fmtFiat(-tokenPart, cur)} at the quoted rate is still owed.`);
  } else if (d > 0n && active("M4.tolerance.overpayment")) {
    addDiff("overpayment", tokenPart, "M4.tolerance.overpayment", `Customer paid ${paid} against ${q(quote.quotedBaseUnits)} (${fmtPct(d, quote.quotedBaseUnits)} over). The excess is a customer-overpayment liability.`);
  } else addDiff("unexplained", tokenPart, "M4.tolerance.unexplained", `Received ${paid} against ${q(quote.quotedBaseUnits)} with no typed explanation.`);
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
  const pctBand = bpsOf(inv.amountMinor, policy.tolerancePct);
  const band = policy.toleranceCombine === "larger" ? maxBig(pctBand, policy.toleranceAbsMinor) : minBig(pctBand, policy.toleranceAbsMinor);
  const types = new Set(differences.map((x) => x.type));
  note(4, "M4.tolerance.within_band", "note", `Difference ${fmtFiat(total, cur)}; band ${policy.toleranceCombine === "larger" ? "max" : "min"}(${policy.tolerancePct} bps = ${fmtFiat(pctBand, cur)}, ${fmtFiat(policy.toleranceAbsMinor, cur)}) = ${fmtFiat(band, cur)}.`);
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

/**
 * rc8 founder decision 1 (M4.exact.no_quote_terms): may an order whose quote terms are not in the files close as
 * matched? Only when ALL hold; returns the first condition that fails (undefined = all hold). Never by amount, time or
 * sender, never with a difference of any size, and never matched_with_difference.
 */
function exactWithoutTerms(inv: Invoice, cur: Invoice["currency"], states: TState[], pairs: { s: TState; rec?: ProviderPaymentRecord }[], quotes: Quote[], links: PaymentLink[],
  claims: ProviderPaymentRecord[], input: ReconcileInput, partOpen: boolean): string | undefined {
  // one candidate only: exactly one transfer reached this order's addresses, and it is final
  if (states.length !== 1 || pairs.length !== 1) return `${states.length} transfers reached this order's addresses (${pairs.length} final); exactly one final transfer is needed`;
  const { s, rec } = pairs[0];
  if (!rec) return "no provider record names this transfer";
  const n = s.t.network;
  // guard (a): linked by reference. The transfer reached a deposit address issued for this order; the one provider record
  // that names this order names that same quote or link, and (if it names a transaction) this very transfer.
  const byRef = s.ref !== undefined && s.ref.orderId === inv.orderId && (s.ref.linkId !== undefined
    ? rec.ref.linkId === s.ref.linkId && links.some((l) => l.linkId === rec.ref.linkId)
    : rec.ref.linkId === undefined && rec.ref.quoteId === s.ref.quoteId && quotes.some((q) => q.quoteId === rec.ref.quoteId));
  if (!byRef || claims.length !== 1 || claims[0] !== rec || (rec.transferRef !== undefined && tkey(rec.transferRef) !== tkey(s.t)))
    return claims.length !== 1 ? `${claims.length} provider records name this order; exactly one is needed` : "the provider record is not linked to this transfer by the order's own reference";
  // guard (b): a chain fact Clearline read itself, final, inbound, on the configured contract of the order's token
  if (s.t.source !== "chain_client") return `the transfer is ${s.t.source ? `a ${s.t.source.replace("_", " ")} record` : "not marked as read from the chain"}, not a fact Clearline read from the chain`;
  if (s.pending || !s.inbound || !s.token || s.token.network !== s.ref!.token.network || normAddress(n, s.token.contract) !== normAddress(n, s.ref!.token.contract) || s.t.decimals !== s.token.decimals)
    return "the transfer is not a final inbound transfer on the configured contract of this order's token";
  // no refund, partial or balance payment, and the provider claims paid
  if (rec.statusClaim !== "paid") return `the provider's status is ${rec.statusClaim}, not paid`;
  if (partOpen || links.some((l) => l.kind === "balance")) return "the order has a balance payment link (part payment)";
  if (input.batchLines.some((l) => l.kind === "refund" && l.orderId === inv.orderId)) return "a refund is recorded for this order";
  if (inv.status === "void") return "the invoice is void";
  // guard (c): the provider's credit equals the invoice exactly, in the same currency, to the minor unit
  if (rec.creditedCurrency === undefined || rec.creditedCurrency !== inv.currency || inv.currency !== cur) return `the provider's credited currency (${rec.creditedCurrency ?? "not given"}) is not the invoice's ${inv.currency}`;
  if (rec.creditedMinor !== inv.amountMinor) return `credited ${fmtFiat(rec.creditedMinor, cur)} is not exactly the invoice ${fmtFiat(inv.amountMinor, cur)}`;
  return undefined;
}

const sameToken = (t: { network: NetworkId; tokenContract: string }, ref: TokenRef): boolean =>
  t.network === ref.network && normAddress(t.network, t.tokenContract) === normAddress(ref.network, ref.contract);
const fiatDecimals = (price: InvoiceTokenPrice, input: ReconcileInput): number =>
  input.tokens.find((k) => sameToken({ network: k.network, tokenContract: k.contract }, price.token))?.decimals ?? 0;
/** [ASSUMPTION, for sign-off] a rate is usable for a payment only when recorded at most this long before it. */
export const TOKEN_PRICE_RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * v1: the fiat accounting value of a token-priced invoice, from a RECORDED rate only (ReconcileInput.fxRates, pair
 * "<symbol>/<currency>"): the latest rate observed at or before the payment's final transfer, at most
 * TOKEN_PRICE_RATE_MAX_AGE_MS earlier. No payment yet, no such rate, or two recorded rates at that instant that disagree:
 * "needs_rate". A rate is never derived from the provider's credit, a quote or another pair.
 */
export function fiatValueOf(price: InvoiceTokenPrice, cur: Invoice["currency"], input: ReconcileInput, paid: readonly { t: ChainTransfer }[]): NonNullable<LedgerPart["fiatValue"]> {
  const tok = input.tokens.find((k) => sameToken({ network: k.network, tokenContract: k.contract }, price.token));
  const pair = `${tok?.symbol ?? "?"}/${cur}`;
  if (!tok) return { status: "needs_rate", pair, reason: "the invoice's token is not a configured token" };
  const at = paid.filter((p) => sameToken(p.t, price.token)).map((p) => instantMs(p.t.timestamp)).sort((a, b) => b - a)[0];
  if (at === undefined) return { status: "needs_rate", pair, reason: "no final payment in the invoice's token yet (the value is taken at the payment's time)" };
  const usable = input.fxRates.filter((r) => r.pair === pair && instantMs(r.timestamp) <= at && at - instantMs(r.timestamp) <= TOKEN_PRICE_RATE_MAX_AGE_MS);
  if (usable.length === 0) return { status: "needs_rate", pair, reason: `no ${pair} rate is recorded in the 24 hours up to the payment` };
  const latest = Math.max(...usable.map((r) => instantMs(r.timestamp)));
  const tied = usable.filter((r) => instantMs(r.timestamp) === latest);
  if (tied.some((r) => !sameRate(r.rate, tied[0].rate))) return { status: "needs_rate", pair, reason: `two recorded ${pair} rates at the same time disagree; Clearline does not choose` };
  const r = [...tied].sort(byKey((x) => x.source))[0];
  return { status: "rated", amountMinor: toFiatMinor(price.baseUnits, tok.decimals, r.rate, cur), pair, rate: r.rate, source: r.source, at: r.timestamp };
}

/**
 * v1 (M4.exact.token_priced): may a token-priced order whose token amount is exact close as matched? The same
 * conditions as decision 1 (exactWithoutTerms), with the token itself in place of the fiat credit: returns the first
 * condition that fails (undefined = all hold). Never by amount, time or sender.
 */
function exactTokenPriced(inv: Invoice, price: InvoiceTokenPrice, states: TState[], pairs: { s: TState; rec?: ProviderPaymentRecord }[], quotes: Quote[], links: PaymentLink[],
  claims: ProviderPaymentRecord[], input: ReconcileInput, partOpen: boolean): string | undefined {
  if (states.length !== 1 || pairs.length !== 1) return `${states.length} transfers reached this order's addresses (${pairs.length} final); exactly one final transfer is needed`;
  const { s, rec } = pairs[0];
  if (!rec) return "no provider record names this transfer";
  const n = s.t.network;
  // linked by reference: the order's own deposit address, and the one provider record naming the order names it too
  const byRef = s.ref !== undefined && s.ref.orderId === inv.orderId && (s.ref.linkId !== undefined
    ? rec.ref.linkId === s.ref.linkId && links.some((l) => l.linkId === rec.ref.linkId)
    : rec.ref.linkId === undefined && rec.ref.quoteId === s.ref.quoteId && quotes.some((q) => q.quoteId === rec.ref.quoteId));
  if (!byRef || claims.length !== 1 || claims[0] !== rec || (rec.transferRef !== undefined && tkey(rec.transferRef) !== tkey(s.t)))
    return claims.length !== 1 ? `${claims.length} provider records name this order; exactly one is needed` : "the provider record is not linked to this transfer by the order's own reference";
  // a chain fact Clearline read itself, final, inbound, on the configured contract of exactly the invoice's token
  if (s.t.source !== "chain_client") return `the transfer is ${s.t.source ? `a ${s.t.source.replace("_", " ")} record` : "not marked as read from the chain"}, not a fact Clearline read from the chain`;
  if (s.pending || !s.inbound || !s.token || !sameToken({ network: s.token.network, tokenContract: s.token.contract }, price.token) || !sameToken(s.t, price.token)
    || s.token.network !== s.ref!.token.network || normAddress(n, s.token.contract) !== normAddress(n, s.ref!.token.contract) || s.t.decimals !== s.token.decimals)
    return "the transfer is not a final inbound transfer on the configured contract of the invoice's token";
  if (rec.receivedBaseUnits !== s.t.amountBaseUnits || s.t.amountBaseUnits !== price.baseUnits) return "the amount received is not exactly the invoice's token amount";
  // a quote whose own amount is known must agree with the price (it never overrides it)
  const quote = quotes.find((q) => q.quoteId === s.ref!.quoteId);
  if (quote && !(quote.unknown ?? []).includes("quoted_amount") && quote.quotedBaseUnits !== price.baseUnits) return "the quote's token amount differs from the invoice's price";
  if (rec.statusClaim !== "paid") return `the provider's status is ${rec.statusClaim}, not paid`;
  if (partOpen || links.some((l) => l.kind === "balance")) return "the order has a balance payment link (part payment)";
  if (input.batchLines.some((l) => l.kind === "refund" && l.orderId === inv.orderId)) return "a refund is recorded for this order";
  if (inv.status === "void") return "the invoice is void";
  return undefined;
}

function view(s: TState, input: ReconcileInput): ChainTransferView {
  const factsOf = (a: string) => input.addressFacts.filter((f) => f.network === s.t.network && normAddress(f.network, f.address) === normAddress(s.t.network, a)).map((f) => f.fact);
  const pathFacts = (s.t.priorHops ?? []).flatMap((h) => [h.from, h.to]).filter((a, i, xs) => xs.indexOf(a) === i).map((address) => ({ address, facts: factsOf(address) }));
  return { ...s.t, symbol: s.token?.symbol ?? "unknown", senderFacts: factsOf(s.t.from), pathFacts, ...(s.ref?.linkId ? { linkId: s.ref.linkId } : {}), ...(s.ref ? { quoteId: s.ref.quoteId } : {}) };
}

/** Steps 1–4 over every order and transfer. Output order is canonical (order id, then transfer key). */
export function matchPayments(raw: ReconcileInput): MatchOutput {
  const { input, ambiguous } = resolveClaimedTransfers(raw);
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
  const ix = indexesOf(input);
  const orderIds = new Set(input.providerRecords.flatMap((r) => [r.ref.quoteId, r.ref.linkId]).map((id) => (id === undefined ? undefined : ix.quoteById.get(id)?.orderId ?? ix.linkById.get(id)?.orderId)));
  const statesByOrder = new Map<string, TState[]>();
  for (const s of states) if (s.ref?.orderId !== undefined) { const a = statesByOrder.get(s.ref.orderId); if (a) a.push(s); else statesByOrder.set(s.ref.orderId, [s]); }
  for (const inv of [...input.invoices].sort(byKey((i) => i.orderId))) {
    const mine = statesByOrder.get(inv.orderId) ?? [];
    if (mine.length === 0 && !orderIds.has(inv.orderId)) continue;
    const { record, writeOff } = evaluateOrder(inv, mine, input, ambiguous);
    records.push(record);
    if (writeOff) writeOffs.push(writeOff);
    if (record.explanation.decision === "exception")
      exceptions.push({ id: `EX-${inv.orderId}`, step: record.explanation.decidingStep, ruleId: record.explanation.ruleId, orderId: inv.orderId, ...record.attention! });
  }
  return { records, transferFindings, exceptions: exceptions.sort(byKey((e) => e.id)), writeOffs };
}
