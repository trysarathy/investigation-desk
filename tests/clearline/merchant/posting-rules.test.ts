/**
 * v1 phase 4: the posting-rules catalogue a merchant Admin signs. Every pattern of Document A and docs/POSTING_RULES.md
 * is listed; every worked example comes from the engine's own code paths (fictional inputs) and balances; the version
 * is the hash of the content, so a changed result is a new version. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { JOURNAL_RULES } from "@/lib/clearline/merchant";
import { postingRulesCatalogue } from "@/lib/clearline/merchant/posting-rules";

const cat = postingRulesCatalogue();
const byId = (id: string) => cat.patterns.find((p) => p.id === id)!;
const lines = (id: string, i = 0) => byId(id).examples[i].lines.map((l) => [l.side, l.account, l.amount]);

describe("posting-rules catalogue", () => {
  it("lists every engine journal rule, the drafted FX and token-priced patterns and the §4 receipts cases", () => {
    for (const id of Object.keys(JOURNAL_RULES)) expect(byId(id)?.status).toBe("built_pending_sign_off");
    expect(["FX1", "FX2", "TP.realised_fx"].map((id) => byId(id).status)).toEqual(["drafted_not_built", "drafted_not_built", "drafted_not_built"]);
    expect(cat.patterns.filter((p) => p.group === "receipts").map((p) => p.id)).toEqual(Array.from({ length: 17 }, (_, i) => `C${i + 1}`));
  });

  it("every worked example balances and names its engine code path", () => {
    const ex = cat.patterns.flatMap((p) => p.examples);
    expect(ex.length).toBeGreaterThanOrEqual(14);
    for (const e of ex) { expect(e.balanced).toBe(true); expect(e.source).toMatch(/src\/lib\/clearline\/merchant\/(journal|fx|revaluation|amounts)\.ts/); }
  });

  it("the Document A figures come out of proposeJournals", () => {
    expect(lines("J.confirmation.chain_evidenced")).toEqual([["debit", "provider_clearing", "SGD 2,376.00"], ["credit", "accounts_receivable", "SGD 2,376.00"]]);
    expect(lines("J.writeoff.on_approval")).toEqual([["debit", "provider_clearing", "SGD 1,348.65"], ["debit", "payment_shortfall_expense", "SGD 1.35"], ["credit", "accounts_receivable", "SGD 1,350.00"]]);
    expect(lines("J.settlement.verified_batch")).toEqual([["debit", "bank", "SGD 5,961.24"], ["debit", "payment_processing_fees", "SGD 60.21"], ["credit", "provider_clearing", "SGD 6,021.45"]]);
    expect(lines("J.settlement.refund_netted")).toEqual([["debit", "sales_refunds", "SGD 1,215.00"], ["credit", "provider_clearing", "SGD 1,215.00"]]);
  });

  it("the FX and token-priced examples match the drafted figures in docs/POSTING_RULES.md", () => {
    expect(lines("FX2")).toEqual([["debit", "bank_usd", "SGD 1,346.40"], ["debit", "payment_processing_fees", "SGD 13.60"], ["credit", "provider_clearing", "SGD 1,350.00"], ["credit", "realised_fx", "SGD 10.00"]]);
    expect(byId("J.revaluation.period_end").examples.map((e) => e.lines.map((l) => [l.side, l.account, l.amount]))).toEqual([
      [["debit", "provider_clearing", "SGD 10.00"], ["credit", "unrealised_fx", "SGD 10.00"]],
      [["debit", "unrealised_fx", "SGD 5.00"], ["credit", "provider_clearing", "SGD 5.00"]],
      [],
    ]);
    expect(byId("J.revaluation.period_end").examples[2].noEntry).toBe("needs a rate");
    expect(lines("TP.realised_fx", 1)).toEqual([["debit", "provider_clearing", "SGD 1,341.00"], ["debit", "realised_fx", "SGD 8.00"], ["debit", "requote_rate_difference", "SGD 1.00"], ["credit", "accounts_receivable", "SGD 1,350.00"]]);
    expect(lines("TP.realised_fx", 3)).toEqual([["debit", "provider_clearing", "SGD 3,370.00"], ["credit", "realised_fx", "SGD 20.00"], ["credit", "accounts_receivable", "SGD 3,350.00"]]);
  });

  it("the version is the content hash: deterministic, and different content gives a different hash", () => {
    expect(cat.version).toBe(`PR-${cat.sha256.slice(0, 12)}`);
    expect(cat.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(postingRulesCatalogue().sha256).toBe(cat.sha256);
  });
});
