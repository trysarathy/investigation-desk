// Re-review fixes on PR #14. Each block was written to fail before its fix. On-chain transfers are
// real, replayed from tests/fixtures/live/bsc-payout-*.json.

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateFileB } from "@/lib/csv/files";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { RECORDINGS } from "@/lib/demo/recordings";
import { demoTransport } from "@/lib/demo/transport";
import { MemoryAuditLog } from "@/lib/payments/audit";
import { computeExceptions } from "@/lib/payments/exceptions";
import type { ColumnMapping } from "@/lib/payments/mapping";
import { refreshMatching } from "@/lib/payments/refresh";
import type { ExceptionSettings } from "@/lib/payments/settings";
import { applyImport, ledgerFromFileB, MemoryPaymentsStore, saveMappingVersion, type PaymentsData } from "@/lib/payments/store";
import type { LedgerEntryRecord } from "@/lib/payments/types";
import { fileABanner } from "@/lib/payments/view";
import { act, MemoryInboxStore, resolveReview, syncAll, type Stores } from "@/lib/payments/workflow";

const NOW = new Date("2026-10-23T08:00:00Z");
const enc = (s: string) => new TextEncoder().encode(s);
const ANA = { actor: "Ana", ip: "203.0.113.7" };
const N2 = "e348b97f471659cf7ca7b65d65bff17a896e9a36f16bddd80fde1d9f91108325"; // 273.987528 USDT to N2_TO, index 65, block time 2026-10-22T05:41:55Z
const N2_TO = "0xa34180c830e2c135b44f95cc96656818b4285466";
const recorded = () => buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
  transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true });

const TP: Omit<ColumnMapping, "version" | "createdAt"> = {
  mappingId: "tp", kind: "provider", name: "TP", provider: "TP",
  columns: { provider_payment_id: "payment_id", merchant_reference: "our_ref", status: "state", amount: "amount", currency: "currency",
    event_time: "created", tx_hash: "hash", type: "kind", relates_to: "parent" },
  values: { status: { DONE: "provider_reports_complete" }, type: { PAYMENT: "principal", FEE: "fee", REFUND: "return" } },
  timestampFormat: "iso8601_offset",
};
const SETTINGS: ExceptionSettings = { version: 1, updatedAt: "", updatedBy: "", routes: [
  { routeId: "default", name: "Any", match: {}, deadlineMinutes: 60, graceMinutes: 60, expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "none" } },
] };
const P_HEAD = "payment_id,our_ref,state,amount,currency,created,hash,kind,parent";
const I_HEAD = "instruction_id,created_at,amount,chain,token,to_address,tx_hash,transfer_index,provider_payment_id,due_by";
type Deposits = { chain: string; address: string; assignedAt?: string; retiredAt?: string }[] | undefined;

async function stores(): Promise<Stores> {
  const s: Stores = { payments: new MemoryPaymentsStore(), inbox: new MemoryInboxStore(), audit: new MemoryAuditLog() };
  await saveMappingVersion(s.payments, TP, NOW);
  return s;
}
const rematch = (ledger: LedgerEntryRecord[] = [], depositAddresses?: Deposits) => (d: PaymentsData) =>
  refreshMatching(d, recorded(), ledger, () => NOW, { depositAddresses });
async function load(s: Stores, files: [string, string, string][], ledger: LedgerEntryRecord[] = [], deposits?: Deposits) {
  for (const [kind, mapping, csv] of files) await applyImport(s.payments, kind as "instruction", `${kind}.csv`, enc(csv), mapping, undefined, NOW);
  await s.payments.save(await rematch(ledger, deposits)(await s.payments.load()));
}
const byIns = (d: PaymentsData, id: string) => d.match!.result.payments.find((p) => p.anchor.kind === "instruction" && p.anchor.recordId.startsWith(`ins:${id}:`))!;
const fileB = () => {
  const v = validateFileB(enc(`deposit_id,tx_hash,chain,token,to_address,amount,status,credited_at,customer_id,transfer_index\nDEP-1,0x${N2},bsc,USDT,${N2_TO},273.987528,CREDITED,2026-10-22T06:00:00Z,C-1,65\n`));
  return ledgerFromFileB(v.rows, v.sha256, NOW.toISOString());
};
// A payout to N2 with every other leg in place: only the ledger leg is in question.
const PAYOUT: [string, string, string][] = [
  ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-22T05:35:00Z,273.987528,bsc,USDT,,0x${N2},65,,\n`],
  ["provider", "tp", `${P_HEAD}\nAP-1,INS-1,DONE,273.987528,USDT,2026-10-22T05:43:00Z,0x${N2},PAYMENT,\n`],
];
const PAYOUT_LEDGER: [string, string, string] = ["ledger", "payout-ledger-standard", "entry_id,booked_at,amount,status,currency,instruction_id\nL-1,2026-10-22T05:50:00Z,-273.987528,POSTED,USDT,INS-1\n"];

// ---- 1. A merge doesn't reopen a person's close when the facts are the same ----

describe("merge and a person's close", () => {
  it("Ana closes amount mismatch 100 vs 90 on X; X merges into Y; it stays closed with her owner and history", async () => {
    const s = await stores();
    // X: the provider record alone (100 USDT), and the ledger booked 90 for it.
    await load(s, [
      ["provider", "tp", `${P_HEAD}\nAP-9,INS-9,DONE,100,USDT,2026-10-23T06:00:00Z,,PAYMENT,\n`],
      ["ledger", "payout-ledger-standard", "entry_id,booked_at,amount,status,currency,provider_payment_id\nL-9,2026-10-23T06:10:00Z,-90,POSTED,USDT,AP-9\n"],
    ]);
    const X = (await s.payments.load()).match!.result.payments[0].paymentId;
    const inbox1 = await syncAll(s, { now: NOW });
    const amountX = `EXC-${X.slice(4)}-amount_mismatch`;
    expect(inbox1.items[amountX].title).toBe("Amount mismatch: provider 100 USDT vs Ledger 90");
    await act(s, amountX, { kind: "owner", owner: "Ana" }, ANA, NOW);
    await act(s, amountX, { kind: "status", to: "closed", why: "Ledger booked net of a fee agreed by email." }, ANA, NOW);

    // The instruction arrives in two versions, then the right one is confirmed: X merges into Y,
    // which now has the instruction's 100 as its reference. The same 100 vs 90 disagreement.
    await load(s, [["instruction", "instructions-standard", `${I_HEAD}\nINS-9,2026-10-23T05:55:00Z,100,tron,USDT,,,,,\nINS-9,2026-10-23T05:55:00Z,101,tron,USDT,,,,,\n`]]);
    await syncAll(s, { now: NOW });
    const d2 = await s.payments.load();
    const review = d2.match!.result.reviews.find((r) => r.leg === "instruction")!;
    const right = review.candidates.find((c) => d2.records.instruction.find((i) => i.recordId === c.recordId)!.amount === "100")!;
    await resolveReview(s, { reviewId: review.reviewId, recordId: right.recordId, action: "confirm", why: "101 was a typo." }, ANA, NOW, rematch());
    const Y = byIns(await s.payments.load(), "INS-9").paymentId;
    expect(Y).not.toBe(X);

    const item = (await s.inbox.load()).items[`EXC-${Y.slice(4)}-amount_mismatch`];
    expect(item.title).toBe("Amount mismatch: instruction 100 USDT vs Ledger 90");
    expect(item.status).toBe("closed");
    expect(item.owner).toBe("Ana");
    // Her entries stay; the system only notes that the payment waited in a review, then moved.
    expect(item.history.map((h) => [h.action, h.by])).toEqual([["opened", "system"], ["owner", "Ana"], ["status", "Ana"], ["held", "system"], ["moved", "system"]]);
  });
});

// ---- 2. No File A: deposit rows can't be classified, so the ledger leg is unknown ----

describe("File A not loaded", () => {
  it("a deposit row matching the transfer leaves the ledger leg unknown, never missing; nothing High depends on it", async () => {
    const s = await stores();
    await load(s, PAYOUT, fileB(), undefined);
    const d = await s.payments.load();
    expect(byIns(d, "INS-1").legs.ledger).toMatchObject({ state: "unknown", note: expect.stringMatching(/File A not loaded/) });
    const excs = computeExceptions({ data: d, settings: SETTINGS, now: NOW }).filter((e) => e.subject.kind === "payment");
    expect(excs.some((e) => e.code === "missing_leg")).toBe(false);
    const overdue = excs.find((e) => e.code === "overdue")!;
    expect(overdue.confidence).toBe("Medium");
    expect(overdue.title).toMatch(/File A not loaded/);
    expect(excs.filter((e) => e.confidence === "High")).toEqual([]);
  });

  it("File A loaded without the address: the transfer is outbound and the deposit row doesn't link", async () => {
    const s = await stores();
    await load(s, PAYOUT, fileB(), []);
    expect(byIns(await s.payments.load(), "INS-1").legs.ledger.state).toBe("missing");
  });

  it("the Payments page asks for File A when deposit ledger rows can't be matched", () => {
    expect(fileABanner({ fileALoaded: false, depositLedgerRows: 1 })).toBe("Load File A to match deposit ledger rows.");
    expect(fileABanner({ fileALoaded: true, depositLedgerRows: 1 })).toBeUndefined();
    expect(fileABanner({ fileALoaded: false, depositLedgerRows: 0 })).toBeUndefined();
  });
});

// ---- 3. Direction changes go to review; File A windows count ----

describe("ledger direction", () => {
  it("a linked payout row whose transfer now counts as inbound is not unlinked: it goes to a 'direction changed' review", async () => {
    const s = await stores();
    await load(s, [...PAYOUT, PAYOUT_LEDGER], [], []);
    const d1 = await s.payments.load();
    expect(byIns(d1, "INS-1").legs.ledger).toMatchObject({ state: "linked", links: [{ basis: "instruction_id" }] });
    // N2's recipient is now in File A, assigned before the transfer.
    const d2 = await rematch([], [{ chain: "bsc", address: N2_TO, assignedAt: "2026-10-01T00:00:00Z" }])(d1);
    const p = byIns(d2, "INS-1");
    expect(p.legs.ledger.state).toBe("needs_review");
    const rev = d2.match!.result.reviews.find((r) => r.paymentId === p.paymentId && r.leg === "ledger")!;
    expect(rev.reason).toBe("direction_changed");
    expect(rev.message).toMatch(/was linked when this transfer counted as outbound.*now counts as inbound/);
    expect(rev.candidates.map((c) => c.recordId)).toEqual([expect.stringMatching(/^ldp:L-1:/)]);
    expect(d2.match!.result.unlinked.some((u) => u.recordId.startsWith("ldp:L-1:"))).toBe(false);
  });

  it("File A assignment windows: inbound only if the address was assigned at the transfer's block time", async () => {
    const run = async (window: { assignedAt: string; retiredAt?: string }) => {
      const s = await stores();
      await load(s, [...PAYOUT, PAYOUT_LEDGER], fileB(), [{ chain: "bsc", address: N2_TO, ...window }]);
      const l = byIns(await s.payments.load(), "INS-1").legs.ledger;
      return l.state === "linked" ? l.links[0].recordId : l.state;
    };
    // Assigned before the transfer (05:41:55Z): inbound, so the deposit row is the ledger leg.
    expect(await run({ assignedAt: "2026-10-01T00:00:00Z" })).toBe("ldg:DEP-1");
    // Assigned after it: the address wasn't a deposit address then; outbound, the payout row.
    expect(await run({ assignedAt: "2026-10-22T06:00:00Z" })).toMatch(/^ldp:L-1:/);
    // Retired before it: outbound too.
    expect(await run({ assignedAt: "2026-10-01T00:00:00Z", retiredAt: "2026-10-22T05:00:00Z" })).toMatch(/^ldp:L-1:/);
  });
});

// ---- 4. The import and clear routes write audit entries ----

describe("import and clear routes (as the app calls them)", () => {
  let dir: string;
  const saved = process.env.DESK_DATA_DIR;
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), "desk-")); process.env.DESK_DATA_DIR = dir; });
  afterAll(() => { if (saved === undefined) delete process.env.DESK_DATA_DIR; else process.env.DESK_DATA_DIR = saved; });

  it("write audit entries with actor, time and IP; refuse without an actor", async () => {
    const { POST: importRoute } = await import("@/app/api/payments/imports/[kind]/route");
    const { POST: clearRoute } = await import("@/app/api/payments/clear/route");
    const headers = { "x-forwarded-for": "198.51.100.4, 10.0.0.1" };
    const form = (actor?: string) => {
      const f = new FormData();
      f.set("file", new File([`${I_HEAD}\nINS-1,2026-10-22T05:35:00Z,1,tron,USDT,,,,,\n`], "instructions.csv", { type: "text/csv" }));
      f.set("mappingId", "instructions-standard");
      if (actor !== undefined) f.set("actor", actor);
      return f;
    };
    const kind = { params: Promise.resolve({ kind: "instruction" }) };

    const refused = await importRoute(new Request("http://desk.test/api/payments/imports/instruction", { method: "POST", body: form(), headers }), kind);
    expect(refused.status).toBe(422);
    const ok = await importRoute(new Request("http://desk.test/api/payments/imports/instruction", { method: "POST", body: form("Ana"), headers }), kind);
    expect(ok.status).toBe(200);
    expect((await clearRoute(new Request("http://desk.test/api/payments/clear", { method: "POST", body: JSON.stringify({}), headers }))).status).toBe(422);
    expect((await clearRoute(new Request("http://desk.test/api/payments/clear", { method: "POST", body: JSON.stringify({ actor: "Ana" }), headers }))).status).toBe(200);

    const log = (await readFile(path.join(dir, "audit.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const mine = log.filter((e) => e.actorKind === "person");
    expect(mine.map((e) => e.action)).toEqual(["payments.import", "payments.clear"]);
    for (const e of mine) {
      expect(e).toMatchObject({ actor: "Ana", ip: "198.51.100.4" });
      expect(Number.isNaN(Date.parse(e.at))).toBe(false);
    }
    expect(mine[0]).toMatchObject({ subject: "instructions.csv", detail: expect.stringMatching(/^instruction file instructions\.csv .*: imported, 1 accepted/) });
  });
});
