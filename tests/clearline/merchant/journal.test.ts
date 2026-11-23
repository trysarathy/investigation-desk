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

// Every expectation below is copied from Document A ("Clearline: use-case mapping", Nov 2026), section by section.
const approval = (p: JournalProposal) => p.lines.filter((l) => l.onApproval).map((l) => [l.account, l.amountMinor, l.onApproval]);

describe("Case 1 entries (Document A §3, Singapore entity, SGD)", () => {
  it("[J.writeoff.on_approval] BK-24817 paid: Dr Provider clearing 1,348.65, Dr Payment shortfall expense 1.35 (on approval) / Cr AR 1,350.00", () => {
    const p = byId(j1, "JP-CONF-PP-24817");
    expect(lines(p)).toEqual([["debit", "provider_clearing", minor("1348.65")], ["debit", "payment_shortfall_expense", minor("1.35")], ["credit", "accounts_receivable", minor("1350.00")]]);
    expect(approval(p)).toEqual([["payment_shortfall_expense", minor("1.35"), "WO-BK-24817"]]);
    expect(p.requiresApprovalOf).toBe("WO-BK-24817");
    expect(p.evidence.txHashes).toEqual(["fict_tron_tx_24817"]);
  });
  it("[J.confirmation.chain_evidenced] BK-24823 paid: Dr Provider clearing / Cr AR 2,376.00 (324.00 stays open)", () => {
    expect(lines(byId(j1, "JP-CONF-PP-24823"))).toEqual([["debit", "provider_clearing", minor("2376.00")], ["credit", "accounts_receivable", minor("2376.00")]]);
    expect(byId(j1, "JP-CONF-PP-24823").requiresApprovalOf).toBeUndefined();
  });
  it("[J.confirmation.overpayment_liability] BK-24830 paid: Dr Provider clearing 955.80 / Cr AR 810.00, Cr Customer overpayments 145.80", () => {
    expect(lines(byId(j1, "JP-CONF-PP-24830"))).toEqual([["debit", "provider_clearing", minor("955.80")], ["credit", "accounts_receivable", minor("810.00")], ["credit", "customer_overpayments", minor("145.80")]]);
  });
  it("BK-24836 paid: Dr Provider clearing 1,341.00, Dr Re-quote difference 9.00 (on approval of the controller's resolution) / Cr AR 1,350.00", () => {
    const p = byId(j1, "JP-CONF-PP-24836");
    expect(lines(p)).toEqual([["debit", "provider_clearing", minor("1341.00")], ["debit", "requote_rate_difference", minor("9.00")], ["credit", "accounts_receivable", minor("1350.00")]]);
    expect(approval(p)).toEqual([["requote_rate_difference", minor("9.00"), "resolution:BK-24836"]]);
  });
  it("Settlement 25 Nov: Dr Bank 5,961.24, Dr Payment processing fees 60.21 / Cr Provider clearing 6,021.45", () => {
    expect(lines(byId(j1, "JP-SETL-B-1124-001"))).toEqual([["debit", "bank", minor("5961.24")], ["debit", "payment_processing_fees", minor("60.21")], ["credit", "provider_clearing", minor("6021.45")]]);
  });
  it("no separate write-off entry: Document A books it inside the payment entry", () => {
    expect(j1.some((p) => p.kind === "approved_writeoff")).toBe(false);
  });
  it("AR: 324.00 open on BK-24823; BK-24817 and BK-24836 close only once their approvals are given", () => {
    const arOpen = (id: string, approvedOnly = false) => case1().invoices.find((i) => i.orderId === id)!.amountMinor + accountBalance(j1, "accounts_receivable", { orderId: id, approvedOnly });
    expect(arOpen("BK-24823")).toBe(minor("324.00"));
    expect(arOpen("BK-24817")).toBe(0n);
    expect(arOpen("BK-24817", true)).toBe(minor("1350.00"));
    expect(arOpen("BK-24836")).toBe(0n);
    expect(arOpen("BK-24830")).toBe(0n);
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
  it("[J.settlement.refund_netted] Case 2 (Document A §4): refund BK-24788 Dr Sales refunds / Cr Provider clearing 1,215.00, its own entry", () => {
    const r = byId(j2, "JP-RFND-B-1125-SGD");
    expect(r.kind).toBe("refund");
    expect(lines(r)).toEqual([["debit", "sales_refunds", minor("1215.00")], ["credit", "provider_clearing", minor("1215.00")]]);
    expect(r.evidence.orderIds).toEqual(["BK-24788"]);
  });
  it("Case 2 settlement (SGD): Dr Bank 40,228.68, Dr fees 418.62 / Cr Provider clearing 40,647.30 (= 41,862.30 − 1,215.00)", () => {
    expect(lines(byId(j2, "JP-SETL-B-1125-SGD"))).toEqual([["debit", "bank", minor("40228.68")], ["debit", "payment_processing_fees", minor("418.62")], ["credit", "provider_clearing", minor("40647.30")]]);
  });
  it("Case 2 settlement (USD): Dr Bank 9,355.50, Dr fees 94.50 / Cr Provider clearing 9,450.00", () => {
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
    expect(js.some((p) => p.requiresApprovalOf)).toBe(false);
  });
});

describe("Case 3 entries (Document A §5, UAE entity, AED)", () => {
  it("Part 1, 1 Dec: Dr Provider clearing / Cr AR 11,017.50", () => {
    expect(lines(byId(j3, "JP-CONF-PP-25102-1"))).toEqual([["debit", "provider_clearing", minor("11017.50")], ["credit", "accounts_receivable", minor("11017.50")]]);
  });
  it("Settlement 2 Dec: Dr Bank 10,907.32, Dr fees 110.18 / Cr Provider clearing 11,017.50", () => {
    expect(lines(byId(j3, "JP-SETL-B-UAE-1201"))).toEqual([["debit", "bank", minor("10907.32")], ["debit", "payment_processing_fees", minor("110.18")], ["credit", "provider_clearing", minor("11017.50")]]);
  });
  it("Part 2, 3 Dec: Dr Provider clearing 7,333.34, Dr shortfall and rate difference 14.16 (on approval) / Cr AR 7,347.50", () => {
    const p = byId(j3, "JP-CONF-PP-25102-2");
    // Document A shows one 14.16 line; Clearline keeps it as two typed lines (12.86 shortfall, 1.30 rate difference), same total.
    expect(lines(p)).toEqual([["debit", "provider_clearing", minor("7333.34")], ["debit", "payment_shortfall_expense", minor("12.86")], ["debit", "requote_rate_difference", minor("1.30")], ["credit", "accounts_receivable", minor("7347.50")]]);
    expect(p.lines.filter((l) => l.onApproval).reduce((t, l) => t + l.amountMinor, 0n)).toBe(minor("14.16"));
    expect(p.requiresApprovalOf).toBe("WO-BK-25102");
    expect(minor("18365.00") + accountBalance(j3, "accounts_receivable", { orderId: "BK-25102" })).toBe(0n);
  });
  it("Settlement 4 Dec: Dr Bank 7,260.01, Dr fees 73.33 / Cr Provider clearing 7,333.34", () => {
    expect(lines(byId(j3, "JP-SETL-B-UAE-1203"))).toEqual([["debit", "bank", minor("7260.01")], ["debit", "payment_processing_fees", minor("73.33")], ["credit", "provider_clearing", minor("7333.34")]]);
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
