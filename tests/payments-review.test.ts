// Review fixes on PR #12 (payments chunk 1). Each block was written to fail before its fix.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LiveDeps } from "@/lib/chain/investigate";
import type { ChainLookupResult } from "@/lib/chain/types";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { RECORDINGS } from "@/lib/demo/recordings";
import { demoTransport } from "@/lib/demo/transport";
import { fetchTransfers } from "@/lib/payments/chain";
import { importWithMapping, type ColumnMapping } from "@/lib/payments/mapping";
import { matchPayments, type MatchInput } from "@/lib/payments/match";
import { BANK_STANDARD, BVNK_TRANSACTION_REPORT, INSTRUCTIONS_STANDARD } from "@/lib/payments/presets";
import { refreshMatching } from "@/lib/payments/refresh";
import { applyImport, MemoryPaymentsStore } from "@/lib/payments/store";
import type {
  BankRecord, CanonicalPayment, ChainTransferRecord, InstructionRecord, MatchResult, PaymentRecord, ProviderRecord,
} from "@/lib/payments/types";
import type { Chain, ChainTx } from "@/lib/types";

const NOW = new Date("2026-10-23T08:00:00Z");
const enc = (s: string) => new TextEncoder().encode(s);
const ctx = { importId: "t", fileName: "t.csv", now: NOW };

const PROVIDER: ColumnMapping = {
  mappingId: "test-provider", version: 1, kind: "provider", name: "Test provider", provider: "TP", createdAt: NOW.toISOString(),
  columns: { provider_payment_id: "payment_id", merchant_reference: "our_ref", status: "state", amount: "amount", event_time: "created",
    tx_hash: "hash", chain: "chain", type: "kind", relates_to: "parent" },
  values: { status: { DONE: "provider_reports_complete", PROC: "processing", REFUNDED: "returned" },
    type: { PAYMENT: "principal", FEE: "fee", REFUND: "return" } },
  timestampFormat: "iso8601_offset",
};

function rows<T extends PaymentRecord>(m: ColumnMapping, csv: string): T[] {
  const r = importWithMapping(enc(csv), m, ctx);
  expect(r.fileErrors).toEqual([]);
  expect(r.rowErrors).toEqual([]);
  return r.rows as T[];
}
const instructions = (body: string) => rows<InstructionRecord>(INSTRUCTIONS_STANDARD,
  `instruction_id,created_at,amount,chain,token,to_address,tx_hash,transfer_index,provider_payment_id,due_by\n${body}\n`);
const provider = (body: string) => rows<ProviderRecord>(PROVIDER, `payment_id,our_ref,state,amount,created,hash,chain,kind,parent\n${body}\n`);
const bank = (body: string) => rows<BankRecord>(BANK_STANDARD,
  `bank_reference,booked_at,value_date,amount,currency,direction,instruction_id,provider_payment_id,remittance_info,return_of\n${body}\n`);

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
function transfer(chain: Chain, hash: string, index = 0): ChainTransferRecord {
  return { recordId: `chn:${chain}:${hash}:${index}`, kind: "chain_transfer", chain, txHash: hash, transferIndex: index, txStatus: "success",
    token: "USDT", amount: "100.00", to: "0x00000000000000000000000000000000000000aa", blockNumber: 1, transfersInTx: 1,
    eventTime: "2026-10-21T10:00:00Z", observedTime: NOW.toISOString(), identifiers: [], original: {},
    sources: [{ kind: "chain", url: "https://example.invalid", rawSha256: [], fetchedAt: NOW.toISOString() }] };
}
const match = (i: Partial<MatchInput>): MatchResult =>
  matchPayments({ instructions: [], provider: [], bank: [], chain: [], lookups: [], ...i });
const forIns = (r: MatchResult, id: string): CanonicalPayment =>
  r.payments.find((p) => p.anchor.kind === "instruction" && p.anchor.recordId.startsWith(`ins:${id}:`))!;

// ---- 1. Returns and fees attach only through a linked provider leg ----

describe("returns and fees via relates_to", () => {
  // INS-1 names provider payment AP-1, but AP-1's merchant reference is INS-2: the provider leg is in review.
  const input = {
    instructions: instructions(["INS-1,2026-10-21T10:00:00Z,100.00,,,,,,AP-1,", "INS-2,2026-10-21T10:00:00Z,100.00,,,,,,,"].join("\n")),
    provider: provider([
      "AP-1,INS-2,DONE,100.00,2026-10-21T10:05:00Z,,,PAYMENT,",
      "AP-1R,,REFUNDED,100.00,2026-10-22T10:00:00Z,,,REFUND,AP-1",
      "AP-1F,,DONE,1.00,2026-10-21T10:05:00Z,,,FEE,AP-1",
    ].join("\n")),
  };

  it("are not attached while the provider leg is under review; the payment gets a review instead", () => {
    const r = match(input);
    const p = forIns(r, "INS-1");
    expect(p.legs.provider.state).toBe("needs_review");
    expect(p.returns).toEqual([]);
    expect(p.fees).toEqual([]);
    const reviews = r.reviews.filter((x) => x.paymentId === p.paymentId && (x.leg === "returns" || x.leg === "fees"));
    expect(reviews.map((x) => [x.leg, x.reason]).sort()).toEqual([["fees", "provider_leg_not_linked"], ["returns", "provider_leg_not_linked"]]);
    expect(reviews.find((x) => x.leg === "returns")!.message).toMatch(/AP-1R relates to TP payment AP-1, but this payment's provider leg is not linked/);
    // Held by a review, so not listed as unlinked either.
    expect(r.unlinked.map((u) => u.recordId)).not.toContain(input.provider[1].recordId);
  });

  it("still attach once the provider leg links", () => {
    const fixed = { ...input, provider: provider([
      "AP-1,INS-1,DONE,100.00,2026-10-21T10:05:00Z,,,PAYMENT,",
      "AP-1R,,REFUNDED,100.00,2026-10-22T10:00:00Z,,,REFUND,AP-1",
    ].join("\n")) };
    const p = forIns(match(fixed), "INS-1");
    expect(p.legs.provider.state).toBe("linked");
    expect(p.returns).toEqual([expect.objectContaining({ basis: "provider_payment_id" })]);
  });
});

// ---- 2. A conflicted instruction holds its provider and chain legs too ----

describe("instruction that arrived with conflicting content", () => {
  it("sends its provider and chain legs to review, not just the instruction leg", () => {
    const r = match({
      instructions: instructions([
        `INS-1,2026-10-21T10:00:00Z,100.00,ethereum,USDT,,${HASH_A},0,,`,
        `INS-1,2026-10-21T10:00:00Z,200.00,ethereum,USDT,,${HASH_A},0,,`,
      ].join("\n")),
      provider: provider(`AP-1,INS-1,DONE,100.00,2026-10-21T10:05:00Z,${HASH_A},ethereum,PAYMENT,`),
      chain: [transfer("ethereum", HASH_A)],
      lookups: [{ txHash: HASH_A, result: "found", chain: "ethereum", checkedAt: NOW.toISOString() }],
    });
    const p = forIns(r, "INS-1");
    expect([p.legs.instruction.state, p.legs.provider.state, p.legs.chain.state]).toEqual(["needs_review", "needs_review", "needs_review"]);
    const provReview = r.reviews.find((x) => x.paymentId === p.paymentId && x.leg === "provider")!;
    expect(provReview.reason).toBe("conflicting_record");
    expect(provReview.message).toMatch(/Instruction INS-1 arrived with different amount/);
    // The provider record waits in that review; it doesn't become a payment of its own.
    expect(r.payments.filter((x) => x.anchor.kind === "provider")).toEqual([]);
  });
});

// ---- 3. Bank rows whose identifiers disagree ----

describe("bank row identifiers", () => {
  const base = {
    instructions: instructions(["INS-1,2026-10-21T10:00:00Z,100.00,,,,,,,", "INS-2,2026-10-21T10:00:00Z,50.00,,,,,,,"].join("\n")),
    provider: provider(["AP-1,INS-1,DONE,100.00,2026-10-21T10:05:00Z,,,PAYMENT,", "AP-2,INS-2,DONE,50.00,2026-10-21T10:05:00Z,,,PAYMENT,"].join("\n")),
  };

  it("a provider ID that exists nowhere: conflicting IDs, not a link on the instruction ID", () => {
    const r = match({ ...base, bank: bank("BNK-1,2026-10-21T12:00:00Z,,100.00,USD,DBIT,INS-1,AP-404,,") });
    const p = forIns(r, "INS-1");
    expect(p.legs.bank.state).toBe("needs_review");
    const rev = r.reviews.find((x) => x.paymentId === p.paymentId && x.leg === "bank")!;
    expect(rev.reason).toBe("conflicting_ids");
    expect(rev.message).toMatch(/BNK-1 names instruction INS-1 and provider payment AP-404, which no payment has/);
  });

  it("IDs of two different payments: both go to review", () => {
    const r = match({ ...base, bank: bank("BNK-1,2026-10-21T12:00:00Z,,100.00,USD,DBIT,INS-1,AP-2,,") });
    for (const id of ["INS-1", "INS-2"]) {
      const p = forIns(r, id);
      expect(r.reviews.find((x) => x.paymentId === p.paymentId && x.leg === "bank")?.reason).toBe("conflicting_ids");
    }
  });

  it("both IDs of the same payment: links", () => {
    const r = match({ ...base, bank: bank("BNK-1,2026-10-21T12:00:00Z,,100.00,USD,DBIT,INS-1,AP-1,,") });
    expect(forIns(r, "INS-1").legs.bank.state).toBe("linked");
  });
});

// ---- 4. A hash on more than one chain, or with a chain that didn't answer ----

function tx(chain: Chain, hash: string): ChainTx {
  return { chain, hash: chain === "tron" ? hash : `0x${hash}`, status: "success", blockNumber: 10, blockTime: "2026-10-21T10:00:00Z", isBatch: false,
    transfers: [{ logIndex: 5, tokenContract: "0x00000000000000000000000000000000000000cc", tokenSymbol: "USDT", from: "0x00000000000000000000000000000000000000bb", to: "0x00000000000000000000000000000000000000aa", amount: "100.00" }] };
}
/** Fake chain clients: per chain, the transaction, "not found", or a failure. */
function stubDeps(answers: Partial<Record<Chain, "found" | "error">>): LiveDeps {
  const answer = (chain: Chain, hash: string): ChainLookupResult => {
    const a = answers[chain];
    if (a === "error") throw new Error("upstream 503");
    const lookup = { chain, result: a === "found" ? "found" as const : "not_found" as const, fetchedAt: NOW.toISOString(), sourceUrl: "https://example.invalid", rawBody: "" };
    return a === "found" ? { lookup, tx: tx(chain, hash), currentBlock: 20 } : { lookup };
  };
  return { tron: { lookup: async (h: string) => answer("tron", h) }, evm: { lookup: async (c: Chain, h: string) => answer(c, h) } } as unknown as LiveDeps;
}
async function chainCase(answers: Partial<Record<Chain, "found" | "error">>, chainColumn: string) {
  const fetched = await fetchTransfers([HASH_B], stubDeps(answers), () => NOW);
  return match({ instructions: instructions(`INS-1,2026-10-21T10:00:00Z,100.00,${chainColumn},,,${HASH_B},,,`), chain: fetched.transfers, lookups: fetched.lookups });
}

describe("chain lookups across chains", () => {
  it("found on two chains: review, never a pick", async () => {
    for (const chainColumn of ["", "bsc"]) {
      const r = await chainCase({ ethereum: "found", bsc: "found" }, chainColumn);
      const p = forIns(r, "INS-1");
      expect(p.legs.chain.state).toBe("needs_review");
      const rev = r.reviews.find((x) => x.paymentId === p.paymentId && x.leg === "chain")!;
      expect(rev.reason).toBe("multiple_candidates");
      expect(rev.message).toMatch(/exists on Ethereum and BNB Chain/);
      expect(rev.candidates).toHaveLength(2);
    }
  });

  it("found on one chain while another failed, and the record gives no chain: unknown", async () => {
    const r = await chainCase({ bsc: "found", ethereum: "error" }, "");
    expect(forIns(r, "INS-1").legs.chain).toMatchObject({ state: "unknown", note: expect.stringMatching(/Ethereum didn't answer/) });
  });

  it("the record names the chain it was found on: links even though another chain failed", async () => {
    const r = await chainCase({ bsc: "found", ethereum: "error" }, "bsc");
    expect(forIns(r, "INS-1").legs.chain.state).toBe("linked");
  });

  it("the record names the chain that failed: unknown, not a chain mismatch", async () => {
    const r = await chainCase({ bsc: "found", ethereum: "error" }, "ethereum");
    expect(forIns(r, "INS-1").legs.chain).toMatchObject({ state: "unknown", note: expect.stringMatching(/Ethereum didn't answer/) });
  });
});

// ---- 5. Due vs created compares instants ----

describe("due_by against created_at", () => {
  const read = (created: string, due: string) => importWithMapping(enc(
    `instruction_id,created_at,amount,due_by\nINS-1,${created},1,${due}\n`), { ...INSTRUCTIONS_STANDARD, columns: { instruction_id: "instruction_id", created_at: "created_at", amount: "amount", due_by: "due_by" } }, ctx);

  it("accepts a due time that is later as an instant though earlier as text", () => {
    // 10:00+08:00 is 02:00Z; 05:00Z is three hours later.
    const r = read("2026-10-21T10:00:00+08:00", "2026-10-21T05:00:00Z");
    expect(r.rowErrors).toEqual([]);
  });

  it("rejects a due time that is earlier as an instant though later as text", () => {
    // 09:00+08:00 is 01:00Z, before 01:30Z.
    const r = read("2026-10-21T01:30:00Z", "2026-10-21T09:00:00+08:00");
    expect(r.rowErrors).toEqual([expect.objectContaining({ line: 2, column: "due_by", message: "Due before it was created." })]);
  });
});

// ---- 6. Epoch timestamps: range per unit, never a crash ----

describe("epoch timestamps", () => {
  const read = (format: string, value: string) => importWithMapping(enc(`payment_id,state,amount,created\nAP-1,DONE,1,${value}\n`),
    { ...PROVIDER, timestampFormat: format as ColumnMapping["timestampFormat"],
      columns: { provider_payment_id: "payment_id", status: "state", amount: "amount", event_time: "created" } }, ctx);

  it("milliseconds out of range is a row error, not a crash", () => {
    expect(() => read("epoch_ms", "9999999999999999")).not.toThrow();
    expect(read("epoch_ms", "9999999999999999").rowErrors[0]).toMatchObject({ column: "created", message: expect.stringMatching(/out of range/) });
  });

  it("seconds in a milliseconds column is a row error (it would read as January 1970)", () => {
    expect(read("epoch_ms", "1792593962").rowErrors[0]).toMatchObject({ column: "created", message: expect.stringMatching(/out of range/) });
  });

  it("a seconds mapping reads seconds, and rejects milliseconds", () => {
    const ok = read("epoch_s", "1792593962");
    expect(ok.rowErrors).toEqual([]);
    expect(ok.rows[0].eventTime).toBe("2026-10-21T14:46:02.000Z");
    expect(read("epoch_s", "1792593962000").rowErrors[0]).toMatchObject({ message: expect.stringMatching(/out of range/) });
  });

  it("anything but whole digits is a row error", () => {
    for (const v of ["1.79e12", "-1792593962000", "1792593962000.5"]) expect(read("epoch_ms", v).rowErrors).toHaveLength(1);
  });
});

// ---- 7. Amounts compare as decimals when grouping versions ----

describe("grouping versions of one provider payment", () => {
  it("100.00 and 100.000000 are the same amount: a status history, not a conflict", () => {
    const r = match({
      instructions: instructions("INS-1,2026-10-21T10:00:00Z,100.00,,,,,,,"),
      provider: provider(["AP-1,INS-1,PROC,100.00,2026-10-21T10:05:00Z,,,PAYMENT,", "AP-1,INS-1,DONE,100.000000,2026-10-21T10:09:00Z,,,PAYMENT,"].join("\n")),
    });
    const p = forIns(r, "INS-1");
    expect(p.legs.provider.state).toBe("linked");
    expect(p.timeline.filter((t) => t.kind === "provider")).toHaveLength(2);
  });

  it("a different amount is still a conflict", () => {
    const r = match({
      instructions: instructions("INS-1,2026-10-21T10:00:00Z,100.00,,,,,,,"),
      provider: provider(["AP-1,INS-1,PROC,100.00,2026-10-21T10:05:00Z,,,PAYMENT,", "AP-1,INS-1,DONE,100.01,2026-10-21T10:09:00Z,,,PAYMENT,"].join("\n")),
    });
    expect(forIns(r, "INS-1").legs.provider.state).toBe("needs_review");
  });
});

// ---- Decision: payment IDs never change once assigned ----

describe("payment ID stability", () => {
  const dir = path.join(__dirname, "fixtures/payments");
  const file = (n: string) => new Uint8Array(readFileSync(path.join(dir, n)));
  const recorded = () => buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
    transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true });

  it("a provider-only payment keeps its ID when its instruction arrives, and the instruction links to it", async () => {
    const store = new MemoryPaymentsStore();
    await applyImport(store, "provider", "bvnk-report-1.csv", file("bvnk-report-1.csv"), BVNK_TRANSACTION_REPORT.mappingId, undefined, NOW);
    const before = await refreshMatching(await store.load(), recorded(), [], () => NOW);
    const providerOnly = before.match!.result.payments.find((p) => p.identifiers.some((i) => i.role === "provider_payment_id" && i.value === "TX-B-1"))!;
    expect(providerOnly.anchor.kind).toBe("provider");
    expect(providerOnly.legs.instruction.state).toBe("missing");
    await store.save(before);

    await applyImport(store, "instruction", "instructions.csv", file("instructions.csv"), INSTRUCTIONS_STANDARD.mappingId, undefined, NOW);
    const after = await refreshMatching(await store.load(), recorded(), [], () => NOW);
    const same = after.match!.result.payments.find((p) => p.paymentId === providerOnly.paymentId)!;
    expect(same).toBeDefined();
    expect(same.legs.instruction.state).toBe("linked");
    expect(same.identifiers.some((i) => i.role === "instruction_id" && i.value === "INS-1001")).toBe(true);
    // IDs stay unique, and every other payment that existed before keeps its ID too.
    const ids = after.match!.result.payments.map((p) => p.paymentId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of before.match!.result.payments) {
      // The provider record's own ID (not an instruction column that merely names it).
      const fromProvider = (i: CanonicalPayment["identifiers"][number]) => i.kind === "provider" && i.role === "provider_payment_id";
      const key = p.identifiers.find(fromProvider)!.value;
      const now = after.match!.result.payments.find((x) => x.identifiers.some((i) => fromProvider(i) && i.value === key));
      if (now) expect(now.paymentId).toBe(p.paymentId);
    }
    // And again: nothing moves on a re-run.
    await store.save(after);
    const again = await refreshMatching(await store.load(), recorded(), [], () => NOW);
    expect(again.match!.result.payments.map((p) => p.paymentId).sort()).toEqual([...ids].sort());
  });
});

// ---- BVNK preset notes ----

describe("BVNK preset", () => {
  it("flags the settled-amount column as unconfirmed", () => {
    expect(BVNK_TRANSACTION_REPORT.columns.amount).toBe("Amount");
    expect(BVNK_TRANSACTION_REPORT.notes!.join(" ")).toMatch(/"Amount" as the settled amount is unconfirmed.*Transaction Amount.*Paid Actual Amount.*Required Amount/);
    expect(BVNK_TRANSACTION_REPORT.notes!.join(" ")).toMatch(/Column names confirmed against help\.bvnk\.com/);
  });
});
