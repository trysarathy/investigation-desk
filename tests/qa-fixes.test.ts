// QA on main (b193133): data loss under concurrent writes, and an import path that froze the
// server. Each block was written to fail before its fix. Offline: chain keys unset, stubbed source.

import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Transport } from "@/lib/chain/http";
import { overrideChainDeps } from "@/lib/chain/live";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { FileAuditLog } from "@/lib/payments/audit";
import { refreshMatching } from "@/lib/payments/refresh";
import { FilePaymentsStore } from "@/lib/payments/store";
import { FileInboxStore, importFile } from "@/lib/payments/workflow";
import { FileWorkspaceStore } from "@/lib/workspace/store";

const I_HEAD = "instruction_id,created_at,amount,chain,token,to_address,tx_hash,transfer_index,provider_payment_id,due_by";
const rows = (prefix: string, n: number) =>
  `${I_HEAD}\n${Array.from({ length: n }, (_, i) => `${prefix}-${i},2026-10-22T05:${String(i % 60).padStart(2, "0")}:00Z,${(i % 997) + 1}.50,tron,USDT,,,,,`).join("\n")}\n`;

/** The app's chain source with no keys; public RPCs answer "not found". Never the network. */
function keyless() {
  const transport: Transport = async (req) => {
    if (/trongrid|etherscan/.test(req.url)) throw new Error("a keyed API was called without a key");
    const body = JSON.parse(req.body ?? "{}");
    const answer = (b: { id?: number }) => ({ jsonrpc: "2.0", id: b.id ?? 1, result: null });
    return { status: 200, headers: {}, body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) };
  };
  return buildFetchers({ tronKey: "", etherscanKey: "", store: new MemoryStore(), transport, sleep: async () => {}, noSpacing: true });
}

const saved = { DESK_DATA_DIR: process.env.DESK_DATA_DIR, TRONGRID_API_KEY: process.env.TRONGRID_API_KEY, ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY };
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "desk-qa-"));
  process.env.DESK_DATA_DIR = dir;
  delete process.env.TRONGRID_API_KEY;
  delete process.env.ETHERSCAN_API_KEY;
  overrideChainDeps(keyless());
});
afterAll(() => {
  overrideChainDeps(undefined);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const headers = { "x-forwarded-for": "198.51.100.9" };
async function importVia(name: string, csv: string) {
  const { POST } = await import("@/app/api/payments/imports/[kind]/route");
  const f = new FormData();
  f.set("file", new File([csv], name, { type: "text/csv" }));
  f.set("mappingId", "instructions-standard");
  f.set("actor", "QA");
  return POST(new Request("http://desk.test/api/payments/imports/instruction", { method: "POST", body: f, headers }), { params: Promise.resolve({ kind: "instruction" }) });
}
/** Matching runs in the background after an import: wait until it has caught up. */
async function matched() {
  const { GET } = await import("@/app/api/payments/match/route");
  for (let i = 0; i < 600; i++) {
    const s = await (await GET()).json();
    if (s.status === "idle") return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("matching never finished");
}

// ---- P1: no lost writes ----

describe("P1 concurrent writes", () => {
  it("20 concurrent imports + 20 concurrent inbox actions: all succeed, unique import IDs, every record present", async () => {
    const res = await Promise.all(Array.from({ length: 20 }, (_, f) => importVia(`f${f}.csv`, rows(`F${f}`, 25))));
    expect(res.map((r) => r.status)).toEqual(Array(20).fill(200));
    const logs = await Promise.all(res.map((r) => r.json()));
    expect(new Set(logs.map((l) => l.importId)).size).toBe(20);
    await matched();
    const { paymentsStore, inboxStore } = await import("@/lib/payments/live");
    const data = await paymentsStore().load();
    expect(data.imports.length).toBe(20);
    expect(data.records.instruction.length).toBe(500);
    for (let f = 0; f < 20; f++) for (let i = 0; i < 25; i++) expect(data.records.instruction.some((r) => r.instructionId === `F${f}-${i}`), `F${f}-${i}`).toBe(true);
    expect(data.match!.result.payments.length).toBe(500);

    // 20 notes on one item and 20 owners on 20 items, all at once.
    const items = Object.values((await inboxStore().load()).items).filter((i) => i.status !== "closed");
    expect(items.length).toBeGreaterThanOrEqual(20);
    const { POST: action } = await import("@/app/api/inbox/[itemId]/action/route");
    const call = (itemId: string, a: unknown) => action(new Request(`http://desk.test/api/inbox/${itemId}/action`,
      { method: "POST", body: JSON.stringify({ actor: "QA", action: a }), headers }), { params: Promise.resolve({ itemId }) });
    const acts = await Promise.all([
      ...Array.from({ length: 20 }, (_, n) => call(items[0].itemId, { kind: "note", text: `note ${n}` })),
      ...items.slice(0, 20).map((it, n) => call(it.itemId, { kind: "owner", owner: `Owner ${n}` })),
    ]);
    expect(acts.map((r) => r.status)).toEqual(Array(40).fill(200));
    const inbox = await inboxStore().load();
    expect(inbox.items[items[0].itemId].notes.map((n) => n.text).sort()).toEqual(Array.from({ length: 20 }, (_, n) => `note ${n}`).sort());
    items.slice(0, 20).forEach((it, n) => expect(inbox.items[it.itemId].owner).toBe(`Owner ${n}`));

    // The audit log has every import and action, numbered once each.
    const audit = (await readFile(path.join(dir, "audit.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(audit.filter((e) => e.action === "payments.import").length).toBe(20);
    expect(new Set(audit.map((e) => e.seq)).size).toBe(audit.length);
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  }, 60_000);

  it("every file store does read-modify-write under one lock: 20 concurrent updates, none lost", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "desk-stores-"));
    const payments = new FilePaymentsStore(path.join(d, "p.json"));
    const inbox = new FileInboxStore(path.join(d, "i.json"));
    const workspace = new FileWorkspaceStore(path.join(d, "w.json"));
    // Two instances of each on the same file, as separate requests would have.
    const twice = <T>(make: () => T) => [make(), make()];
    const ps = twice(() => new FilePaymentsStore(path.join(d, "p.json")));
    const is = twice(() => new FileInboxStore(path.join(d, "i.json")));
    const ws = twice(() => new FileWorkspaceStore(path.join(d, "w.json")));
    await Promise.all(Array.from({ length: 20 }, (_, n) => Promise.all([
      ps[n % 2].update((x) => { x.mappings.push({ mappingId: `m${n}` } as never); return [x, undefined]; }),
      is[n % 2].update((x) => { x.items[`I${n}`] = { itemId: `I${n}` } as never; return [x, undefined]; }),
      ws[n % 2].update((x) => { x.history.push({ filename: `w${n}` } as never); return [x, undefined]; }),
    ])));
    expect((await payments.load()).mappings.length).toBe(20);
    expect(Object.keys((await inbox.load()).items).length).toBe(20);
    expect((await workspace.load()).history.length).toBe(20);
    const logs = twice(() => new FileAuditLog(path.join(d, "a.jsonl")));
    await Promise.all(Array.from({ length: 40 }, (_, n) => logs[n % 2].append([{ at: "", actor: "QA", actorKind: "person", action: "t", subject: `s${n}`, detail: "" }])));
    expect((await logs[0].list()).map((e) => e.seq)).toEqual(Array.from({ length: 40 }, (_, n) => n + 1));
    expect((await readdir(d)).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

// ---- P2: the import path is linear, and matching doesn't block other requests ----

describe("P2 import performance", () => {
  it("5,000 instruction rows end to end (import, match, exceptions, inbox, saved to disk) in under 10 s", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "desk-perf-"));
    const s = { payments: new FilePaymentsStore(path.join(d, "p.json")), inbox: new FileInboxStore(path.join(d, "i.json")), audit: new FileAuditLog(path.join(d, "a.jsonl")) };
    const now = new Date("2026-10-23T08:00:00Z");
    const deps = keyless();
    const t0 = performance.now();
    const res = await importFile(s, { kind: "instruction", fileName: "big.csv", bytes: new TextEncoder().encode(rows("P", 5000)), mappingId: "instructions-standard" },
      { actor: "QA" }, now, (data) => refreshMatching(data, deps, [], () => now, { depositAddresses: [] }), []);
    const ms = performance.now() - t0;
    expect(res.log?.acceptedRows).toBe(5000);
    expect((await s.payments.load()).match!.result.payments.length).toBe(5000);
    expect(Object.keys((await s.inbox.load()).items).length).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(10_000);
  }, 120_000);

  it("the import route answers at once; matching runs in the background with progress while other requests keep answering", async () => {
    const t0 = performance.now();
    const res = await importVia("bg.csv", rows("BG", 5000));
    expect(res.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(5_000);
    const body = await res.json();
    expect(body.match).toMatchObject({ status: expect.stringMatching(/queued|running/) });
    // While it runs, the event loop keeps turning: no stall long enough to hold up a request.
    let last = performance.now(), worst = 0;
    const tick = setInterval(() => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; }, 10);
    const { GET } = await import("@/app/api/payments/match/route");
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const st = await (await GET()).json();
      if (st.step) seen.add(st.step);
      if (st.status === "idle") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    clearInterval(tick);
    expect([...seen].length).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1_500);
    const { paymentsStore } = await import("@/lib/payments/live");
    expect((await paymentsStore().load()).records.instruction.filter((r) => r.instructionId?.startsWith("BG-")).length).toBe(5000);
  }, 120_000);
});

// ---- P3: one upload limit, and a clear 413 ----

describe("P3 upload limit", () => {
  it("Next's request body cap is the route's limit (plus multipart overhead), not the 10 MB default", async () => {
    const { UPLOAD_MAX_BYTES, REQUEST_MAX_BYTES } = await import("@/lib/limits");
    // @ts-expect-error -- the Next config is plain JavaScript, without types
    const config = (await import("../next.config.mjs")).default as { experimental?: { middlewareClientMaxBodySize?: number } };
    expect(UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(config.experimental?.middlewareClientMaxBodySize).toBe(REQUEST_MAX_BYTES);
    expect(REQUEST_MAX_BYTES).toBeGreaterThan(UPLOAD_MAX_BYTES);
  });

  it("an import over the limit gets 413 saying so, before the body is read (never 'Attach a CSV file')", async () => {
    const { POST } = await import("@/app/api/payments/imports/[kind]/route");
    const big = new Request("http://desk.test/api/payments/imports/instruction", { method: "POST", body: "x",
      headers: { ...headers, "content-length": String(25 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" } });
    const r = await POST(big, { params: Promise.resolve({ kind: "instruction" }) });
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/larger than the 20 MB upload limit/);
    // A file just over the limit, with an honest body.
    const f = new FormData();
    f.set("file", new File(["a".repeat(20 * 1024 * 1024 + 1)], "big.csv", { type: "text/csv" }));
    f.set("mappingId", "instructions-standard");
    f.set("actor", "QA");
    const r2 = await POST(new Request("http://desk.test/api/payments/imports/instruction", { method: "POST", body: f, headers }), { params: Promise.resolve({ kind: "instruction" }) });
    expect(r2.status).toBe(413);
    expect((await r2.json()).error).toMatch(/larger than the 20 MB upload limit/);
  });

  it("File A/B uploads use the same limit and message", async () => {
    const { POST } = await import("@/app/api/uploads/[kind]/route");
    const big = new Request("http://desk.test/api/uploads/A", { method: "POST", body: "x",
      headers: { "content-length": String(25 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" } });
    const r = await POST(big, { params: Promise.resolve({ kind: "A" }) });
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/larger than the 20 MB upload limit/);
  });
});

// ---- P4: polish ----

describe("P4 display", () => {
  it("amounts without meaningless trailing zeros; durations in days and hours; times in SGT", async () => {
    const { displayAmount, formatSpan, formatTime } = await import("@/lib/format");
    expect(displayAmount("593.560000000000000000")).toBe("593.56");
    expect(displayAmount("77.00")).toBe("77");
    expect(displayAmount("-90.50")).toBe("-90.5");
    expect(displayAmount("0.000")).toBe("0");
    expect(displayAmount("100")).toBe("100");
    expect(displayAmount("n/a")).toBe("n/a");
    expect(formatSpan(1461)).toBe("1 d 0 h");
    expect(formatSpan(1399)).toBe("23 h 19 min");
    expect(formatSpan(45)).toBe("45 min");
    expect(formatTime("2026-10-23T05:30:00.000Z")).toBe("2026-10-23 13:30 SGT");
  });

  it("exception titles use them; the CSV export keeps exact values", async () => {
    const { MemoryPaymentsStore, applyImport } = await import("@/lib/payments/store");
    const { computeExceptions } = await import("@/lib/payments/exceptions");
    const { SAMPLE_SETTINGS } = await import("@/lib/fixtures");
    const { reconciledCsv } = await import("@/lib/payments/export");
    const store = new MemoryPaymentsStore();
    const now = new Date("2026-10-23T08:00:00Z");
    await applyImport(store, "instruction", "i.csv", new TextEncoder().encode(`${I_HEAD}\nINS-1,2026-10-22T05:35:00Z,100.10,tron,USDT,,,,,\nINS-2,2026-10-22T05:35:00Z,5,tron,USDT,,,,,\n`), "instructions-standard", undefined, now);
    await applyImport(store, "ledger", "l.csv", new TextEncoder().encode("entry_id,booked_at,amount,status,currency,instruction_id\nL-1,2026-10-22T05:50:00Z,-100.000000000000000000,POSTED,USDT,INS-1\n"), "payout-ledger-standard", undefined, now);
    const data = await refreshMatching(await store.load(), keyless(), [], () => now, { depositAddresses: [] });
    const settings = { version: 1, updatedAt: "", updatedBy: "", routes: [{ routeId: "default", name: "Any", match: {}, deadlineMinutes: 60, graceMinutes: 60,
      expectedLegs: ["instruction", "provider", "ledger"] as ("instruction" | "provider" | "ledger")[], fee: { kind: "none" as const } }] };
    void SAMPLE_SETTINGS;
    const titles = computeExceptions({ data, settings, now }).map((e) => e.title);
    expect(titles).toContain("Amount mismatch: instruction 100.1 USDT vs Ledger 100");
    expect(titles).toContain("Overdue: due 2026-10-22 14:35 SGT, still waiting for the provider record");
    expect(titles).toContain("Missing leg: no provider record 1 d 2 h after the instruction");
    expect(titles.join(" ")).not.toMatch(/\d{4}-\d{2}-\d{2}T|minutes/);
    const csv = reconciledCsv(data, { items: {}, settings } as never);
    expect(csv).toContain("-100.000000000000000000");
  });

  it("the export without an actor says 'before exporting'", async () => {
    const { GET } = await import("@/app/api/payments/export.csv/route");
    const r = await GET(new Request("http://desk.test/api/payments/export.csv"));
    expect(r.status).toBe(422);
    expect(await r.text()).toMatch(/before exporting/);
  });

  it("has a favicon", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(__dirname, "../src/app/icon.svg"))).toBe(true);
  });
});

// ---- P5: several open items on one payment are linked ----

describe("P5 related items", () => {
  it("each open item knows the other open items on its payment", async () => {
    const { alsoOpenOnPayment } = await import("@/lib/payments/inbox");
    const item = (itemId: string, paymentId: string, status = "open") =>
      ({ itemId, kind: "exception", subject: { kind: "payment", paymentId }, status, history: [], notes: [] }) as never;
    const inbox = { items: { a: item("a", "PAY-1"), b: item("b", "PAY-1"), c: item("c", "PAY-1", "closed"), d: item("d", "PAY-2"), e: item("e", "PAY-OLD") }, settings: {} } as never;
    const paymentOf = (id: string) => (id === "PAY-OLD" ? "PAY-1" : id);
    const ix = alsoOpenOnPayment(inbox, paymentOf);
    expect(ix("a").map((i: { itemId: string }) => i.itemId).sort()).toEqual(["b", "e"]);
    expect(ix("d")).toEqual([]);
    expect(ix("c").map((i: { itemId: string }) => i.itemId).sort()).toEqual(["a", "b", "e"]);
  });
});
