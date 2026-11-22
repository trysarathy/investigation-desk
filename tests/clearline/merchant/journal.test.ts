/**
 * rc6 phase 5: journal proposals from match results. All proposed, all pending sign-off; balanced in BigInt.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import type { JournalProposal, ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { HELD_ORDER, case2Sgd, case2Usd } from "@/lib/clearline/merchant/fixtures/case2";
import { case3, case3AfterPart1 } from "@/lib/clearline/merchant/fixtures/case3";
import { minor, walletAddress } from "@/lib/clearline/merchant/fixtures/common";
import { reconcile } from "./helpers";

const { proposeJournals, accountBalance } = merchant;
const journals = (input: ReconcileInput) => proposeJournals(input, reconcile(input));
const j1 = journals(case1());
const j2 = journals(case2Sgd());
const j2u = journals(case2Usd());
const j3 = journals(case3());
const ALL: [string, JournalProposal[]][] = [["case1", j1], ["case2 SGD", j2], ["case2 USD", j2u], ["case3", j3], ["case3 part 1", journals(case3AfterPart1())]];
const lines = (p: JournalProposal) => p.lines.map((l) => [l.side, l.account, l.amountMinor]);
const byId = (js: JournalProposal[], id: string) => js.find((p) => p.id === id)!;

describe("every entry", () => {
  it.each(ALL)("%s: proposed, pending sign-off, labelled, and balanced in BigInt", (_n, js) => {
    expect(js.length).toBeGreaterThan(0);
    for (const p of js) {
      expect([p.status, p.postingRuleStatus, p.label]).toEqual(["proposed", "pending_sign_off", "Test mode · illustrative data"]);
      const dr = p.lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amountMinor, 0n);
      const cr = p.lines.filter((l) => l.side === "credit").reduce((t, l) => t + l.amountMinor, 0n);
      expect(typeof dr).toBe("bigint");
      expect(dr).toBe(cr);
      expect(p.lines.every((l) => l.amountMinor > 0n)).toBe(true);
    }
  });
});

describe("Case 1 entries", () => {
  it("[J.confirmation.chain_evidenced] provider confirmations: Dr Provider clearing (credited) / Cr AR", () => {
    expect(lines(byId(j1, "JP-CONF-PP-24817"))).toEqual([["debit", "provider_clearing", minor("1348.65")], ["credit", "accounts_receivable", minor("1348.65")]]);
    expect(lines(byId(j1, "JP-CONF-PP-24823"))).toEqual([["debit", "provider_clearing", minor("2376.00")], ["credit", "accounts_receivable", minor("2376.00")]]);
    expect(lines(byId(j1, "JP-CONF-PP-24836"))).toEqual([["debit", "provider_clearing", minor("1341.00")], ["credit", "accounts_receivable", minor("1341.00")]]);
    expect(byId(j1, "JP-CONF-PP-24817").evidence.txHashes).toEqual(["fict_tron_tx_24817"]);
  });
  it("[J.confirmation.overpayment_liability] overpayment: Cr AR 810.00 (invoice) and Cr Customer overpayments 145.80", () => {
    expect(lines(byId(j1, "JP-CONF-PP-24830"))).toEqual([["debit", "provider_clearing", minor("955.80")], ["credit", "accounts_receivable", minor("810.00")], ["credit", "customer_overpayments", minor("145.80")]]);
  });
  it("[J.writeoff.on_approval] BK-24817 write-off 1.35: Dr Payment shortfall expense / Cr AR, only after approval of WO-BK-24817", () => {
    const p = byId(j1, "JP-WO-BK-24817");
    expect(lines(p)).toEqual([["debit", "payment_shortfall_expense", minor("1.35")], ["credit", "accounts_receivable", minor("1.35")]]);
    expect(p.requiresApprovalOf).toBe("WO-BK-24817");
  });
  it("settlement B-1124-001: Dr Bank 5,961.24, Dr fees 60.21 / Cr Provider clearing 6,021.45", () => {
    expect(lines(byId(j1, "JP-SETL-B-1124-001"))).toEqual([["debit", "bank", minor("5961.24")], ["debit", "payment_processing_fees", minor("60.21")], ["credit", "provider_clearing", minor("6021.45")]]);
  });
  it("AR: BK-24823 still has 324.00 open; BK-24817 closes only with the approved write-off; BK-24836 keeps 9.00 open for review", () => {
    const arOpen = (id: string, js: JournalProposal[]) => case1().invoices.find((i) => i.orderId === id)!.amountMinor + accountBalance(js, "accounts_receivable", { orderId: id });
    expect(arOpen("BK-24823", j1)).toBe(minor("324.00"));
    expect(arOpen("BK-24817", j1.filter((p) => p.kind !== "approved_writeoff"))).toBe(minor("1.35"));
    expect(arOpen("BK-24817", j1)).toBe(0n);
    expect(arOpen("BK-24836", j1)).toBe(minor("9.00"));
    expect(arOpen("BK-24830", j1)).toBe(0n);
    expect(accountBalance(j1, "customer_overpayments")).toBe(minor("-145.80"));
  });
});

describe("Provider clearing nets to zero after settlement, per tied batch", () => {
  it.each([
    ["B-1124-001", j1], ["B-1125-SGD", j2], ["B-1124-SGD", j2], ["B-1125-USD", j2u], ["B-UAE-1201", j3], ["B-UAE-1203", j3],
  ] as const)("%s", (batchId, js) => {
    expect(js.some((p) => p.id === `JP-SETL-${batchId}`)).toBe(true);
    expect(accountBalance(js, "provider_clearing", { batchId })).toBe(0n);
  });
  it("Case 2 B-1125-SGD settlement: Dr Bank 40,228.68, Dr fees 418.62, Dr Sales refunds 1,215.00 / Cr clearing 41,862.30", () => {
    expect(lines(byId(j2, "JP-SETL-B-1125-SGD"))).toEqual([["debit", "bank", minor("40228.68")], ["debit", "payment_processing_fees", minor("418.62")], ["debit", "sales_refunds", minor("1215.00")], ["credit", "provider_clearing", minor("41862.30")]]);
    expect(lines(byId(j2u, "JP-SETL-B-1125-USD"))).toEqual([["debit", "bank", minor("9355.50")], ["debit", "payment_processing_fees", minor("94.50")], ["credit", "provider_clearing", minor("9450.00")]]);
  });
  it("held BK-24871 leaves clearing open by 1,200.00, a receivable from the provider", () => {
    expect(byId(j2, "JP-CONF-PP-24871").memo).toContain("receivable from the provider");
    expect(accountBalance(j2, "provider_clearing", { batchId: "" })).toBe(minor("1200.00"));
    expect(accountBalance(j2, "provider_clearing")).toBe(minor("1200.00"));
    expect(j2.filter((p) => p.evidence.orderIds.includes(HELD_ORDER)).map((p) => p.kind)).toEqual(["provider_confirmation"]);
  });
  it("Case 3 after part 1 only: clearing for B-UAE-1201 nets to zero, AR keeps 7,347.50 open", () => {
    const js = journals(case3AfterPart1());
    expect(accountBalance(js, "provider_clearing", { batchId: "B-UAE-1201" })).toBe(0n);
    expect(minor("18365.00") + accountBalance(js, "accounts_receivable", { orderId: "BK-25102" })).toBe(minor("7347.50"));
  });
});

describe("Case 3 entries", () => {
  it("two confirmations (11,017.50 and 7,333.34), then the 14.16 write-off split 12.86 shortfall / 1.30 rate difference", () => {
    expect(lines(byId(j3, "JP-CONF-PP-25102-1"))).toEqual([["debit", "provider_clearing", minor("11017.50")], ["credit", "accounts_receivable", minor("11017.50")]]);
    expect(lines(byId(j3, "JP-CONF-PP-25102-2"))).toEqual([["debit", "provider_clearing", minor("7333.34")], ["credit", "accounts_receivable", minor("7333.34")]]);
    expect(lines(byId(j3, "JP-WO-BK-25102"))).toEqual([["debit", "payment_shortfall_expense", minor("12.86")], ["debit", "requote_rate_difference", minor("1.30")], ["credit", "accounts_receivable", minor("14.16")]]);
    expect(minor("18365.00") + accountBalance(j3, "accounts_receivable", { orderId: "BK-25102" })).toBe(0n);
  });
});

describe("no entry closes AR from an amount alone", () => {
  it("[J.confirmation.chain_evidenced] a provider 'paid' with the exact amount but no transfer at the order's address → no confirmation", () => {
    const input = case1();
    const own = input.transfers[0];
    const js = journals({ ...input, transfers: [{ ...own, to: walletAddress("tron", "NOT_ISSUED"), amountBaseUnits: input.quotes[0].quotedBaseUnits }, ...input.transfers.slice(1)] });
    expect(js.some((p) => p.kind !== "settlement" && p.evidence.orderIds.includes("BK-24817"))).toBe(false);
    expect(js.flatMap((p) => p.lines).some((l) => l.account === "accounts_receivable" && l.orderId === "BK-24817")).toBe(false);
    expect(accountBalance(js, "accounts_receivable", { orderId: "BK-24817" })).toBe(0n);
  });
  it("[J.settlement.verified_batch] an imported (csv) bank line: tied but not verified → no settlement entry, clearing stays open", () => {
    const input = case1();
    const js = journals({ ...input, bankLines: input.bankLines.map((l) => ({ ...l, source: "csv_import" as const })) });
    expect(js.some((p) => p.kind === "settlement")).toBe(false);
    expect(accountBalance(js, "provider_clearing", { batchId: "B-1124-001" })).toBe(minor("6021.45"));
  });
  it("an untied batch → no settlement entry", () => {
    const input = case1();
    const js = journals({ ...input, bankLines: input.bankLines.map((l) => ({ ...l, amountMinor: l.amountMinor - 1n })) });
    expect(js.some((p) => p.kind === "settlement")).toBe(false);
  });
  it("journals are deterministic: identical rerun is deep-equal", () => {
    expect(journals(case2Sgd())).toEqual(j2);
  });
});
