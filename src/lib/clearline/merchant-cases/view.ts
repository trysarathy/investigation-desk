/**
 * rc6 public cases demo (/clearline/cases): the view model of the three merchant-reconciliation cases.
 * Every figure comes from reconcile() and proposeJournals() run on the fixtures; nothing here hard-codes an amount.
 * Pure and deterministic: no I/O, no clock. Test mode · illustrative data; every name is fictional.
 */
import {
  JOURNAL_RULES, MERCHANT_ACCOUNTS, NETWORKS, RULES, TEST_MODE_LABEL, fmtFiat, fmtToken, proposeJournals, reconcile,
  type AddressFact, type BatchBridge, type BridgeLine, type ChainTransferView, type Decision, type DifferenceType, type FiatCurrency,
  type JournalProposal, type MatchRecord, type ReconcileInput, type ReconcileResult,
} from "../merchant";
import { sum } from "../merchant/amounts";
import { case1 } from "../merchant/fixtures/case1";
import { case2Sgd, case2Usd } from "../merchant/fixtures/case2";
import { case3, case3AfterPart1 } from "../merchant/fixtures/case3";
import { CASE_SHORT, CASE_SLUGS, type CaseSlug } from "./slugs";

export { CASE_SLUGS, CASE_SHORT, isCaseSlug, type CaseSlug } from "./slugs";
export const LABEL = TEST_MODE_LABEL;

/** One set of books: one entity's input, its reconciliation and its proposed journal entries. */
export interface Book { key: string; title: string; input: ReconcileInput; result: ReconcileResult; journals: JournalProposal[] }

export interface CaseModel {
  slug: CaseSlug;
  number: 1 | 2 | 3;
  title: string;
  short: string;
  lede: string;
  books: Book[];
  /** Case 3 only: the state after part 1, before the balance link is paid. */
  afterPart1?: Book;
}

const book = (key: string, title: string, input: ReconcileInput): Book => {
  const result = reconcile(input);
  return { key, title, input, result, journals: proposeJournals(input, result) };
};

const DEFS: Record<CaseSlug, () => Omit<CaseModel, "slug" | "short">> = {
  "amount-differences": () => ({
    number: 1,
    title: "Amount differences",
    lede: "Four orders paid in stablecoins to one Singapore merchant (fictional). Each payment arrived with a different kind of difference: a fee taken on the sender's side, a short payment, an overpayment and a payment made after its quote expired.",
    books: [book("sgd", "SGD books", case1())],
  }),
  "one-settlement": () => ({
    number: 2,
    title: "One settlement, many payments",
    lede: "One bank credit covers many payments. The provider's day is UTC and the merchant's day is Singapore time, so the merchant's day and the settlement batch do not hold the same orders. The bridge shows every step from one to the other.",
    books: [book("sgd", "SGD account", case2Sgd()), book("usd", "USD account", case2Usd())],
  }),
  "partial-payment": () => ({
    number: 3,
    title: "Partial payment across chains",
    lede: "One UAE invoice paid in two parts, through two payment links, on two networks, in two tokens. The second part came from an exchange; the first came through an intermediate wallet.",
    books: [book("aed", "AED books", case3())],
    afterPart1: book("aed-part1", "AED books after part 1", case3AfterPart1()),
  }),
};

const cache = new Map<CaseSlug, CaseModel>();
export function caseModel(slug: CaseSlug): CaseModel {
  let m = cache.get(slug);
  if (!m) { m = { slug, short: CASE_SHORT[slug], ...DEFS[slug]() }; cache.set(slug, m); }
  return m;
}
export const allCases = (): CaseModel[] => CASE_SLUGS.map(caseModel);

// ---------- wording ----------

export const DECISION_TEXT: Record<Decision, string> = {
  matched: "Matched",
  matched_with_difference: "Matched with a difference",
  suggested_for_review: "Suggested for review",
  exception: "Exception",
};
/** Colour tone per decision: green only for an evidenced match; amber while a person must act; red for an exception. */
export const DECISION_TONE: Record<Decision, "ok" | "warn" | "bad"> = { matched: "ok", matched_with_difference: "warn", suggested_for_review: "warn", exception: "bad" };

export const DIFFERENCE_TEXT: Record<DifferenceType, string> = {
  sender_side_fee: "Fee taken on the sender's side",
  underpayment: "Underpayment",
  overpayment: "Overpayment",
  requote_after_expiry: "Re-quote after the quote expired",
  rate_difference: "Rate difference",
  provider_fee: "Provider fee",
  refund_netted: "Refund netted from the settlement",
  timing_prior_batch: "Settled in the prior batch",
  timing_next_batch: "Next-day order in this batch",
  held_by_provider: "Held by the provider",
  partial_payment_open: "Part paid, balance open",
  unexplained: "Unexplained",
};

export const FACT_TEXT: Record<AddressFact["fact"], string> = {
  registered_wallet: "Registered wallet",
  intermediate_wallet: "Intermediate wallet",
  exchange_hot_wallet: "Exchange hot wallet",
  unknown: "No recorded fact",
};

export const ACCOUNT_TEXT = MERCHANT_ACCOUNTS;
export const ruleText = (id: string): string => (RULES as Record<string, { text: string }>)[id]?.text ?? (JOURNAL_RULES as Record<string, { text: string }>)[id]?.text ?? "";
export const networkName = (id: string): string => NETWORKS.find((n) => n.network === id)?.name ?? id;

export const JOURNAL_KIND_TEXT: Record<JournalProposal["kind"], string> = {
  provider_confirmation: "Provider confirmation",
  approved_writeoff: "Write-off (after approval)",
  settlement: "Settlement",
};
export const POSTING_RULE_PENDING = "Posting rule pending sign-off";

// ---------- amounts ----------

export const money = (minor: bigint, currency: FiatCurrency): string => fmtFiat(minor, currency);
/** "SGD −9.99", "SGD +100.00", "SGD 0.00" (a true minus sign; the plus is shown for additions). */
export function signedMoney(minor: bigint, currency: FiatCurrency): string {
  if (minor === 0n) return fmtFiat(0n, currency);
  const body = fmtFiat(minor < 0n ? -minor : minor, currency).slice(currency.length + 1);
  return `${currency} ${minor < 0n ? "−" : "+"}${body}`;
}
export const tokenAmount = (t: ChainTransferView): string => fmtToken(t.amountBaseUnits, t.decimals, t.symbol);

// ---------- summary ----------

export interface Figure { label: string; value: string; note?: string; testId: string }

export function decisionCounts(b: Book): { decision: Decision; count: number }[] {
  return (Object.keys(DECISION_TEXT) as Decision[]).map((decision) => ({ decision, count: b.result.records.filter((r) => r.explanation.decision === decision).length })).filter((x) => x.count > 0);
}

export const bookCurrency = (b: Book): FiatCurrency => b.input.entity.functionalCurrency;
const netOf = (br: BatchBridge): bigint => br.lines.find((l) => l.kind === "net")!.amountMinor;

export function summaryFigures(b: Book): Figure[] {
  const cur = bookCurrency(b);
  const recs = b.result.records;
  const invoiced = sum(recs.map((r) => r.ledger.invoice.amountMinor));
  const credited = sum(recs.map((r) => r.ledger.creditedMinor));
  const fees = sum(b.result.bridges.map((br) => -br.lines.find((l) => l.kind === "provider_fee")!.amountMinor));
  const net = sum(b.result.bridges.map(netOf));
  const owed = sum(recs.map((r) => r.ledger.openBalanceMinor));
  const liability = sum(recs.map((r) => r.ledger.customerOverpaymentMinor));
  const writeOffs = sum(b.result.writeOffs.map((w) => w.amountMinor));
  const out: Figure[] = [
    { label: "Orders", value: String(recs.length), testId: "fig-orders" },
    { label: "Invoiced", value: money(invoiced, cur), testId: "fig-invoiced" },
    { label: "Credited by the provider", value: money(credited, cur), testId: "fig-credited" },
    { label: "Provider fees", value: money(fees, cur), testId: "fig-fees" },
    { label: "Net bank credit", value: money(net, cur), note: b.result.bridges.map((br) => `${br.batchId} → ${br.bankLineId ?? "no bank line"}`).join("; "), testId: "fig-net" },
    { label: "Open on invoices", value: money(owed, cur), note: "Still owed by customers, before any write-off.", testId: "fig-owed" },
  ];
  if (liability > 0n) out.push({ label: "Customer overpayments (liability)", value: money(liability, cur), testId: "fig-liability" });
  out.push({ label: "Write-offs proposed", value: money(writeOffs, cur), note: writeOffs > 0n ? "Each needs approval by a second person." : undefined, testId: "fig-writeoffs" });
  out.push({ label: "Exceptions", value: String(b.result.exceptions.length), testId: "fig-exceptions" });
  return out;
}

// ---------- Case 2: the waterfall ----------

export interface WaterfallLine extends BridgeLine { total: boolean; startMinor: bigint; endMinor: bigint; display: string }

/** The bridge as a waterfall: totals (merchant day, gross, net) stand on zero; every other line floats on the running total. */
export function waterfall(br: BatchBridge): { lines: WaterfallLine[]; maxMinor: bigint } {
  let running = 0n;
  const lines = br.lines.map((l): WaterfallLine => {
    const total = l.kind === "merchant_day" || l.kind === "gross" || l.kind === "net";
    const start = total ? 0n : running;
    const end = total ? l.amountMinor : running + l.amountMinor;
    running = end;
    return { ...l, total, startMinor: start, endMinor: end, display: total ? money(l.amountMinor, br.currency) : signedMoney(l.amountMinor, br.currency) };
  });
  const maxMinor = lines.reduce((m, l) => (l.startMinor > m ? l.startMinor : l.endMinor > m ? l.endMinor : m), 1n);
  return { lines, maxMinor };
}
/** Percentage (0–100, two decimals) of `minor` against `max`, for drawing only. */
export const pct = (minor: bigint, max: bigint): number => Number((minor * 10_000n) / max) / 100;

// ---------- Case 3: the flow ----------

export interface FlowPart {
  part: number;
  transfer: ChainTransferView;
  linkId: string;
  linkKind: string;
  network: string;
  /** Path as recorded: every address with its recorded facts, ending at the deposit address of the link. */
  nodes: { address: string; facts: string[]; role: "sender" | "hop" | "deposit" }[];
  hops: { from: string; to: string; txHash: string }[];
  provider: { id: string; claim: string; credited: string; rate: string; batchId?: string };
}

export function flow(b: Book): FlowPart[] {
  const rec = b.result.records[0];
  const cur = bookCurrency(b);
  const links = b.input.paymentLinks;
  return [...rec.chain.transfers].sort((x, y) => ((x.linkId ?? "") < (y.linkId ?? "") ? -1 : 1)).map((t, i) => {
    const link = links.find((l) => l.linkId === t.linkId);
    const p = rec.provider.records.find((r) => r.transferRef?.txHash === t.txHash)!;
    const factsOf = (a: string) => b.input.addressFacts.filter((f) => f.network === t.network && f.address === a).map((f) => FACT_TEXT[f.fact]);
    const hops = [...(t.priorHops ?? [])];
    const nodes: FlowPart["nodes"] = [];
    if (hops.length) {
      nodes.push({ address: hops[0].from, facts: factsOf(hops[0].from), role: "sender" });
      for (const h of hops) nodes.push({ address: h.to, facts: factsOf(h.to), role: "hop" });
    } else nodes.push({ address: t.from, facts: factsOf(t.from), role: "sender" });
    nodes.push({ address: t.to, facts: [`Deposit address of ${t.linkId}`], role: "deposit" });
    return {
      part: i + 1, transfer: t, linkId: t.linkId ?? "", linkKind: link?.kind === "balance" ? "balance link" : "payment link", network: networkName(t.network), nodes, hops,
      provider: { id: p.providerPaymentId, claim: p.statusClaim, credited: money(p.creditedMinor, cur), rate: p.executedRate, ...(p.batchId ? { batchId: p.batchId } : {}) },
    };
  });
}

// ---------- items ----------

/** Records that a person must look at (anything other than a clean match), first. */
export const needsAttention = (r: MatchRecord): boolean => r.explanation.decision !== "matched";
