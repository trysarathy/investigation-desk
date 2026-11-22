/**
 * rc6 steps 1–4: one unit test per rule. Each test name starts with [ruleId]; docs/plan/RC6_RULE_PROOFS.md records
 * each test failing with that rule switched off.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import type { ChainTransfer, ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { minor, units, walletAddress } from "@/lib/clearline/merchant/fixtures/common";
import { only, reconcile, recOf, retie, verdict } from "./helpers";

const base = (id = "BK-24817") => only(case1(), [id]);
const withTransfer = (input: ReconcileInput, patch: Partial<ChainTransfer>): ReconcileInput => ({ ...input, transfers: input.transfers.map((t) => ({ ...t, ...patch })) });
/** Patch the provider record; the batch is re-tied so only the rule under test can change the outcome. */
const withRecord = (input: ReconcileInput, patch: object): ReconcileInput => retie({ ...input, providerRecords: input.providerRecords.map((r) => ({ ...r, ...patch })) });

describe("step 1: identity and finality", () => {
  it("[M1.identity.network_disabled] a transfer on a disabled network (TRON switched off) → exception at step 1", () => {
    const input = base();
    const networks = input.networks.map((n) => (n.network === "tron" ? { ...n, enabled: false } : n));
    expect(verdict({ ...input, networks }, "BK-24817")).toEqual(["exception", 1, "M1.identity.network_disabled"]);
    expect(merchant.NETWORKS.filter((n) => n.enabled).map((n) => [n.network, n.confirmationsRequired])).toEqual([["tron", 19], ["ethereum", 12]]);
    expect(merchant.NETWORKS.filter((n) => !n.enabled).map((n) => n.name)).toEqual(["Polygon", "Solana", "Arbitrum One", "TON", "Base"]);
  });
  it("[M1.identity.unknown_token] an unknown contract → exception; owner Treasury", () => {
    const r = recOf(withTransfer(base(), { tokenContract: "T_FICTIONAL_UNKNOWN_TOKEN" }), "BK-24817");
    expect([r.explanation.decision, r.explanation.ruleId, r.attention?.owner]).toEqual(["exception", "M1.identity.unknown_token", "Treasury"]);
  });
  it("[M1.identity.lookalike_token] same symbol USDT, different contract → exception (symbol never identifies a token)", () => {
    const input = withTransfer(base(), { tokenContract: "T_FICTIONAL_LOOKALIKE_USDT", claimedSymbol: "USDT" });
    expect(verdict(input, "BK-24817")).toEqual(["exception", 1, "M1.identity.lookalike_token"]);
  });
  it("[M1.finality.pending] 18 of 19 TRON confirmations → ignored and recorded as pending, never matched", () => {
    const r = recOf(withTransfer(base(), { confirmations: 18 }), "BK-24817");
    expect([r.explanation.decision, r.explanation.decidingStep, r.explanation.ruleId]).toEqual(["suggested_for_review", 1, "M1.finality.pending"]);
    expect(r.chain.pending).toHaveLength(1);
    expect(r.chain.transfers).toHaveLength(0);
    const unattached = reconcile({ ...withTransfer(base(), { confirmations: 3, to: "T_FICTIONAL_NOWHERE" }), providerRecords: [] });
    expect(unattached.transferFindings.map((f) => [f.kind, f.ruleId])).toEqual([["pending", "M1.finality.pending"]]);
  });
});

describe("step 2: reference first", () => {
  it("[M2.reference.unattributed] a transfer with no reference but exactly the invoice amount → exception, invoice not matched", () => {
    const input = { ...withTransfer(base(), { to: "T_FICTIONAL_UNISSUED_ADDRESS", amountBaseUnits: units("1000.00") }), providerRecords: [] };
    const r = reconcile(input);
    expect(r.records).toEqual([]);
    expect(r.exceptions.map((e) => [e.ruleId, e.owner])).toEqual([["M2.reference.unattributed", "Payment Operations"]]);
    expect(r.exceptions[0].reason).toContain("Unattributed transfer");
  });
  it("[M2.reference.no_chain_transfer] the provider claims paid but nothing reached the deposit address → exception (a claim is not proof)", () => {
    const input = { ...base(), transfers: [] };
    expect(verdict(input, "BK-24817")).toEqual(["exception", 2, "M2.reference.no_chain_transfer"]);
  });
  it("[M2.reference.provider_ref_mismatch] provider record names another order's quote → exception", () => {
    expect(verdict(withRecord(base(), { ref: { quoteId: "Q-24836" } }), "BK-24817")).toEqual(["exception", 2, "M2.reference.provider_ref_mismatch"]);
  });
});

describe("step 3: checks", () => {
  it("[M3.currency.invoice_currency] invoice not in the entity's currency → exception", () => {
    const input = base();
    expect(verdict({ ...input, invoices: [{ ...input.invoices[0], currency: "USD" }] }, "BK-24817")).toEqual(["exception", 3, "M3.currency.invoice_currency"]);
  });
  it("[M3.currency.token_mismatch] a configured but different token at the USDC address → exception", () => {
    const input = base("BK-24830");
    const tokens = [...input.tokens, { network: "ethereum" as const, contract: "0xfictotherstablecoin", symbol: "FUSD", decimals: 6 }];
    expect(verdict({ ...withTransfer(input, { tokenContract: "0xfictotherstablecoin" }), tokens }, "BK-24830")).toEqual(["exception", 3, "M3.currency.token_mismatch"]);
  });
  it("[M3.direction.outbound] a transfer leaving the deposit address → exception", () => {
    const input = base();
    const t = input.transfers[0];
    expect(verdict(withTransfer(input, { from: t.to, to: walletAddress("tron", "ELSEWHERE") }), "BK-24817")).toEqual(["exception", 3, "M3.direction.outbound"]);
  });
  it("[M3.window.before_quote] a transfer before the quote existed → exception", () => {
    expect(verdict(withTransfer(base(), { timestamp: "2026-11-24T01:00:00.000Z" }), "BK-24817")).toEqual(["exception", 3, "M3.window.before_quote"]);
  });
  it("[M3.window.after_expiry_no_requote] after expiry without a re-quote → exception", () => {
    const input = withRecord(base("BK-24836"), { statusClaim: "paid", executedRate: "1.3500", creditedMinor: minor("1350.00") });
    expect(verdict(input, "BK-24836")).toEqual(["exception", 3, "M3.window.after_expiry_no_requote"]);
  });
  it("[M3.quote.invoice_mismatch] quote × rate ≠ invoice → exception", () => {
    const input = base();
    expect(verdict({ ...input, invoices: [{ ...input.invoices[0], amountMinor: minor("1351.00") }] }, "BK-24817")).toEqual(["exception", 3, "M3.quote.invoice_mismatch"]);
  });
  it("[M3.provider.no_record] final referenced transfer without a provider record → exception", () => {
    expect(verdict({ ...base(), providerRecords: [] }, "BK-24817")).toEqual(["exception", 3, "M3.provider.no_record"]);
  });
  it("[M3.provider.received_mismatch] provider received ≠ chain → exception", () => {
    expect(verdict(withRecord(base(), { receivedBaseUnits: units("1000.00") }), "BK-24817")).toEqual(["exception", 3, "M3.provider.received_mismatch"]);
  });
  it("[M3.batch.unknown_batch] provider names a batch not in the settlement report → exception", () => {
    expect(verdict(withRecord(base(), { batchId: "B-FICT-NONE" }), "BK-24817")).toEqual(["exception", 3, "M3.batch.unknown_batch"]);
  });
  it("[M3.batch.held_by_provider] shown as completed, held, in no settlement → exception, owner Treasury", () => {
    const r = recOf(withRecord(base(), { statusClaim: "held_for_review", displayedStatus: "completed", batchId: undefined }), "BK-24817");
    expect([r.explanation.decision, r.explanation.ruleId, r.attention?.owner, r.bank.status]).toEqual(["exception", "M3.batch.held_by_provider", "Treasury", "held_by_provider"]);
    expect(r.attention!.reason).toMatch(/shown as completed, in no settlement, held for review/i);
  });
});

describe("step 4: explained tolerance", () => {
  it("[M4.provider.credit_mismatch] credited ≠ received × executed rate → unexplained difference, exception", () => {
    const r = recOf(withRecord(base(), { creditedMinor: minor("1349.00") }), "BK-24817");
    expect(r.explanation.differences.map((d) => [d.type, d.ruleId, d.amountMinor])).toContainEqual(["unexplained", "M4.provider.credit_mismatch", minor("0.35")]);
    expect(r.explanation.decision).toBe("exception");
  });
  it("[M4.tolerance.sender_side_fee] 1.00 USDT short, within the 5.00 bound, provider claims paid → sender_side_fee", () => {
    expect(recOf(base(), "BK-24817").explanation.differences.map((d) => d.type)).toEqual(["sender_side_fee"]);
    // not when the provider does not claim paid
    expect(recOf(withRecord(base(), { statusClaim: "underpaid" }), "BK-24817").explanation.differences.map((d) => d.type)).toEqual(["underpayment"]);
  });
  it("[M4.tolerance.requote_after_expiry] after expiry and re-quoted → requote_after_expiry", () => {
    expect(recOf(base("BK-24836"), "BK-24836").explanation.differences.map((d) => [d.type, d.amountMinor])).toEqual([["requote_after_expiry", minor("-9.00")]]);
  });
  it("[M4.tolerance.rate_difference] executed 1.3490 vs quoted 1.3500 on 1,000.00 USDT → rate_difference −1.00, matched_with_difference", () => {
    const input = withRecord(withTransfer(base(), { amountBaseUnits: units("1000.00") }), { receivedBaseUnits: units("1000.00"), executedRate: "1.3490", creditedMinor: minor("1349.00") });
    const r = recOf(input, "BK-24817");
    expect(r.explanation.differences.map((d) => [d.type, d.amountMinor])).toEqual([["rate_difference", minor("-1.00")]]);
    expect(r.explanation.decision).toBe("matched_with_difference");
  });
  it("[M4.tolerance.underpayment] beyond the sender-fee bound → underpayment", () => {
    expect(recOf(base("BK-24823"), "BK-24823").explanation.differences.map((d) => d.type)).toEqual(["underpayment"]);
  });
  it("[M4.tolerance.overpayment] more than quoted → overpayment", () => {
    expect(recOf(base("BK-24830"), "BK-24830").explanation.differences.map((d) => d.type)).toEqual(["overpayment"]);
  });
  it("[M4.match.no_difference] exact payment → matched, no write-off", () => {
    const input = withRecord(withTransfer(base(), { amountBaseUnits: units("1000.00") }), { receivedBaseUnits: units("1000.00"), creditedMinor: minor("1350.00") });
    expect(verdict(input, "BK-24817")).toEqual(["matched", 5, "M5.batch.tied_verified"]);
    expect(recOf(input, "BK-24817").explanation.history.map((h) => h.ruleId)).toContain("M4.match.no_difference");
    expect(reconcile(input).writeOffs).toEqual([]);
  });
  it("[M4.tolerance.within_band] |−1.35| ≤ 5.00 → matched_with_difference with a proposed write-off", () => {
    expect(verdict(base(), "BK-24817")).toEqual(["matched_with_difference", 4, "M4.tolerance.within_band"]);
    expect(reconcile(base()).writeOffs.map((w) => [w.amountMinor, w.status])).toEqual([[minor("1.35"), "proposed"]]);
  });
  it("[M4.tolerance.writeoff_threshold] within the band but above a 1.00 write-off threshold → suggested_for_review, no write-off", () => {
    const input = { ...base(), policy: { ...merchant.DEFAULT_POLICY, writeoffThresholdMinor: minor("1.00") } };
    expect(verdict(input, "BK-24817")).toEqual(["suggested_for_review", 4, "M4.tolerance.writeoff_threshold"]);
    expect(reconcile(input).writeOffs).toEqual([]);
  });
  it("[M4.tolerance.explained_outside_band] −9.00 re-quote outside the 5.00 band → suggested_for_review", () => {
    expect(verdict(base("BK-24836"), "BK-24836")).toEqual(["suggested_for_review", 4, "M4.tolerance.explained_outside_band"]);
  });
  it("[M4.tolerance.underpayment_beyond_band] 324.00 short → exception", () => {
    expect(verdict(base("BK-24823"), "BK-24823")).toEqual(["exception", 4, "M4.tolerance.underpayment_beyond_band"]);
  });
  it("[M4.tolerance.overpayment_beyond_band] 145.80 over → exception", () => {
    expect(verdict(base("BK-24830"), "BK-24830")).toEqual(["exception", 4, "M4.tolerance.overpayment_beyond_band"]);
  });
  it("[M4.tolerance.unexplained] an unexplained difference, even inside the band → exception (abstain)", () => {
    expect(verdict(withRecord(base(), { creditedMinor: minor("1349.00") }), "BK-24817")).toEqual(["exception", 4, "M4.tolerance.unexplained"]);
  });
});

describe("rule registry", () => {
  it("every rule id names its step and every decision's rule id is registered", () => {
    for (const [id, r] of Object.entries(merchant.RULES)) expect(id.startsWith(`M${r.step}.`)).toBe(true);
    for (const r of reconcile(case1()).records) expect(Object.keys(merchant.RULES)).toContain(r.explanation.ruleId);
  });
});
