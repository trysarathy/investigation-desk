/**
 * v1 phase 4: the posting-rules CATALOGUE a merchant Admin signs. Pure and deterministic. Every journal pattern of
 * Document A and docs/POSTING_RULES.md is listed with its status; every worked example is GENERATED here by running
 * the engine's own code paths on fictional inputs (proposeJournals on the Document A case fixtures, proposeRevaluations,
 * the fx.ts and amounts.ts conversions), never typed by hand. The version is the SHA-256 of the canonical catalogue, so
 * any change to a pattern, a text or an engine result is a new version that needs a new signature.
 *
 * Signing records that a named Admin read and accepted this version. It changes no matching rule, approves no journal
 * and posts nothing: every journal still needs its own approval, and the database still refuses any journal proposal
 * status other than "pending_sign_off" until a separate, approval-only change.
 */
import { toFiatMinor, fmtFiat } from "./amounts";
import { case1 } from "./fixtures/case1";
import { case2Sgd } from "./fixtures/case2";
import { valueIn } from "./fx";
import { MERCHANT_ACCOUNTS, proposeJournals, type JournalProposal } from "./journal";
import { reconcile } from "./reconcile";
import { proposeRevaluations } from "./revaluation";
import { sha256Hex } from "../sha256";
import type { FiatCurrency, FiatRate, MerchantEntity } from "./types";

/** Accounts the drafted (not built) patterns need beyond MERCHANT_ACCOUNTS. */
const DRAFT_ACCOUNTS = { realised_fx: "Realised FX gain/loss", revenue: "Revenue", bank_usd: "Bank (USD account)" } as const;
const accountName = (k: string) => (MERCHANT_ACCOUNTS as Record<string, string>)[k] ?? (DRAFT_ACCOUNTS as Record<string, string>)[k] ?? k;

export type PatternStatus =
  | "built_pending_sign_off"   // the engine proposes it today (status proposed, pending sign-off)
  | "drafted_not_built"        // written for sign-off; the engine proposes nothing for it
  | "listed_by_reference";     // an earlier product's rule (docs/POSTING_RULES.md §4): listed, no example generated here

export interface ExampleLine { side: "debit" | "credit"; account: string; accountName: string; amountMinor: string; amount: string; onApproval?: string }
export interface WorkedExample { title: string; currency: FiatCurrency; entryDate: string | null; source: string; memo: string; lines: ExampleLine[]; balanced: boolean; noEntry?: string }
export interface PostingPattern { id: string; group: "document_a" | "fx" | "token_priced" | "receipts"; title: string; when: string; debit: string; credit: string; status: PatternStatus; reference: string; engine: string | null; examples: WorkedExample[] }
export interface PostingRulesCatalogue { version: string; sha256: string; patterns: PostingPattern[]; note: string }

type L = { side: "debit" | "credit"; account: string; amountMinor: bigint; onApproval?: string };
function example(title: string, currency: FiatCurrency, entryDate: string | null, source: string, memo: string, lines: L[]): WorkedExample {
  const total = (s: "debit" | "credit") => lines.filter((l) => l.side === s).reduce((t, l) => t + l.amountMinor, 0n);
  return {
    title, currency, entryDate, source, memo, balanced: total("debit") === total("credit"),
    lines: lines.map((l) => ({ side: l.side, account: l.account, accountName: accountName(l.account), amountMinor: l.amountMinor.toString(), amount: fmtFiat(l.amountMinor, currency), ...(l.onApproval ? { onApproval: l.onApproval } : {}) })),
  };
}
const fromProposal = (title: string, p: JournalProposal, source: string) => example(title, p.currency, p.entryDate, source, p.memo, p.lines.map((l) => ({ side: l.side, account: l.account, amountMinor: l.amountMinor, onApproval: l.onApproval })));

/** Fictional SGD entity of the FX examples (docs/POSTING_RULES.md, "Other-currency bank accounts"). */
const NW_SG: MerchantEntity = { id: "NW-SG", name: "Northwind SG (fictional)", functionalCurrency: "SGD", ledger: "LEDGER-NW-SG", timeZone: { name: "Asia/Singapore", utcOffsetMinutes: 480 } };
const RATE_DESK = "Fictional Rate Desk";
const rate = (pair: string, r: string, asOf: string): FiatRate => ({ pair, rate: r, asOf, source: RATE_DESK });

function documentA(): PostingPattern[] {
  const j1 = proposeJournals(case1(), reconcile(case1()));
  const j2 = proposeJournals(case2Sgd(), reconcile(case2Sgd()));
  const pick = (js: JournalProposal[], id: string) => { const p = js.find((x) => x.id === id); if (!p) throw new Error(`catalogue: the engine no longer proposes ${id}`); return p; };
  const src = (fixture: string) => `proposeJournals(${fixture}) in src/lib/clearline/merchant/journal.ts`;
  const base = { group: "document_a" as const, status: "built_pending_sign_off" as const };
  return [
    { ...base, id: "J.confirmation.chain_evidenced", title: "Payment confirmed by the provider and evidenced on chain", when: "A provider record backed by a final, referenced inbound transfer that agrees with the chain.", debit: "Provider clearing (credited)", credit: "Accounts receivable", reference: "Document A §3; docs/POSTING_RULES.md, Merchant reconciliation patterns", engine: "journal.ts proposeJournals",
      examples: [fromProposal("BK-24823: 2,376.00 confirmed, 324.00 stays open", pick(j1, "JP-CONF-PP-24823"), src("case 1"))] },
    { ...base, id: "J.confirmation.overpayment_liability", title: "… with an overpayment", when: "The provider credited more than the invoice.", debit: "Provider clearing", credit: "Accounts receivable (up to the invoice); Customer overpayments (liability)", reference: "Document A §3", engine: "journal.ts proposeJournals",
      examples: [fromProposal("BK-24830: overpaid by 145.80", pick(j1, "JP-CONF-PP-24830"), src("case 1"))] },
    { ...base, id: "J.writeoff.on_approval", title: "… closing the invoice with a difference (on approval)", when: "An engine-proposed write-off (two-person approval) or a re-quote / rate difference sent to the controller.", debit: "Provider clearing (credited); Payment shortfall expense or Re-quote / rate difference (on approval)", credit: "Accounts receivable (up to the invoice)", reference: "Document A §3–§5", engine: "journal.ts proposeJournals",
      examples: [fromProposal("BK-24817: shortfall 1.35, after write-off approval", pick(j1, "JP-CONF-PP-24817"), src("case 1")), fromProposal("BK-24836: re-quote 9.00, after the controller's resolution", pick(j1, "JP-CONF-PP-24836"), src("case 1"))] },
    { ...base, id: "J.settlement.refund_netted", title: "Refund netted in a settlement", when: "The provider paid a customer's refund out of a verified settlement.", debit: "Sales refunds", credit: "Provider clearing", reference: "Document A, Case 2", engine: "journal.ts proposeJournals",
      examples: [fromProposal("Refund BK-24788 netted in B-1125-SGD", pick(j2, "JP-RFND-B-1125-SGD"), src("case 2, SGD"))] },
    { ...base, id: "J.settlement.verified_batch", title: "Settlement (verified bank line only)", when: "A batch tied to the cent and verified against a bank line (an imported-only line gets no entry).", debit: "Bank (net); Payment processing fees", credit: "Provider clearing (gross − refunds)", reference: "Document A §3–§5", engine: "journal.ts proposeJournals",
      examples: [fromProposal("B-1124-001 settles to the SGD account", pick(j1, "JP-SETL-B-1124-001"), src("case 1"))] },
  ];
}

function fx(): PostingPattern[] {
  const SRC = "valueIn / convertMinor in src/lib/clearline/merchant/fx.ts";
  const conf = "2026-11-25", setl = "2026-11-26";
  const rates = [rate("USD/SGD", "1.3500", "2026-11-25T01:00:00.000Z"), rate("USD/SGD", "1.3600", "2026-11-26T01:00:00.000Z")];
  const at = (d: string) => `${d}T08:00:00.000Z`;
  const v = (minor: bigint, d: string) => { const x = valueIn(minor, "USD", "SGD", rates, at(d)); if (x.status !== "rated") throw new Error("catalogue: FX example has no rate"); return x; };
  const credit = v(100000n, conf);
  const net = v(99000n, setl), fee = v(1000n, setl);
  const gain = net.amountMinor + fee.amountMinor - credit.amountMinor;
  const fx1 = example("USD 1,000.00 credited by the provider to the SGD entity", "SGD", conf, SRC, `USD 1,000.00 at ${credit.pair} ${credit.rate} (${credit.source}).`,
    [{ side: "debit", account: "provider_clearing", amountMinor: credit.amountMinor }, { side: "credit", account: "accounts_receivable", amountMinor: credit.amountMinor }]);
  const fx2 = example("The batch settles to the USD account: net USD 990.00, fee USD 10.00", "SGD", setl, SRC, `Settlement rate ${net.pair} ${net.rate}; provider clearing carried at ${fmtFiat(credit.amountMinor, "SGD")}.`, [
    { side: "debit", account: "bank_usd", amountMinor: net.amountMinor }, { side: "debit", account: "payment_processing_fees", amountMinor: fee.amountMinor },
    { side: "credit", account: "provider_clearing", amountMinor: credit.amountMinor },
    gain >= 0n ? { side: "credit", account: "realised_fx", amountMinor: gain } : { side: "debit", account: "realised_fx", amountMinor: -gain },
  ].filter((l) => l.amountMinor !== 0n) as L[]);
  const closing = [rate("USD/SGD", "1.3600", "2026-11-30T09:00:00.000Z")];
  const rv = proposeRevaluations(NW_SG, "2026-11-30", [
    { account: "provider_clearing", currency: "USD", foreignMinor: 100000n, carryingMinor: 135000n, ref: "gain example" },
    { account: "provider_clearing", currency: "USD", foreignMinor: 100000n, carryingMinor: 136500n, ref: "loss example" },
  ], closing);
  const none = proposeRevaluations(NW_SG, "2026-11-30", [{ account: "provider_clearing", currency: "USD", foreignMinor: 100000n, carryingMinor: 135000n, ref: "no rate" }], []);
  const noRate = none.items[0].status === "needs_rate" ? none.items[0].reason : "needs a rate";
  const RV = "proposeRevaluations in src/lib/clearline/merchant/revaluation.ts";
  return [
    { id: "FX1", group: "fx", title: "Payment confirmed in another currency (USD credit, SGD entity)", when: "The provider credits USD to an SGD entity.", debit: "Provider clearing (USD × spot rate)", credit: "Accounts receivable", status: "drafted_not_built", reference: "docs/POSTING_RULES.md, Other-currency bank accounts (decision 9)", engine: null, examples: [fx1] },
    { id: "FX2", group: "fx", title: "Settlement to the USD bank account (realised FX)", when: "A USD batch settles to the USD account of an SGD entity.", debit: "Bank (USD account) × settlement rate; Payment processing fees × settlement rate", credit: "Provider clearing at carrying value; Realised FX gain (or Dr Realised FX loss)", status: "drafted_not_built", reference: "docs/POSTING_RULES.md, Other-currency bank accounts", engine: null, examples: [fx2] },
    { id: "J.revaluation.period_end", group: "fx", title: "FX3 Period end, still open (unrealised FX)", when: "An other-currency balance is still open at the period's end; latest recorded rate at most 24 h before the end (entity zone).", debit: "Provider clearing / Unrealised FX loss", credit: "Unrealised FX gain / Provider clearing", status: "built_pending_sign_off", reference: "docs/POSTING_RULES.md, Other-currency bank accounts", engine: "revaluation.ts proposeRevaluations",
      examples: [...rv.proposals.map((p) => fromProposal(p.lines[0].account === "unrealised_fx" ? "Unrealised loss: carried at SGD 1,365.00, closing 1.3600" : "Unrealised gain: carried at SGD 1,350.00, closing 1.3600", p, RV)),
        { title: "No usable rate: no entry", currency: "SGD", entryDate: null, source: RV, memo: noRate, lines: [], balanced: true, noEntry: "needs a rate" }] },
  ];
}

function tokenPriced(): PostingPattern[] {
  const SRC = "toFiatMinor in src/lib/clearline/merchant/amounts.ts";
  const ex = (tag: string, units: bigint, rInv: string, rSet: string, rProv: string) => {
    const inv = toFiatMinor(units, 6, rInv, "SGD"), set = toFiatMinor(units, 6, rSet, "SGD"), c = toFiatMinor(units, 6, rProv, "SGD");
    const fxd = set - inv, rated = c - set;
    const e1 = example(`${tag}: invoice recognised at ${rInv}`, "SGD", null, SRC, "Entry 1 (drafted, not built).", [{ side: "debit", account: "accounts_receivable", amountMinor: inv }, { side: "credit", account: "revenue", amountMinor: inv }]);
    const e2 = example(`${tag}: settled (recorded ${rSet}, provider ${rProv})`, "SGD", null, SRC, "Entry 2 (drafted, not built). Realised FX and the rate difference stay two typed lines.", ([
      { side: "debit", account: "provider_clearing", amountMinor: c },
      fxd < 0n ? { side: "debit", account: "realised_fx", amountMinor: -fxd } : { side: "credit", account: "realised_fx", amountMinor: fxd },
      rated < 0n ? { side: "debit", account: "requote_rate_difference", amountMinor: -rated, onApproval: "rate difference review" } : { side: "credit", account: "requote_rate_difference", amountMinor: rated, onApproval: "rate difference review" },
      { side: "credit", account: "accounts_receivable", amountMinor: inv },
    ] as L[]).filter((l) => l.amountMinor !== 0n));
    return [e1, e2];
  };
  return [{ id: "TP.realised_fx", group: "token_priced", title: "Token-priced invoice: realised FX gain or loss at settlement (IAS 21 pattern)", when: "An invoice priced in a fixed number of stablecoin units, MATCHED (exact token amount, by reference, final, verified contract).",
    debit: "Accounts receivable at recognition; Provider clearing; Realised FX loss; Rate difference (on approval)", credit: "Revenue; Accounts receivable; Realised FX gain", status: "drafted_not_built", reference: "docs/POSTING_RULES.md, Token-priced invoices (v1 #173); open question Q-TP1", engine: null,
    examples: [...ex("TP-0001, 1,000 USDT", 1_000_000_000n, "1.3500", "1.3420", "1.3410"), ...ex("TP-0002, 2,500 USDT", 2_500_000_000n, "1.3400", "1.3480", "1.3480")] }];
}

/** docs/POSTING_RULES.md §3–§4 (the earlier USDC-invoice receipts product, src/lib/accounting): listed for completeness. */
const RECEIPTS: [string, string, string, string][] = [
  ["C1", "Exact payment", "Stablecoin clearing", "Accounts receivable"], ["C2", "Partial payment (via the exceptions queue)", "Stablecoin clearing", "Accounts receivable"],
  ["C3", "Shortfall accepted as settled (Approved, decision 2)", "Stablecoin clearing; Shortfall account", "Accounts receivable"], ["C4", "Network fees (gas)", "Network fees (only when the business sends tokens)", "ETH holdings"],
  ["C5", "Overpaid", "Stablecoin clearing", "Accounts receivable; Customer credit"], ["C6", "Paid twice", "Stablecoin clearing", "Accounts receivable; Customer credit"],
  ["C7", "Differences under one cent (Approved, decision 3)", "Stablecoin clearing; Rounding (≤ 0.01)", "Accounts receivable"], ["C8", "Several transfers for one invoice", "Stablecoin clearing", "Accounts receivable"],
  ["C9", "Wrong token", "never automatic", "—"], ["C10", "Wrong network", "never automatic", "—"], ["C11", "Look-alike address", "nothing posts", "—"], ["C12", "Counterfeit or failed", "nothing posts", "—"],
  ["C13", "Refund of an overpayment (recorded by a person)", "Customer credit; Network fees", "Stablecoin clearing; ETH holdings"], ["C14", "One transfer for several invoices (split by a person)", "Stablecoin clearing", "Accounts receivable (each invoice)"],
  ["C15", "Currencies (Approved, decision 4: par to USD, then the ledger's own rate)", "Stablecoin clearing; Realised currency loss", "Accounts receivable"], ["C16", "No reference or not final", "nothing posts until a person confirms", "—"],
  ["C17", "Token off par (Approved, decision 4)", "exceptions queue", "—"],
];

const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);

let cached: PostingRulesCatalogue | undefined;
/** The catalogue as the engine produces it now (computed once per process; deterministic). */
export function postingRulesCatalogue(): PostingRulesCatalogue {
  if (cached) return cached;
  const patterns: PostingPattern[] = [
    ...documentA(), ...fx(), ...tokenPriced(),
    ...RECEIPTS.map(([id, title, debit, credit]): PostingPattern => ({ id, group: "receipts", title, when: `docs/POSTING_RULES.md §4 ${id}`, debit, credit, status: "listed_by_reference", reference: `docs/POSTING_RULES.md §4 ${id} (USDC invoice receipts, src/lib/accounting)`, engine: null, examples: [] })),
  ];
  const note = "Signing records that this version was read and accepted. It approves no journal and posts nothing: every journal still needs its own approval, and nothing is sent to a ledger by this build.";
  const sha256 = sha256Hex(canonical({ patterns, note }));
  cached = { version: `PR-${sha256.slice(0, 12)}`, sha256, patterns, note };
  return cached;
}

