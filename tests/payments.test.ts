// Chunk 1: canonical payment records, mapped CSV imports, three-way matching. Instruction,
// provider and bank files are synthetic (tests/fixtures/payments/); every on-chain transfer is a
// real public transfer replayed from tests/fixtures/live/.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { validateFileB } from "@/lib/csv/files";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { RECORDINGS } from "@/lib/demo/recordings";
import { demoTransport } from "@/lib/demo/transport";
import { referencedHashes } from "@/lib/payments/chain";
import { checkMapping, importWithMapping, type ColumnMapping } from "@/lib/payments/mapping";
import { matchPayments } from "@/lib/payments/match";
import { BVNK_TRANSACTION_REPORT, INSTRUCTIONS_STANDARD, BANK_STANDARD } from "@/lib/payments/presets";
import { refreshMatching } from "@/lib/payments/refresh";
import { applyImport, findMapping, ledgerFromFileB, MemoryPaymentsStore, saveMappingVersion, type PaymentsData } from "@/lib/payments/store";
import type { CanonicalPayment, Leg, MatchResult, ProviderRecord } from "@/lib/payments/types";

const dir = path.join(__dirname, "fixtures/payments");
const file = (name: string) => new Uint8Array(readFileSync(path.join(dir, name)));
const NOW = new Date("2026-10-23T08:00:00Z");
const T1 = "056fbff6c4d78bd1f3f36ecd685f71f383efd6d23b176cecfaaa0fe47686c797";
const T2 = "71a78d3bef17cf469a2296074d9569c57c2b288e394a379b12e6a7108de87c72";
const T3 = "1f8e11a6ea2dca0b1dfa896f2d440eedbbe9d959060c5bf1da9d45662e8b24b3";
const T6 = "e25114e130161005c3173f2cb5a90d35d8d48cbffde637e525b0cf35701151b1";

const recorded = () => buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
  transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true });

const FILE_B = [
  "deposit_id,tx_hash,chain,token,to_address,amount,status,credited_at,customer_id,transfer_index",
  `DEP-77,0x${T2},bsc,USDT,0x7c1f3180d059fef421b3a0eeb626d975e7577f41,1999.99,CREDITED,2026-10-22T05:40:00Z,C-1,134`,
].join("\n");
const DEPOSITS = [{ chain: "bsc", address: "0x7c1f3180d059fef421b3a0eeb626d975e7577f41" }];
const ledger = () => { const v = validateFileB(new TextEncoder().encode(FILE_B)); return ledgerFromFileB(v.rows, v.sha256, NOW.toISOString()); };

async function loaded(): Promise<{ store: MemoryPaymentsStore; data: PaymentsData }> {
  const store = new MemoryPaymentsStore();
  await applyImport(store, "instruction", "instructions.csv", file("instructions.csv"), "instructions-standard", undefined, NOW);
  await applyImport(store, "provider", "bvnk-report-1.csv", file("bvnk-report-1.csv"), "bvnk-transaction-report", undefined, NOW);
  await applyImport(store, "provider", "bvnk-report-2.csv", file("bvnk-report-2.csv"), "bvnk-transaction-report", undefined, NOW);
  await applyImport(store, "bank", "bank.csv", file("bank.csv"), "bank-standard", undefined, NOW);
  return { store, data: await store.load() };
}

let result: MatchResult;
let data: PaymentsData;
const pay = (instructionId: string): CanonicalPayment => {
  const p = result.payments.find((x) => x.identifiers.some((i) => i.role === "instruction_id" && i.value === instructionId && x.anchor.kind === "instruction"));
  if (!p) throw new Error(`no payment for ${instructionId}`);
  return p;
};
const orphan = (providerPaymentId: string) =>
  result.payments.find((p) => p.anchor.kind === "provider" && p.identifiers.some((i) => i.role === "provider_payment_id" && i.value === providerPaymentId));
const linkedIds = (leg: Leg) => (leg.state === "linked" ? leg.links.map((l) => l.recordId) : []);
const reviewFor = (p: CanonicalPayment, leg: keyof CanonicalPayment["legs"]) => {
  const l = p.legs[leg];
  return l.state === "needs_review" ? result.reviews.find((r) => r.reviewId === l.reviewId) : undefined;
};
const rec = (id: string) => [...data.records.instruction, ...data.records.provider, ...data.records.bank, ...data.chain.transfers].find((r) => r.recordId === id)!;

beforeAll(async () => {
  ({ data } = await loaded());
  // DEP-77 credits a company deposit address (File A): the transfer into it is inbound, so the
  // deposit ledger may be its ledger leg.
  data = await refreshMatching(data, recorded(), ledger(), () => NOW, { depositAddresses: DEPOSITS });
  result = data.match!.result;
});

describe("imports with column mapping", () => {
  it("keeps every original column, the source line and both times on each record", () => {
    const r = data.records.provider.find((x) => x.providerPaymentId === "TX-B-2" && x.statusRaw === "PROCESSING")!;
    expect(r.original["Running Balance"]).toBe("7998.51");
    expect(r.eventTime).toBe("2026-10-22T05:33:00Z");
    expect(r.observedTime).toBe(NOW.toISOString());
    expect(r.sources).toEqual([expect.objectContaining({ kind: "file", fileName: "bvnk-report-1.csv", line: 5, mappingId: "bvnk-transaction-report", mappingVersion: 1 })]);
    expect(r.identifiers).toEqual(expect.arrayContaining([
      { role: "provider_payment_id", sourceField: "Transaction ID", value: "TX-B-2" },
      { role: "merchant_reference", sourceField: "Merchant Reference", value: "INS-1002" },
      { role: "provider_uuid", sourceField: "Transaction UUID", value: "7a4e0c1e-0001-4b8e-9d1a-000000000002" },
    ]));
  });

  it("rejects bad rows with line, column and reason, and fixes nothing", () => {
    const log = data.imports.find((i) => i.fileName === "bvnk-report-1.csv")!;
    expect(log.rowErrors).toEqual([
      expect.objectContaining({ line: 12, column: "Amount", value: "1,000.00" }),
      expect.objectContaining({ line: 13, column: "Date Created", value: "2026-10-21 10:00:00", message: "Not an ISO 8601 timestamp with an offset." }),
    ]);
    expect(log.ignoredColumns).toEqual(["Running Balance"]);
  });

  it("keeps a provider status raw beside its meaning; an unknown status is 'unmapped', never guessed", () => {
    const done = data.records.provider.find((x) => x.providerPaymentId === "TX-B-1")!;
    expect([done.statusRaw, done.statusMeaning]).toEqual(["COMPLETE", "provider_reports_complete"]);
    const held = data.records.provider.find((x) => x.providerPaymentId === "TX-B-11")!;
    expect([held.statusRaw, held.statusMeaning]).toEqual(["ON_HOLD", "unmapped"]);
  });

  it("the same file again is a no-op (SHA-256)", async () => {
    const { store } = await loaded();
    const again = await applyImport(store, "provider", "renamed.csv", file("bvnk-report-1.csv"), "bvnk-transaction-report", undefined, NOW);
    expect(again.outcome).toBe("no_change");
    expect((await store.load()).records.provider).toHaveLength(data.records.provider.length);
  });

  it("refuses a file missing a mapped required column, a mapping missing a required field, and an email as an ID", () => {
    const ctx = { importId: "t", fileName: "x.csv", now: NOW };
    const noId = importWithMapping(new TextEncoder().encode("Payment Status,Date Created,Amount\nCOMPLETE,2026-10-21T00:00:00Z,1\n"), BVNK_TRANSACTION_REPORT, ctx);
    expect(noId.fileErrors[0]).toMatch(/Missing required column\(s\): Transaction ID/);
    const { status: _s, ...cols } = BVNK_TRANSACTION_REPORT.columns;
    expect(checkMapping({ ...BVNK_TRANSACTION_REPORT, columns: cols })).toContain('Required field "Status (kept raw)" has no column.');
    const email = importWithMapping(new TextEncoder().encode("instruction_id,created_at,amount\njane@example.com,2026-10-21T00:00:00Z,1\n"), INSTRUCTIONS_STANDARD, ctx);
    expect(email.rowErrors[0].message).toMatch(/email/);
  });
});

describe("mapping versions", () => {
  it("an edit saves the next version; unchanged saves nothing; imports name the version they used", async () => {
    const store = new MemoryPaymentsStore();
    const { version: _v, createdAt: _c, ...base } = BVNK_TRANSACTION_REPORT;
    const same = await saveMappingVersion(store, base, NOW);
    expect(same).toMatchObject({ unchanged: true, mapping: { version: 1 } });
    const v2 = await saveMappingVersion(store, { ...base, values: { ...base.values, status: { ...base.values!.status, ON_HOLD: "on_hold" } } }, NOW);
    expect(v2.mapping?.version).toBe(2);
    const data2 = await store.load();
    expect(findMapping(data2, "bvnk-transaction-report")?.version).toBe(2);
    expect(findMapping(data2, "bvnk-transaction-report", 1)?.values?.status?.ON_HOLD).toBeUndefined();
    const log = await applyImport(store, "provider", "r.csv", file("bvnk-report-1.csv"), "bvnk-transaction-report", undefined, NOW);
    expect(log.mappingVersion).toBe(2);
    expect((await store.load()).records.provider.find((r) => r.providerPaymentId === "TX-B-11")?.statusMeaning).toBe("on_hold");
  });

  it("a broken mapping is not saved", async () => {
    const store = new MemoryPaymentsStore();
    const res = await saveMappingVersion(store, { ...INSTRUCTIONS_STANDARD, columns: { amount: "amount" } }, NOW);
    expect(res.errors).toEqual(expect.arrayContaining(['Required field "Instruction ID" has no column.']));
    expect((await store.load()).mappings).toEqual([]);
  });
});

describe("three-way matching on recorded chain data", () => {
  it("looks up every referenced hash once: found on its chain, or not found on any", () => {
    expect(referencedHashes([...data.records.instruction, ...data.records.provider])).toHaveLength(7);
    expect(data.chain.lookups.find((l) => l.txHash === T1)).toMatchObject({ result: "found", chain: "tron" });
    expect(data.chain.lookups.find((l) => l.txHash.startsWith("4a1d0f"))).toMatchObject({ result: "not_found" });
  });

  it("exact match: instruction, chain transfer and provider record share one payment ID", () => {
    const p = pay("INS-1001");
    expect(p.paymentId).toMatch(/^PAY-[0-9A-F]{10}$/);
    expect(p.legs.instruction.state).toBe("linked");
    expect(p.legs.provider).toEqual({ state: "linked", links: [expect.objectContaining({ basis: "merchant_reference" })] });
    expect(p.legs.chain).toEqual({ state: "linked", links: [
      expect.objectContaining({ recordId: `chn:tron:${T1}:0`, basis: "chain_tx_single_transfer" }),
      expect.objectContaining({ recordId: `chn:tron:${T1}:0`, basis: "chain_tx_single_transfer" }),
    ] });
    // Bank leg on its own exact column; the later bank return attaches to the payment.
    expect(linkedIds(p.legs.bank).map((id) => rec(id))).toEqual([expect.objectContaining({ bankReference: "BNK-1" })]);
    expect(p.returns.map((l) => (rec(l.recordId) as { bankReference: string }).bankReference)).toEqual(["BNK-3"]);
    expect(p.fees.map((l) => (rec(l.recordId) as ProviderRecord).providerPaymentId)).toEqual(["TX-B-1F"]);
    // Every original identifier is kept, from every record.
    expect(p.identifiers.map((i) => `${i.role}=${i.value}`)).toEqual(expect.arrayContaining([
      "instruction_id=INS-1001", "provider_payment_id=TX-B-1", "merchant_reference=INS-1001", `tx_hash=${T1}`, "bank_reference=BNK-1",
    ]));
  });

  it("the timeline is in event-time order, and 'complete' is never shown as beneficiary credit", () => {
    const p = pay("INS-1001");
    const times = p.timeline.map((t) => t.eventTime).filter(Boolean).map((t) => Date.parse(t!));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const provider = p.timeline.find((t) => t.kind === "provider" && t.label.includes("TX-B-1:"))!;
    expect(provider.label).toMatch(/provider reports complete; not proof of beneficiary credit/);
    expect(p.legs.ledger.state).toBe("missing");
  });

  it("exact match with a transfer index, a status history across two reports, and the ledger leg", () => {
    const p = pay("INS-1002");
    expect(p.legs.chain.state === "linked" && p.legs.chain.links.map((l) => l.basis)).toEqual(["chain_tx_index", "chain_tx_single_transfer"]);
    const statuses = p.timeline.filter((t) => t.kind === "provider").map((t) => t.label);
    expect(statuses).toEqual([expect.stringMatching(/PROCESSING/), expect.stringMatching(/COMPLETE/)]);
    expect(reviewFor(p, "provider")).toBeUndefined();
    expect(linkedIds(p.legs.ledger)).toEqual(["ldg:DEP-77"]);
  });

  it("missing provider record: the chain leg links, the provider leg is missing, and similar records only rank", () => {
    const p = pay("INS-1003");
    expect(linkedIds(p.legs.chain)).toEqual([`chn:ethereum:${T3}:278`]);
    expect(p.legs.provider.state).toBe("missing");
    // TX-B-10 has the same amount and asset: offered as a suggestion, not linked.
    const sug = p.legs.provider.state === "missing" ? p.legs.provider.suggestions : [];
    expect(sug.map((c) => (rec(c.recordId) as ProviderRecord).providerPaymentId)).toContain("TX-B-10");
    expect(orphan("TX-B-10")!.legs.instruction.state).toBe("missing");
  });

  it("two candidates: two provider records carry the instruction ID, so it goes to review, never a guess", () => {
    const p = pay("INS-1004");
    const r = reviewFor(p, "provider")!;
    expect(r.reason).toBe("multiple_candidates");
    expect(r.candidates.map((c) => (rec(c.recordId) as ProviderRecord).providerPaymentId).sort()).toEqual(["TX-B-4A", "TX-B-4B"]);
    expect(r.candidates.every((c) => c.score > 0 && c.reasons.length)).toBe(true);
    // Neither candidate becomes a payment of its own while under review.
    expect(orphan("TX-B-4A")).toBeUndefined();
    expect(orphan("TX-B-4B")).toBeUndefined();
    // The instruction's own hash still links its chain leg exactly.
    expect(p.legs.chain.state).toBe("linked");
  });

  it("conflicting IDs: instruction and provider name different transactions", () => {
    const p = pay("INS-1005");
    expect(p.legs.provider.state).toBe("linked");
    const r = reviewFor(p, "chain")!;
    expect(r.reason).toBe("conflicting_ids");
    expect(r.message).toMatch(/instruction names transaction 0xe3980401…|instruction names transaction e3980401/);
    expect(r.candidates.map((c) => c.recordId).sort()).toEqual([`chn:ethereum:${T3}:278`, "chn:polygon:e3980401d5ec8cadd7fca9d35da12fa69d717ed6d449d4670981900d2d8f602a:506"]);
  });

  it("conflicting IDs: an instruction names a provider payment whose merchant reference is another instruction", () => {
    for (const id of ["INS-1006", "INS-1007"]) {
      const r = reviewFor(pay(id), "provider")!;
      expect(r.reason).toBe("conflicting_ids");
      expect(r.message).toMatch(/TX-B-6 is tied by exact identifiers to instructions INS-1006 and INS-1007/);
    }
    expect(orphan("TX-B-6")).toBeUndefined();
  });

  it("duplicate provider row: one record with two sources, flagged, still one payment", () => {
    const p = pay("INS-1001");
    const dupe = result.duplicateRecords.find((d) => d.kind === "provider" && (rec(d.recordId) as ProviderRecord).providerPaymentId === "TX-B-1")!;
    expect(dupe.sources.map((s) => (s.kind === "file" ? `${s.fileName}:${s.line}` : ""))).toEqual(["bvnk-report-1.csv:2", "bvnk-report-1.csv:3", "bvnk-report-2.csv:2"]);
    expect(p.duplicateRecords).toContain(dupe.recordId);
    expect(result.payments.filter((x) => x.identifiers.some((i) => i.value === "TX-B-1"))).toHaveLength(1);
  });

  it("a hash on no chain leaves the chain leg missing, with the reason", () => {
    const l = pay("INS-1008").legs.chain;
    expect(l).toMatchObject({ state: "missing", note: expect.stringMatching(/not found on any supported chain/) });
  });

  it("similarity never links: an instruction with no identifiers gets ranked suggestions only", () => {
    const p = pay("INS-1009");
    expect(p.legs.provider.state).toBe("missing");
    expect(p.legs.chain.state).toBe("missing");
    const prov = p.legs.provider.state === "missing" ? p.legs.provider.suggestions : [];
    expect((rec(prov[0].recordId) as ProviderRecord).providerPaymentId).toBe("TX-B-10");
    expect(prov[0].reasons).toEqual(expect.arrayContaining(["same amount (500000000)"]));
    const chain = p.legs.chain.state === "missing" ? p.legs.chain.suggestions : [];
    expect(chain[0]).toMatchObject({ recordId: `chn:tron:${T6}:0`, reasons: expect.arrayContaining(["same destination address"]) });
  });

  it("a provider record with no instruction is its own payment, linked to its transfer by hash", () => {
    const p = orphan("TX-B-10")!;
    expect(p.legs.instruction).toMatchObject({ state: "missing", note: "The provider record has no merchant reference." });
    expect(linkedIds(p.legs.chain)).toEqual([`chn:tron:${T6}:0`]);
  });

  it("a bank credit no identifier ties to anything stays unlinked: its free text is never parsed", () => {
    const bnk2 = data.records.bank.find((b) => b.bankReference === "BNK-2")!;
    expect(bnk2.remittanceInfo).toBe("Settlement INS-1003");
    expect(result.unlinked).toContainEqual({ recordId: bnk2.recordId, kind: "bank" });
    expect(pay("INS-1003").legs.bank.state).toBe("missing");
  });

  it("same input, same output", () => {
    const again = matchPayments({ instructions: data.records.instruction, provider: data.records.provider, bank: data.records.bank,
      chain: data.chain.transfers, lookups: data.chain.lookups, ledger: ledger(), depositAddresses: DEPOSITS });
    expect(again).toEqual(result);
  });
});

describe("unknowns and other providers", () => {
  it("a chain lookup that fails leaves the leg unknown, never missing", async () => {
    const { data: d } = await loaded();
    const failing = buildFetchers({ tronKey: "k", etherscanKey: "k", store: new MemoryStore(), sleep: async () => {}, noSpacing: true,
      transport: async () => { throw new Error("network down"); } });
    const out = await refreshMatching(d, failing, [], () => NOW);
    const p = out.match!.result.payments.find((x) => x.identifiers.some((i) => i.value === "INS-1001"))!;
    expect(p.legs.chain).toMatchObject({ state: "unknown", note: expect.stringMatching(/Couldn't check transaction/) });
    // The next refresh asks again.
    const retried = await refreshMatching(out, recorded(), [], () => NOW);
    expect(retried.chain.lookups.find((l) => l.txHash === T1)?.result).toBe("found");
  });

  it("another provider is another mapping: same canonical records, same match", async () => {
    const acme: Omit<ColumnMapping, "version" | "createdAt"> = {
      mappingId: "acme-pay", kind: "provider", name: "Acme Pay settlement", provider: "Acme Pay",
      columns: { provider_payment_id: "payment_id", merchant_reference: "our_ref", status: "state", amount: "amount",
        event_time: "created_ms", tx_hash: "hash", type: "kind", relates_to: "parent" },
      values: { status: { DONE: "provider_reports_complete", REFUNDED: "returned" }, type: { PAYMENT: "principal", REFUND: "return" } },
      timestampFormat: "epoch_ms",
    };
    const store = new MemoryPaymentsStore();
    expect((await saveMappingVersion(store, acme, NOW)).errors).toEqual([]);
    await applyImport(store, "instruction", "instructions.csv", file("instructions.csv"), "instructions-standard", undefined, NOW);
    const log = await applyImport(store, "provider", "acme.csv", file("acme-report.csv"), "acme-pay", undefined, NOW);
    expect(log).toMatchObject({ outcome: "imported", acceptedRows: 2, rejectedRows: 0 });
    const out = await refreshMatching(await store.load(), recorded(), [], () => NOW);
    const p = out.match!.result.payments.find((x) => x.anchor.kind === "instruction" && x.identifiers.some((i) => i.value === "INS-1001"))!;
    expect(p.legs.provider).toMatchObject({ state: "linked", links: [{ basis: "merchant_reference" }] });
    expect(new Set(linkedIds(p.legs.chain))).toEqual(new Set([`chn:tron:${T1}:0`]));
    expect(p.returns).toEqual([expect.objectContaining({ basis: "provider_payment_id", detail: "Acme Pay return row relates to AP-1" })]);
    const ap1 = out.records.provider.find((r) => r.providerPaymentId === "AP-1")!;
    expect(ap1.eventTime).toBe("2026-10-21T14:46:02.000Z");
    expect(ap1.original.created_ms).toBe("1792593962000");
  });

  it("presets are valid mappings and cite their sources", () => {
    for (const m of [BVNK_TRANSACTION_REPORT, INSTRUCTIONS_STANDARD, BANK_STANDARD]) expect(checkMapping(m)).toEqual([]);
    expect(BVNK_TRANSACTION_REPORT.sources!.every((s) => /^https:\/\/(docs|help)\.bvnk\.com\//.test(s.url))).toBe(true);
  });
});
