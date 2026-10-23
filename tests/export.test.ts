// Chunk 2: reconciled export (CSV) and evidence packs (PDF), with every ID resolved through the
// resolver behind /api/payments/resolve. Synthetic files, real recorded transfers.

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { RECORDINGS } from "@/lib/demo/recordings";
import { demoTransport } from "@/lib/demo/transport";
import { MemoryAuditLog } from "@/lib/payments/audit";
import { EXPORT_COLUMNS, evidencePack, reconciledCsv } from "@/lib/payments/export";
import type { ColumnMapping } from "@/lib/payments/mapping";
import { renderPack, winAnsi } from "@/lib/payments/pdf";
import { refreshMatching } from "@/lib/payments/refresh";
import { applyImport, MemoryPaymentsStore, saveMappingVersion, type PaymentsData } from "@/lib/payments/store";
import { MemoryInboxStore, resolveReview, saveRoutes, syncAll, type Stores } from "@/lib/payments/workflow";

const NOW = new Date("2026-10-23T08:00:00Z");
const dir = path.join(__dirname, "fixtures/inbox");
const file = (n: string) => new Uint8Array(readFileSync(path.join(dir, n)));
const enc = (s: string) => new TextEncoder().encode(s);
const rematch = (d: PaymentsData) => refreshMatching(d, buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
  transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true }), [], () => NOW);
const TP: Omit<ColumnMapping, "version" | "createdAt"> = {
  mappingId: "tp", kind: "provider", name: "TP", provider: "TP",
  columns: { provider_payment_id: "payment_id", merchant_reference: "our_ref", status: "state", amount: "amount", currency: "currency",
    event_time: "created", tx_hash: "hash", type: "kind", relates_to: "parent" },
  values: { status: { DONE: "provider_reports_complete", PROC: "processing", REFUNDED: "returned" }, type: { PAYMENT: "principal", FEE: "fee", REFUND: "return" } },
  timestampFormat: "iso8601_offset",
};
const ANA = { actor: "Ana", ip: "203.0.113.7" };

async function fresh(): Promise<Stores> {
  const s: Stores = { payments: new MemoryPaymentsStore(), inbox: new MemoryInboxStore(), audit: new MemoryAuditLog() };
  await saveMappingVersion(s.payments, TP, NOW);
  return s;
}
async function full(): Promise<Stores> {
  const s = await fresh();
  await applyImport(s.payments, "instruction", "i.csv", file("instructions.csv"), "instructions-standard", undefined, NOW);
  await applyImport(s.payments, "provider", "p.csv", file("provider-1.csv"), "tp", undefined, NOW);
  await applyImport(s.payments, "ledger", "l.csv", file("ledger.csv"), "payout-ledger-standard", undefined, NOW);
  await s.payments.save(await rematch(await s.payments.load()));
  await saveRoutes(s, [{ routeId: "tp-tron", name: "TP tron", match: { provider: "TP", chain: "tron", token: "USDT" }, deadlineMinutes: 120, graceMinutes: 30,
    expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "fixed", amount: "1.00" } },
  { routeId: "tp-bsc", name: "TP bsc", match: { provider: "TP", chain: "bsc", token: "USDT" }, deadlineMinutes: 120, graceMinutes: 30,
    expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "fixed", amount: "0.01" } },
  { routeId: "default", name: "Any", match: {}, deadlineMinutes: 1440, graceMinutes: 60, expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "none" } }], ANA, NOW);
  return s;
}

function parseCsv(csv: string): Record<string, string>[] {
  const [head, ...rows] = csv.trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => {
    const cells: string[] = [];
    let cur = "", q = false;
    for (const ch of r) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

describe("reconciled export", () => {
  it("one row per payment, with its reconciliation state, original IDs and exact amounts", async () => {
    const s = await full();
    const inbox = await syncAll(s, { now: NOW });
    const rows = parseCsv(reconciledCsv(await s.payments.load(), inbox));
    expect(Object.keys(rows[0])).toEqual(EXPORT_COLUMNS);
    const by = (id: string) => rows.find((r) => r.instruction_id === id)!;
    // Every leg linked, the 0.01 difference explained by the route's fee rule, nothing open.
    expect(by("INS-2003")).toMatchObject({ reconciliation: "reconciled", open_items: "" });
    expect(by("INS-2001")).toMatchObject({ reconciliation: "exceptions open", provider_payment_id: "AP-2001", provider_status: "DONE",
      provider_status_meaning: "provider_reports_complete", ledger_entry_id: "L-2001", amount_ledger: "-61.23001201", amount_chain: "61.230012010000000000", leg_ledger: "linked" });
    expect(by("INS-2001").open_items).toMatch(/fee_mismatch/);
    expect(by("INS-2010")).toMatchObject({ reconciliation: "in review" });
    expect(rows.every((r) => r.requested_id === r.payment_id && r.resolution === "current")).toBe(true);
  });

  it("a fully linked payment with nothing open is reconciled", async () => {
    const s = await fresh();
    await applyImport(s.payments, "instruction", "i.csv", enc("instruction_id,created_at,amount,chain,token,tx_hash\nINS-1,2026-10-22T05:35:00Z,1400,bsc,USDT,0x7c1b18c35118e4aa40eb18f109a954cb6720db82384525dd9e8861a9bc26a7c4\n"), "instructions-standard", undefined, NOW);
    await applyImport(s.payments, "provider", "p.csv", enc("payment_id,our_ref,state,amount,currency,created,hash,kind,parent\nAP-1,INS-1,DONE,1400,USDT,2026-10-22T05:43:00Z,,PAYMENT,\n"), "tp", undefined, NOW);
    await applyImport(s.payments, "ledger", "l.csv", enc("entry_id,booked_at,amount,status,currency,instruction_id\nL-1,2026-10-22T05:50:00Z,-1400,POSTED,USDT,INS-1\n"), "payout-ledger-standard", undefined, NOW);
    await s.payments.save(await rematch(await s.payments.load()));
    const rows = parseCsv(reconciledCsv(await s.payments.load(), await syncAll(s, { now: NOW })));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reconciliation: "reconciled", open_items: "", leg_bank: "not applicable" });
  });

  it("neutralises cells a spreadsheet would run, but keeps signed amounts as numbers", async () => {
    const s = await fresh();
    await applyImport(s.payments, "instruction", "i.csv", enc("instruction_id,created_at,amount\n=HYPERLINK(1),2026-10-22T05:20:00Z,5\n"), "instructions-standard", undefined, NOW);
    await s.payments.save(await rematch(await s.payments.load()));
    const csv = reconciledCsv(await s.payments.load(), await syncAll(s, { now: NOW }));
    expect(csv).toContain(",'=HYPERLINK(1),");
    expect(parseCsv(csv)[0].amount_instruction).toBe("5");
  });

  it("a retired payment ID gets its own row, resolved to where it leads now", async () => {
    const s = await fresh();
    // Run 1: the provider record alone, so it gets a payment ID of its own (X).
    await applyImport(s.payments, "provider", "p.csv", enc("payment_id,our_ref,state,amount,currency,created,hash,kind,parent\nAP-9,INS-9,DONE,9.00,USDT,2026-10-22T05:35:00Z,,PAYMENT,\n"), "tp", undefined, NOW);
    await s.payments.save(await rematch(await s.payments.load()));
    const X = (await s.payments.load()).match!.result.payments[0].paymentId;
    await syncAll(s, { now: NOW });
    // Run 2: the instruction arrives in two versions, so it gets its own ID (Y) and the provider waits in review.
    await applyImport(s.payments, "instruction", "i.csv", enc("instruction_id,created_at,amount\nINS-9,2026-10-22T05:20:00Z,9.00\nINS-9,2026-10-22T05:20:00Z,9.50\n"), "instructions-standard", undefined, NOW);
    await s.payments.save(await rematch(await s.payments.load()));
    await syncAll(s, { now: NOW });
    const d2 = await s.payments.load();
    const review = d2.match!.result.reviews.find((r) => r.leg === "instruction")!;
    const right = review.candidates.find((c) => d2.records.instruction.find((i) => i.recordId === c.recordId)!.amount === "9.00")!;
    // Run 3: a person confirms the right version in the app; the provider record links; X merges into Y.
    await resolveReview(s, { reviewId: review.reviewId, recordId: right.recordId, action: "confirm", why: "9.50 was a typo." }, ANA, NOW, rematch);
    const d3 = await s.payments.load();
    const Y = d3.match!.result.payments[0].paymentId;
    expect(Y).not.toBe(X);
    const rows = parseCsv(reconciledCsv(d3, await s.inbox.load()));
    expect(rows.find((r) => r.requested_id === X)).toMatchObject({ payment_id: Y, resolution: `${X} merged into ${Y}`, instruction_id: "INS-9", provider_payment_id: "AP-9" });

    // The evidence pack for the item recorded under X shows it under Y, saying why.
    const inbox = await s.inbox.load();
    const old = Object.values(inbox.items).find((i) => i.subject.kind === "payment" && i.subject.paymentId === X)!;
    const pack = evidencePack(old.itemId, d3, inbox, await s.audit.list(), NOW)!;
    const summary = Object.fromEntries(pack.sections.find((x) => x.heading === "Summary")!.rows!);
    expect(summary["Payment (as recorded)"]).toBe(X);
    expect(summary["Payment (now)"]).toBe(`${Y} · ${X} merged into ${Y}`);
    expect(pack.sections.find((x) => x.heading === "Review decisions")!.lines![0]).toMatch(/^DEC-0001 · .* · Ana confirmed ins:INS-9:.* for the instruction leg .*: 9\.50 was a typo\.$/);
  });
});

describe("evidence pack", () => {
  it("carries the exception, evidence with sources, legs, timeline, identifiers, history and audit entries", async () => {
    const s = await full();
    const inbox = await syncAll(s, { now: NOW });
    const d = await s.payments.load();
    const item = Object.values(inbox.items).find((i) => i.code === "fee_mismatch")!;
    const pack = evidencePack(item.itemId, d, inbox, await s.audit.list(), NOW)!;
    expect(pack.sections.map((x) => x.heading)).toEqual([
      "Summary", "What it is", "Next step", "Evidence", expect.stringMatching(/^Payment PAY-[0-9A-F]{10}: legs$/),
      "Timeline (event time by each source; observed = when read)", "Original identifiers (as each source wrote them)",
      "Chain responses (SHA-256 of the raw bodies kept)", "History", "Audit log entries",
    ]);
    const evidence = pack.sections.find((x) => x.heading === "Evidence")!.rows!;
    expect(evidence.find(([k]) => k === "Fee record")![1]).toMatch(/\[source: p\.csv line 3 · tp v1\]$/);
    const timeline = pack.sections.find((x) => x.heading.startsWith("Timeline"))!.lines!;
    expect(timeline.some((l) => l.includes("source: https://bscscan.com/tx/0xdd30c41d"))).toBe(true);
    const chain = pack.sections.find((x) => x.heading.startsWith("Chain responses"))!.lines!;
    expect(chain[0]).toMatch(/[0-9a-f]{64}/);
    expect(pack.sections.find((x) => x.heading === "Audit log entries")!.lines![0]).toMatch(/system · inbox\.opened/);
  });

  it("renders to a PDF, whatever characters the evidence holds", async () => {
    const s = await full();
    const inbox = await syncAll(s, { now: NOW });
    const item = Object.values(inbox.items).find((i) => i.code === "amount_mismatch")!;
    const pack = evidencePack(item.itemId, await s.payments.load(), inbox, await s.audit.list(), NOW)!;
    pack.sections.push({ heading: "Odd characters", lines: ["Arrows → ← and ≥, a 中文 name, an emoji 🙂, and a very long hash " + "ab".repeat(200)] });
    const bytes = await renderPack(pack);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe(`Evidence pack · ${item.itemId}`);
    expect(winAnsi("A → B ≥ 中🙂")).toBe("A -> B >= ??");
  });
});
