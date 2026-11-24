/**
 * Demo build, against a real PostgreSQL 16: the demo world seeded through the app's own services (src/server/
 * demo-seed.ts), then
 *   - seed determinism: the same world seeded twice (a second copy with a slug suffix) holds the same content;
 *   - the three documented cases' exact numbers inside the seeded demo dataset;
 *   - the label "Demo · fictional data" for the demo tenant, never for a live one (and live stays "Your data");
 *   - recorded chain data: refused for the demo org in a non-demo build, refused for a live org in a demo build,
 *     honoured for the demo org in a demo build (the build constants simulated as next.config.mjs inlines them);
 *   - demo-files/ through the real upload pipeline in the demo tenant (a second person confirms the bank statement),
 *     with the outcomes recorded in demo-files/expected-outcomes.json (CLEARLINE_DEMO_FILES_RECORD=1 rewrites it);
 *   - the reset restores the database exactly (every table's rows hashed before a mutation and after the reset), in
 *     under 30 s, and the app's pool recovers.
 * The reset needs a superuser of the test server: CLEARLINE_TEST_SUPER_URL, or by default the owner URL's host and
 * port as the `postgres` user without a password (local trust). Demo · fictional data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetBlank } from "./harness";
import { accountFields, useTestStorage } from "./upload-harness";
import { closeDatabase, database } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { seedDemo, restampDemoSeed, DEMO_USERS, type DemoStampWindow } from "../../src/server/demo-seed";
import { resetDemoDatabase, snapshotDemoTemplate } from "../../src/server/demo-reset";
import { createMerchant, addEntity } from "../../src/server/merchant-setup";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { batchBridge, runReconciliation, proposeWriteoff } from "../../src/server/merchant";
import { merchantShell } from "../../src/server/merchant-ui";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { ChainRecordingRefused } from "../../src/server/test-build";
import { DemoRecordingRefused } from "../../src/server/demo-build";
import { DEMO_DATA_LABEL, LIVE_DATA_LABEL } from "../../src/lib/clearline/data-mode";
import { recordingOf } from "../../src/lib/clearline/merchant/chain";
import { DEMO_ENTITY_IDS, DEMO_MERCHANT, demoWorld } from "../../src/lib/clearline/demo/world";
import { allDemoTransfers } from "../../src/lib/clearline/demo/next-day";
import { installDemoClock } from "../../scripts/demo/clock";
import { FILES, demoFiles } from "../../scripts/demo/make-demo-files";
import type { Mapping } from "../../src/lib/clearline/mapping";

const DEMO_DIR = path.resolve(__dirname, "../../demo-files");
const EXPECTED = path.join(DEMO_DIR, "expected-outcomes.json");
const PASSWORD = "demo-test-password-0001";
const recording = recordingOf(allDemoTransfers(demoWorld()));
const recordingFile = path.join(mkdtempSync(path.join(tmpdir(), "clearline-demo-chain-")), "chain.json");
writeFileSync(recordingFile, JSON.stringify(recording));

let orgId = "";
let stampWindows: DemoStampWindow[] = [];
const users: Record<string, TenantContext> = {};
let n = 0;
const key = () => `demo-test-${++n}-${Date.now()}`;
const envBefore = { ...process.env };
const nextBuild = (o: { demo: boolean }) => { process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = o.demo ? "1" : ""; process.env.CLEARLINE_CHAIN_RECORDING = recordingFile; };
const noBuild = () => { for (const k of ["CLEARLINE_NEXT_BUILD", "CLEARLINE_TEST_BUILD", "CLEARLINE_DEMO_BUILD", "CLEARLINE_CHAIN_RECORDING"]) { if (envBefore[k] === undefined) delete process.env[k]; else process.env[k] = envBefore[k]; } };

// ---------------------------------------------------------------- fingerprints

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TS = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:\d{2})?)?/g;
/** Content of every org-scoped table for one org, without ids, times or the slug suffix. */
async function contentFingerprint(org: string, sfx = ""): Promise<Record<string, string>> {
  const db = ownerDb();
  const tables = (await db.execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'org_id' order by 1`)).rows.map((r) => String(r.table_name));
  const out: Record<string, string> = {};
  for (const tb of tables) {
    if (["audit_events", "idempotency_records"].includes(tb)) continue; // name the actor and the key: not content
    const rows = (await db.execute(sql.raw(`select row_to_json(x)::text as j from "${tb}" x where org_id = '${org}'`))).rows.map((r) => String(r.j)
      .replace(UUID, "U").replace(TS, "T").split(sfx || "\u0000").join(""));
    rows.sort();
    out[tb] = `${rows.length}:${createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16)}`;
  }
  return out;
}
/** Every row of every public table, hashed per table (exact: ids and times included). */
async function exactFingerprint(url: string): Promise<Record<string, string>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const tables = (await c.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => String(r.tablename));
    const out: Record<string, string> = {};
    for (const tb of tables) {
      const r = await c.query(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${tb}" x`);
      out[tb] = `${r.rows[0].n}:${r.rows[0].h}`;
    }
    return out;
  } finally { await c.end(); }
}

const ownerUrl = () => process.env.CLEARLINE_TEST_OWNER_URL!;
const testDbName = () => new URL(ownerUrl()).pathname.slice(1);
function superUrl(db = "postgres"): string {
  const u = new URL(process.env.CLEARLINE_TEST_SUPER_URL ?? ownerUrl());
  if (!process.env.CLEARLINE_TEST_SUPER_URL) { u.username = "postgres"; u.password = ""; }
  u.pathname = `/${db}`;
  return u.toString();
}

// ---------------------------------------------------------------- seed

beforeAll(async () => {
  await resetBlank();
  useTestStorage();
  const clock = installDemoClock();
  try {
    const r = await seedDemo(ownerDb(), { password: PASSWORD, recording, setClock: clock.set });
    orgId = r.orgs.merchant;
    stampWindows = r.stampWindows;
    expect(r).toMatchObject({ days: 30, runs: 90 });
  } finally { clock.restore(); }
  for (const u of DEMO_USERS) {
    const [row] = await ownerDb().select({ id: t.users.id }).from(t.users).where(eq(t.users.email, u.email));
    users[u.role] = await resolveTenant({ userId: row.id, name: u.name, email: u.email }, u.org === "provider" ? "provider-p-demo" : DEMO_MERCHANT.slug);
  }
}, 600_000);
afterAll(async () => { noBuild(); await closeDatabase(); await closeOwner(); });

describe("the seeded demo world", () => {
  it("is deterministic: seeding it again gives the same content, table by table", async () => {
    const clock = installDemoClock();
    let twin = "";
    try { twin = (await seedDemo(ownerDb(), { password: PASSWORD, recording, setClock: clock.set, suffix: "-twin" })).orgs.merchant; } finally { clock.restore(); }
    const a = await contentFingerprint(orgId), b = await contentFingerprint(twin, "-twin");
    expect(Object.keys(a).length).toBeGreaterThan(20);
    expect(b).toEqual(a);
    expect(Number(a.match_records.split(":")[0])).toBeGreaterThan(1_400);
  }, 600_000);

  it("reads on the demo calendar once the seed's database-stamped times are moved (as `npm run demo` does)", async () => {
    // the twin seed above is a second demo organisation; only this seed's windows are applied
    expect(stampWindows.length).toBe(32); // set-up, 30 days, the morning of the demo day
    const r = await restampDemoSeed(superUrl(), testDbName(), stampWindows);
    expect(r.rows).toBeGreaterThan(1_000);
    for (const k of ["approval_requests.created_at", "approval_decisions.created_at", "notifications.created_at", "chain_transfers.observed_at", "merchant_policy.updated_at"]) expect(r.columns[k], k).toBeGreaterThan(0);
    const db = ownerDb();
    const cols = (await db.execute(sql`select table_name t, column_name c from information_schema.columns where table_schema = 'public' and data_type like 'timestamp%' and column_default ilike '%now()%' and exists (select 1 from information_schema.columns o where o.table_schema = 'public' and o.table_name = columns.table_name and o.column_name = 'org_id')`)).rows as { t: string; c: string }[];
    for (const { t: tb, c } of cols) {
      const n = Number((await db.execute(sql.raw(`select count(*) n from "${tb}" where org_id = '${orgId}' and ("${c}" < '2026-11-08T00:00:00Z' or "${c}" > '2026-12-08T02:00:00Z')`))).rows[0].n);
      expect(n, `${tb}.${c}`).toBe(0);
    }
    // Case 3's write-off is requested and approved on the demo day, after its two payments (1 and 3 Dec)
    const wo = (await db.execute(sql`select r.created_at::text req, d.created_at::text dec from approval_requests r join approval_decisions d on d.request_id = r.id where r.org_id = ${orgId} and r.subject_id like 'WO-BK-25102@%'`)).rows[0] as { req: string; dec: string };
    expect(wo.req.slice(0, 16)).toBe("2026-12-08 01:30");
    expect(wo.dec.slice(0, 16)).toBe("2026-12-08 01:30");
    // only a plain demo database name is accepted
    await expect(restampDemoSeed(superUrl(), "Bad-Name", stampWindows)).rejects.toThrow(/bad demo database name/);
  }, 120_000);

  it("holds the three documented cases with their exact numbers", async () => {
    const c1 = await batchBridge(users.finance, "B-1124-001");
    expect(c1.lines.find((l) => l.kind === "net")!.amountMinor).toBe("596124");
    expect(c1.tied).toBe(true);
    const c2 = await batchBridge(users.finance, "B-1125-SGD");
    expect(c2.lines.map((l) => [l.kind, l.amountMinor])).toEqual([
      ["merchant_day", "4441230"], ["timing_prior_batch", "-297000"], ["held_by_provider", "-120000"], ["timing_next_batch", "162000"],
      ["gross", "4186230"], ["provider_fee", "-41862"], ["refund_netted", "-121500"], ["net", "4022868"],
    ]);
    expect(c2.lines.find((l) => l.kind === "held_by_provider")!.orderIds).toEqual(["BK-24871"]);
    const [held] = await ownerDb().select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, orgId), eq(t.matchRecords.orderId, "BK-24871")));
    expect(held.ruleId).toBe("M3.batch.held_by_provider");
    const [c3] = await ownerDb().select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, orgId), eq(t.matchRecords.orderId, "BK-25102")));
    const diffs = (c3.explanation as { differences: { amountMinor: string }[] }).differences.reduce((s, d) => s + BigInt(d.amountMinor), 0n);
    expect(diffs === 1416n || diffs === -1416n).toBe(true);
  });

  it("has results, runs, journal proposals pending sign-off, approvals waiting and owned exceptions", async () => {
    const db = ownerDb();
    const count = async (q: ReturnType<typeof sql>) => Number((await db.execute(q)).rows[0].n);
    expect(await count(sql`select count(*) n from reconciliation_runs where org_id = ${orgId}`)).toBe(90);
    expect(await count(sql`select count(*) n from merchant_journal_proposals where org_id = ${orgId} and status = 'proposed' and posting_rule_status = 'pending_sign_off'`)).toBeGreaterThan(0);
    expect(await count(sql`select count(*) n from approval_requests where org_id = ${orgId} and status = 'pending'`)).toBe(14);
    expect(await count(sql`select count(*) n from recon_exceptions where org_id = ${orgId} and status = 'open' and (owner_user_id is null or reason = '' or next_step = '')`)).toBe(0);
    expect(await count(sql`select count(*) n from bank_lines where org_id = ${orgId} and source <> 'seed_fictional'`)).toBe(0);
    expect(await count(sql`select count(*) n from merchant_policy where org_id = ${orgId} and allow_imported_bank_lines_as_verified`)).toBe(0);
  });
});

describe("labels", () => {
  it("the demo tenant is 'Demo · fictional data' on every read model; a live tenant never is", async () => {
    for (const role of ["finance", "approver", "viewer", "admin", "provider_ops"]) expect((await merchantShell(users[role])).label).toBe(DEMO_DATA_LABEL);
    expect((await batchBridge(users.viewer, "B-1124-001")).label).toBe(DEMO_DATA_LABEL);
    const live = await createMerchant(ownerDb(), { slug: "live-check-demo-w", name: "Live check (fictional)", timezone: "Asia/Singapore" });
    const { addMember } = await import("../../src/server/merchant-setup");
    const m = await addMember(ownerDb(), { orgSlug: "live-check-demo-w", email: "admin@live-check.example", role: "admin", password: PASSWORD });
    const ctx = await resolveTenant({ userId: m.userId, name: "admin", email: "admin@live-check.example" }, "live-check-demo-w");
    const shell = await merchantShell(ctx);
    expect(shell.label).toBe(LIVE_DATA_LABEL);
    expect(shell.label).not.toBe(DEMO_DATA_LABEL);
    expect(live.status).toBe("created");
  });
});

describe("recorded chain data and the build", () => {
  it("a real build refuses the recording for the demo org; a demo build refuses it for a live org and honours it for the demo org", async () => {
    try {
      nextBuild({ demo: false });
      await expect(runReconciliation(users.finance, DEMO_ENTITY_IDS.SG, key())).rejects.toThrow(ChainRecordingRefused);
      nextBuild({ demo: true });
      await addEntity(ownerDb(), { orgSlug: "live-check-demo-w", entityId: "LIVE-SG", name: "Live SG (fictional)", currency: "SGD", timezone: "Asia/Singapore" });
      const { addMember } = await import("../../src/server/merchant-setup");
      const m = await addMember(ownerDb(), { orgSlug: "live-check-demo-w", email: "finance@live-check.example", role: "finance", password: PASSWORD });
      const live = await resolveTenant({ userId: m.userId, name: "finance", email: "finance@live-check.example" }, "live-check-demo-w");
      await expect(runReconciliation(live, "LIVE-SG", key())).rejects.toThrow(DemoRecordingRefused);
      const ok = await runReconciliation(users.finance, DEMO_ENTITY_IDS.SG_USD, key());
      expect(ok.body.label).toBe(DEMO_DATA_LABEL);
    } finally { noBuild(); }
  }, 120_000);
});

describe("the reset route in a demo build", () => {
  const ORIGIN = process.env.CLEARLINE_ORIGIN!;
  let ip = 70;
  const signIn = async (email: string) => {
    const { POST: authPOST } = await import("../../src/app/api/auth/[...all]/route");
    const res = await authPOST(new Request(`${ORIGIN}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `198.51.100.${ip++}` }, body: JSON.stringify({ email, password: PASSWORD }) }));
    expect(res.status).toBe(200);
    return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  };
  const post = async (cookie: string) => {
    const { POST } = await import("../../src/app/api/control/demo/reset/route");
    return POST(new Request(`${ORIGIN}/api/control/demo/reset`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie }, body: "{}" }));
  };
  it("answers 404 to a member of a live organisation and lets a demo member through to the reset itself", async () => {
    const saved = { url: process.env.CLEARLINE_DEMO_RESET_URL, db: process.env.CLEARLINE_DEMO_DB };
    delete process.env.CLEARLINE_DEMO_RESET_URL; delete process.env.CLEARLINE_DEMO_DB; // so a demo member stops at "not configured", nothing is dropped
    try {
      nextBuild({ demo: true });
      const live = await post(await signIn("admin@live-check.example"));
      expect(live.status).toBe(404);
      const demo = await post(await signIn("viewer@northwind.demo"));
      expect(demo.status).toBe(409);
      expect((await demo.json()).error.code).toBe("DEMO_RESET_REFUSED");
      nextBuild({ demo: false });
      expect((await post(await signIn("viewer@northwind.demo"))).status).toBe(404);
    } finally {
      noBuild();
      if (saved.url) process.env.CLEARLINE_DEMO_RESET_URL = saved.url;
      if (saved.db) process.env.CLEARLINE_DEMO_DB = saved.db;
    }
  });
});

// ---------------------------------------------------------------- demo-files through the upload pipeline

const STATUS = { COMPLETE: "paid", SHORT: "underpaid", REPRICED: "re_quoted" };
const D = { dateFormat: "d_mon_y", defaultUtcOffsetMinutes: 480 } as const;
const DEMO_FILE_MAPPINGS: Record<"provider" | "orders", Mapping> = {
  orders: { fileType: "orders_invoices", columns: {
    order_id: { header: "Booking" }, entity: { header: "Book" }, invoice_amount: { header: "Amount due" }, currency: { header: "Currency" },
    status: { header: "State", statusValueMap: { open: "open" } }, issued_at: { header: "Booked (SGT)", ...D },
  } },
  provider: { fileType: "provider_export", columns: {
    payment_id: { header: "Txn No." }, order_id: { header: "Booking Ref" }, quote_id: { header: "Checkout Ref" }, invoice_amount: { header: "Order total (SGD)" }, currency: { constant: "SGD" },
    network: { header: "Chain" }, token_symbol: { header: "Coin" }, token_contract: { header: "Coin contract" }, deposit_address: { header: "Pay-to wallet" }, sender: { header: "Payer wallet" },
    quoted_token_amount: { header: "Coins expected" }, received_token_amount: { header: "Coins received" }, quote_rate: { header: "Offer price" }, rate_source: { constant: "Provider P (demo) offer price" },
    executed_rate: { header: "Fill price" }, credited_fiat: { header: "Net to merchant" }, fee: { header: "Charge" }, status: { header: "Result", statusValueMap: STATUS },
    tx_hash: { header: "On-chain ref" }, log_index: { header: "Log #" }, created_at: { header: "Offer opened (SGT)", ...D }, expires_at: { header: "Offer ends (SGT)", ...D },
    paid_at: { header: "Paid (SGT)", ...D }, batch_id: { header: "Payout ref" },
  } },
};

describe("demo-files", () => {
  it("are what make-demo-files writes (committed, deterministic)", async () => {
    for (const f of await demoFiles()) expect(createHash("sha256").update(f.bytes).digest("hex"), f.name).toBe(createHash("sha256").update(readFileSync(path.join(DEMO_DIR, f.name))).digest("hex"));
  });

  it("go through the real upload pipeline in the demo tenant and give the recorded outcomes", async () => {
    const db = ownerDb();
    const decisions = async () => Object.fromEntries((await db.execute(sql`select m.decision, count(*)::int n from match_records m join invoices i on i.org_id = m.org_id and i.order_id = m.order_id where m.org_id = ${orgId} and i.entity_id = ${DEMO_ENTITY_IDS.SG} group by 1 order by 1`)).rows.map((r) => [r.decision, r.n]));
    const before = await decisions();
    const files = Object.fromEntries((await demoFiles()).map((f) => [f.name, f.bytes]));
    const uploads: Record<string, unknown> = {};
    const push = async (name: string, fileType: Mapping["fileType"], mapping?: Mapping) => {
      const up = await createUpload(users.finance, { entityId: DEMO_ENTITY_IDS.SG, fileType, fileName: name, bytes: files[name], ...(await accountFields(users.finance, DEMO_ENTITY_IDS.SG, fileType)) }, key());
      expect(up.label).toBe(DEMO_DATA_LABEL);
      if (mapping) await setUploadMapping(users.finance, up.upload.id, { mapping }, key());
      const v = (await validateUpload(users.finance, up.upload.id, key())).body;
      // a bank statement needs a second person: Finance uploaded it, so Finance may not confirm it
      if (fileType === "bank_statement") await expect(decideUpload(users.finance, up.upload.id, { decision: "confirm", reason: "self", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key())).rejects.toThrow();
      const confirmer = fileType === "bank_statement" ? users.approver : users.finance;
      await decideUpload(confirmer, up.upload.id, { decision: "confirm", reason: "Checked against the source (demo)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
      const norm = (await normaliseUpload(confirmer, up.upload.id, key())).body;
      uploads[name] = { rows: v.counts, normalised: norm.counts };
    };
    await push(FILES.orders, "orders_invoices", DEMO_FILE_MAPPINGS.orders);
    await push(FILES.provider, "provider_export", DEMO_FILE_MAPPINGS.provider);
    await push(FILES.bank, "bank_statement");
    const bankSources = (await db.execute(sql`select source, count(*)::int n from bank_lines where org_id = ${orgId} and value_date = '2026-12-08' group by 1`)).rows;
    let run;
    try { nextBuild({ demo: true }); run = await runReconciliation(users.finance, DEMO_ENTITY_IDS.SG, key()); } finally { noBuild(); }
    const after = await decisions();
    const rulesAfter = Object.fromEntries((await db.execute(sql`select m.decision || ' ' || m.rule_id k, count(*)::int n from match_records m join invoices i on i.org_id = m.org_id and i.order_id = m.order_id where m.org_id = ${orgId} and i.entity_id = ${DEMO_ENTITY_IDS.SG} group by 1 order by 1`)).rows.map((r) => [r.k, r.n]));
    const newOrders = Object.fromEntries((await db.execute(sql`select order_id, decision, rule_id from match_records where org_id = ${orgId} and order_id like 'BK-390%' order by 1`)).rows.map((r) => [r.order_id, `${r.decision} ${r.rule_id}`]));
    const batches: Record<string, unknown> = {};
    for (const b of ["B-SGD-20261205", "B-SGD-20261207"]) { const x = await batchBridge(users.finance, b); batches[b] = { tied: x.tied, settlementVerified: x.settlementVerified, bankLineSource: x.bankLineSource, bankLineLabel: x.bankLineLabel }; }
    const actual = { label: DEMO_DATA_LABEL, entityId: DEMO_ENTITY_IDS.SG, mappings: DEMO_FILE_MAPPINGS, uploads, bankLinesOnDemoDay: bankSources, run: { status: run.body.status, records: run.body.records, exceptions: run.body.exceptions, runCounts: run.body.runCounts }, decisionsBefore: before, decisionsAfter: after, rulesAfter, newOrders, batches };
    const json = JSON.parse(JSON.stringify(actual, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    if (process.env.CLEARLINE_DEMO_FILES_RECORD === "1") writeFileSync(EXPECTED, `${JSON.stringify(json, null, 2)}\n`);
    expect(json).toEqual(JSON.parse(readFileSync(EXPECTED, "utf8")));
    // the accounting rule holds: imported statement lines tie a batch but never verify its settlement (flag off)
    for (const b of Object.values(batches) as { tied: boolean; settlementVerified: boolean; bankLineSource: string }[]) {
      if (b.bankLineSource === "csv_import") expect(b.settlementVerified).toBe(false);
    }
  }, 300_000);
});

// ---------------------------------------------------------------- reset

describe("demo reset", () => {
  it("restores the seeded database exactly, in under 30 s, and a live pool recovers", async () => {
    const db = testDbName(), copy = `${db}_dr`.slice(0, 41);
    const su = new Client({ connectionString: superUrl() });
    try { await su.connect(); } catch (e) { throw new Error(`BLOCKED: the demo reset test needs a superuser of the test server (CLEARLINE_TEST_SUPER_URL): ${(e as Error).message}`); }
    try {
      await closeDatabase(); await closeOwner();
      // v1: the pools' end() resolves before their backends have finished closing. Terminating a backend while its
      // client is still closing makes PostgreSQL send that client a FATAL 57P01 it no longer listens for, which
      // vitest reports as an unhandled error and fails the whole run (CI control-db at 727d4cf; 1 of 2 local runs).
      // Wait (up to 10 s) for this process's own pools to be gone; only then end whatever else is left.
      for (let i = 0; i < 100; i++) {
        const { rows: left } = await su.query("select count(*)::int as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and usename in ('clearline_owner', 'clearline_runtime')", [db]);
        if (left[0].n === 0) break;
        await new Promise((res) => setTimeout(res, 100));
      }
      await su.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [db]);
      await su.query(`drop database if exists "${copy}" with (force)`); await su.query(`drop database if exists "${copy}_template" with (force)`);
      await su.query(`create database "${copy}" template "${db}" owner clearline_owner`);
      await snapshotDemoTemplate({ adminUrl: superUrl(), database: copy });
      const seeded = await exactFingerprint(superUrl(copy));
      // the app works on the copy (runtime login), keeps an idle connection, and changes things
      const runtime = new URL(process.env.CLEARLINE_TEST_RUNTIME_URL!); runtime.pathname = `/${copy}`;
      process.env.DATABASE_URL = runtime.toString();
      await database().execute(sql`select 1`);
      const c = new Client({ connectionString: superUrl(copy) }); await c.connect();
      const { rows } = await c.query("select id from writeoff_proposals where org_id = $1 and status = 'proposed' order by id limit 1", [orgId]); await c.end();
      await proposeWriteoff(users.finance, rows[0].id, key());
      const edited = new TextEncoder().encode(`${new TextDecoder().decode((await demoFiles())[0].bytes)}\r\n`); // a different file than the one already uploaded
      await createUpload(users.finance, { entityId: DEMO_ENTITY_IDS.SG, fileType: "provider_export", fileName: "edited.csv", bytes: edited }, key());
      const changed = await exactFingerprint(superUrl(copy));
      expect(changed).not.toEqual(seeded);
      const t0 = performance.now();
      const r = await resetDemoDatabase({ adminUrl: superUrl(), database: copy });
      const ms = Math.round(performance.now() - t0);
      expect(ms).toBeLessThan(30_000);
      expect(r.ms).toBeLessThan(30_000);
      expect(await exactFingerprint(superUrl(copy))).toEqual(seeded);
      // the pool's idle connection was ended by the reset; the next query opens a new one
      expect((await batchBridge(users.finance, "B-1125-SGD")).lines.find((l) => l.kind === "net")!.amountMinor).toBe("4022868");
      process.stdout.write(`demo reset (test copy): ${ms} ms\n`);
    } finally {
      await closeDatabase();
      process.env.DATABASE_URL = process.env.CLEARLINE_TEST_RUNTIME_URL;
      await su.query(`drop database if exists "${copy}" with (force)`).catch(() => undefined);
      await su.query(`drop database if exists "${copy}_template" with (force)`).catch(() => undefined);
      await su.end();
    }
  }, 300_000);
});
