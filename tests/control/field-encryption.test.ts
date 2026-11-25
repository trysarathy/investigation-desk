/**
 * v1 Phase 5.3, against a real PostgreSQL 16: application-level encryption of wallet addresses and customer references.
 *   - the same synthetic organisation reconciled with field encryption OFF and ON gives the same decisions, the same
 *     match records and the same reconciliation inputs (input hashes), through the whole upload pipeline and chain
 *     verification (scripts/bench/e2e-core.ts at a small size);
 *   - ledger invoices' order references and contacts are sealed and read back exactly;
 *   - the expand step's backfill seals rows written before encryption was on, and the inputs stay identical;
 *   - a full rotation without downtime: data keys rotated while reads continue, new values sealed with the new key, the
 *     lazy re-encrypt job moves the old ones, the retired key is purged; then the master key is rotated (re-wrap) and
 *     the old master key removed; every reconciliation input is unchanged throughout;
 *   - the database rules: org_data_keys row-level security; sealed values are re-sealed only by key maintenance; blind
 *     indexes never change; chain_reads and ledger_invoices stay append-only for the app;
 *   - no log line, error message or maintenance output ever carries an address or a reference in the clear;
 *   - an inventory of every column that still holds these values in the clear (the contract step's checklist).
 * Synthetic and fictional data only; test-only keys made in this file.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { runBench, type BenchResult } from "../../scripts/bench/e2e-core";
import { LocalKms, KmsError, setKmsForTests } from "../../src/server/crypto/kms";
import { FieldCryptoError } from "../../src/server/crypto/envelope";
import { clearKeyCache } from "../../src/server/crypto/org-keys";
import { keyStatus, purgeRetiredKeys, rewrapAll, rotateDataKeys, sealAll, verifyAll } from "../../src/server/crypto/maintenance";
import { loadReconcileInput, plainForDisplay, writeIngested } from "../../src/server/merchant-store";
import { inputSha256 } from "../../src/server/merchant";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { listLedgerInvoices } from "../../src/server/ledger";
import { withTenant } from "../../src/server/tenant";
import type { Mapping } from "../../src/lib/clearline/mapping";

const key1 = randomBytes(32);
const k1 = new LocalKms([["test-k1", key1]]);
const key2 = randomBytes(32);
const captured: string[] = [];
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as T[];
let plain: BenchResult, enc: BenchResult;
let n = 0;
const ikey = () => `fe-key-${++n}-${Date.now()}`;

/**
 * Every entity's reconciliation input hash, read as the app reads it (owner transaction; RLS is not the point here).
 * `acrossOrgs`: a statement line's id is its row's fingerprint, which includes the organisation's (random) bank
 * account id (and its provenance names the upload), so two organisations holding the same file differ there and only
 * there (bank lines are also ordered by that id); it is masked for comparisons between organisations. Within one organisation the hash is compared exactly.
 */
async function inputHashes(orgId: string, acrossOrgs = false): Promise<Record<string, string>> {
  const ents = await rows<{ id: string }>(sql`select id from merchant_entities where org_id = ${orgId} order by id`);
  const out: Record<string, string> = {};
  for (const e of ents) {
    const input = await ownerDb().transaction((tx) => loadReconcileInput(tx, orgId, e.id));
    const masked = () => input.bankLines.map((b) => ({ ...b, bankLineId: "FILE-<fingerprint>", provenance: b.provenance.replace(/upload [0-9a-f-]{36}/, "upload <id>") }))
      .sort((x, y) => (JSON.stringify(plainForDisplay(x)) < JSON.stringify(plainForDisplay(y)) ? -1 : 1)); // ordered by the (random) line id
    out[e.id] = inputSha256(acrossOrgs ? { ...input, bankLines: masked() } : input);
  }
  return out;
}
const FILE_ID = /FILE-[0-9a-f]{32}/g;
const matchContent = async (orgId: string) => (await rows(sql`select order_id, decision, rule_id, deciding_step, chain::text c, provider::text p, bank::text b, ledger::text l,
  (explanation - 'label')::text e, bank_evidence, settled from match_records where org_id = ${orgId} order by order_id`)).map((r) => JSON.parse(JSON.stringify(r).replace(FILE_ID, "FILE-<fingerprint>")));
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
let plainAtRun: Record<string, string> = {};

beforeAll(async () => {
  useTestStorage();
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    const orig = console[m].bind(console);
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { captured.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(" ")); void orig; });
  }
  for (const s of [process.stdout, process.stderr]) {
    const orig = s.write.bind(s);
    vi.spyOn(s, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => { captured.push(String(chunk)); return (orig as (...x: unknown[]) => boolean)(chunk, ...rest); }) as typeof s.write);
  }
  await resetAndSeed();
}, 600_000);
afterAll(async () => { setKmsForTests(undefined); clearKeyCache(); vi.restoreAllMocks(); await closeDatabase(); await closeOwner(); });

describe("matching is unchanged by field encryption", () => {
  it("the same synthetic organisation, OFF then ON: same decisions, match records and inputs", async () => {
    setKmsForTests(null);
    plain = await runBench(ownerDb(), { months: 2, paymentsPerMonth: 60, seed: 5353, tag: "fe-plain" });
    plainAtRun = await inputHashes(plain.orgId);
    const lastRun = await rows<{ entity_id: string; input_sha256: string }>(sql`select distinct on (entity_id) entity_id, input_sha256 from reconciliation_runs where org_id = ${plain.orgId} order by entity_id, started_at desc`);
    expect(Object.fromEntries(lastRun.map((r) => [r.entity_id, r.input_sha256]))).toEqual(plainAtRun);
    setKmsForTests(k1);
    enc = await runBench(ownerDb(), { months: 2, paymentsPerMonth: 60, seed: 5353, tag: "fe-enc" });
    expect(plain.decisions.records).toBeGreaterThan(100);
    expect(enc.decisions).toEqual(plain.decisions);
    expect(await matchContent(enc.orgId)).toEqual(await matchContent(plain.orgId));
    const runs = (o: string) => rows(sql`select entity_id, status, matched, with_difference, review, exceptions from reconciliation_runs where org_id = ${o} order by started_at, entity_id`);
    expect(await runs(enc.orgId)).toEqual(await runs(plain.orgId));
    expect(await inputHashes(enc.orgId, true)).toEqual(await inputHashes(plain.orgId, true));
    // differences and exceptions too
    const diffs = (o: string) => rows(sql`select order_id, type, amount_minor::text, rule_id from differences where org_id = ${o} order by 1, 2, 3, 4`);
    expect(await diffs(enc.orgId)).toEqual(await diffs(plain.orgId));
    const exs = (o: string) => rows(sql`select id, order_id, owner_role, reason, status from recon_exceptions where org_id = ${o} order by 1`);
    expect(await exs(enc.orgId)).toEqual(await exs(plain.orgId));
  }, 600_000);

  it("ON: every address is sealed with its blind index; OFF: nothing sealed and no keys", async () => {
    const [st] = await keyStatus(ownerDb(), { orgIds: [enc.orgId] });
    expect(st.unsealed).toBe(0);
    expect(st.dataVersions).toEqual([{ version: 1, status: "active", kekId: "test-k1" }]);
    expect(st.sealedByVersion["1"]).toBeGreaterThan(300);
    expect(await keyStatus(ownerDb(), { orgIds: [plain.orgId] })).toEqual([{ orgId: plain.orgId, dataVersions: [], sealedByVersion: {}, unsealed: expect.any(Number) }]);
    const counts = await rows<{ q: number; l: number; t: number; r: number; leak: number }>(sql`select
      (select count(*)::int from merchant_quotes where org_id = ${enc.orgId} and deposit_address_enc is not null and deposit_address_bidx is not null) q,
      (select count(*)::int from payment_links where org_id = ${enc.orgId} and deposit_address_enc is not null) l,
      (select count(*)::int from chain_transfers where org_id = ${enc.orgId} and to_address_enc is not null and from_address_enc is not null) t,
      (select count(*)::int from chain_reads where org_id = ${enc.orgId} and address is not null and address_enc is not null) r,
      (select count(*)::int from chain_transfers where org_id = ${enc.orgId} and (position(to_address in to_address_enc) > 0 or to_address_bidx = to_address)) leak`);
    expect(counts[0].q).toBeGreaterThan(50);
    expect(counts[0].t).toBeGreaterThan(50);
    expect(counts[0].r).toBeGreaterThan(0);
    expect(counts[0].leak).toBe(0);
    // equality on the blind index finds exactly what equality on the plaintext finds (a join from transfers to quotes)
    const byPlain = await rows(sql`select t.tx_hash, q.quote_id from chain_transfers t join merchant_quotes q on q.org_id = t.org_id and q.network = t.network and q.deposit_address = t.to_address where t.org_id = ${enc.orgId} order by 1, 2`);
    const byIndex = await rows(sql`select t.tx_hash, q.quote_id from chain_transfers t join merchant_quotes q on q.org_id = t.org_id and q.network = t.network and q.deposit_address_bidx = t.to_address_bidx where t.org_id = ${enc.orgId} order by 1, 2`);
    expect(byPlain.length).toBeGreaterThan(50);
    expect(byIndex).toEqual(byPlain);
    expect(await verifyAll(ownerDb(), { orgIds: [enc.orgId], kms: k1 })).toMatchObject({ problems: [], unsealed: 0 });
  });
});

describe("ledger references", () => {
  let s: LiveSeed;
  const MAPPING: Mapping = {
    fileType: "ledger_invoices",
    columns: { invoice_number: { header: "Invoice No" }, order_id: { header: "Reference" }, contact: { header: "Customer" }, total: { header: "Total", decimalSeparator: "." }, currency: { header: "Ccy" }, status: { header: "Status", statusValueMap: { Paid: "paid", Authorised: "open" } } },
  };
  it("an order reference and a contact are sealed (the reference with a blind index) and listed back exactly", async () => {
    setKmsForTests(k1);
    s = await seedLiveMerchants(ownerDb(), "-fe");
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const csv = "Invoice No,Reference,Customer,Total,Ccy,Status\r\nINV-FE-1,FE-ORDER-77101,Fictional Buyer FE77 Pte,10.00,SGD,Paid\r\nINV-FE-2,,Fictional Buyer FE78 Pte,5.00,SGD,Authorised\r\n";
    const up = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "ledger-fe.csv", bytes: new TextEncoder().encode(csv) }, ikey());
    await setUploadMapping(fin, up.upload.id, { mapping: MAPPING }, ikey());
    const v = (await validateUpload(fin, up.upload.id, ikey())).body;
    await decideUpload(fin, up.upload.id, { decision: "confirm", reason: "Checked (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, ikey());
    expect((await normaliseUpload(fin, up.upload.id, ikey())).body.counts.created).toBe(2);
    const stored = await rows<{ invoice_number: string; order_ref_enc: string | null; order_ref_bidx: string | null; contact_enc: string | null }>(sql`select invoice_number, order_ref_enc, order_ref_bidx, contact_enc from ledger_invoices where org_id = ${s.orgs.a} order by 1`);
    expect(stored.map((r) => [r.invoice_number, !!r.order_ref_enc, !!r.order_ref_bidx, !!r.contact_enc])).toEqual([["INV-FE-1", true, true, true], ["INV-FE-2", false, false, true]]);
    expect(stored[0].order_ref_enc).not.toContain("FE-ORDER-77101");
    const listed = await listLedgerInvoices(fin, "ENT-LIVE-SG");
    expect(listed.invoices.map((i) => [i.invoiceNumber, i.orderRef])).toEqual([["INV-FE-1", "FE-ORDER-77101"], ["INV-FE-2", null]]);
  });

  it("the app cannot change a ledger invoice, and key maintenance can only re-seal it", async () => {
    const runtime = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL, max: 1 });
    try {
      await expect(runtime.query("update ledger_invoices set order_ref_enc = order_ref_enc")).rejects.toThrow(/permission denied/);
    } finally { await runtime.end(); }
    await dbRefuses(ownerDb().execute(sql`update ledger_invoices set status = 'void' where org_id = ${s.orgs.a}`), /append-only/);
    await dbRefuses(ownerDb().execute(sql`update ledger_invoices set order_ref_bidx = ${"0".repeat(64)} where org_id = ${s.orgs.a} and order_ref_bidx is not null`), /blind index never changes/);
    await dbRefuses(ownerDb().execute(sql`update ledger_invoices set contact_enc = null where org_id = ${s.orgs.a}`), /never removed/);
  });
});

describe("backfill (expand step)", () => {
  it("seals every value written before encryption was on; the inputs stay identical", async () => {
    setKmsForTests(null);
    const before = await inputHashes(plain.orgId);
    expect(before).toEqual(plainAtRun);
    setKmsForTests(k1);
    const r = await sealAll(ownerDb(), { orgIds: [plain.orgId], batchSize: 97 });
    expect(r.sealed).toBeGreaterThan(300);
    expect(r.resealed).toBe(0);
    expect((await keyStatus(ownerDb(), { orgIds: [plain.orgId] }))[0].unsealed).toBe(0);
    expect(await verifyAll(ownerDb(), { orgIds: [plain.orgId] })).toMatchObject({ problems: [], unsealed: 0 });
    expect(await inputHashes(plain.orgId)).toEqual(before);
    // idempotent
    expect(await sealAll(ownerDb(), { orgIds: [plain.orgId] })).toMatchObject({ sealed: 0, resealed: 0 });
    // the two organisations now hold the same values, each under its own keys
    expect(await inputHashes(plain.orgId, true)).toEqual(await inputHashes(enc.orgId, true));
  }, 300_000);
});

describe("key rotation without downtime", () => {
  it("data keys: rotate while reading, seal new values with the new key, re-encrypt lazily, purge the retired key", async () => {
    setKmsForTests(k1);
    const orgIds = [enc.orgId, plain.orgId];
    expect(await rotateDataKeys(ownerDb(), { orgIds })).toEqual({ rotated: 2 });
    // a value written after the rotation is sealed with version 2; older values still open with version 1
    const ent = (await rows<{ id: string }>(sql`select id from merchant_entities where org_id = ${enc.orgId} order by id limit 1`))[0].id;
    await ownerDb().transaction((tx) => writeIngested(tx, enc.orgId, ent, { addressFacts: [{ network: "ethereum", address: "0xF1C7A0000000000000000000000000000000FE01", fact: "intermediate_wallet" }] }, { chainSource: "chain_client" }));
    const v2 = await rows<{ v: string }>(sql`select split_part(address_enc, '.', 2) v from address_facts where org_id = ${enc.orgId} and address = '0xF1C7A0000000000000000000000000000000FE01'`);
    expect(v2.map((x) => x.v)).toEqual(["2"]);
    const st = await keyStatus(ownerDb(), { orgIds: [enc.orgId] });
    expect(st[0].dataVersions.map((d) => [d.version, d.status])).toEqual([[1, "retired"], [2, "active"]]);
    expect(st[0].sealedByVersion["1"]).toBeGreaterThan(300);
    const hashes = { enc: await inputHashes(enc.orgId), plain: await inputHashes(plain.orgId) };
    // the lazy re-encrypt job runs while the app keeps reading
    let reads = 0;
    let done = false;
    const reader = (async () => { while (!done) { expect(await inputHashes(enc.orgId)).toEqual(hashes.enc); reads++; } })();
    const r = await sealAll(ownerDb(), { orgIds, batchSize: 50 }).finally(() => { done = true; });
    await reader;
    expect(reads).toBeGreaterThan(0);
    expect(r.resealed).toBeGreaterThan(600);
    for (const s of await keyStatus(ownerDb(), { orgIds })) expect(Object.keys(s.sealedByVersion)).toEqual(["2"]);
    expect(await purgeRetiredKeys(ownerDb(), { orgIds })).toEqual({ purged: 2 });
    clearKeyCache();
    expect(await inputHashes(enc.orgId)).toEqual(hashes.enc);
    expect(await inputHashes(plain.orgId)).toEqual(hashes.plain);
    expect(await verifyAll(ownerDb(), { orgIds })).toMatchObject({ problems: [], unsealed: 0 });
  }, 300_000);

  it("master key: re-wrap under the new key while both are configured, then remove the old one", async () => {
    const orgIds = [enc.orgId, plain.orgId];
    const hashes = { enc: await inputHashes(enc.orgId), plain: await inputHashes(plain.orgId) };
    const both = new LocalKms([["test-k2", key2], ["test-k1", key1]]);
    setKmsForTests(both);
    clearKeyCache();
    expect(await inputHashes(enc.orgId)).toEqual(hashes.enc); // the new key is active, the old one still unwraps
    const r = await rewrapAll(ownerDb());
    expect(r.rewrapped).toBeGreaterThanOrEqual(4);
    expect(r.remainingOther).toBe(0);
    const kek = await rows<{ kek_id: string; n: number }>(sql`select kek_id, count(*)::int n from org_data_keys group by 1`);
    expect(kek).toEqual([{ kek_id: "test-k2", n: expect.any(Number) }]);
    setKmsForTests(new LocalKms([["test-k2", key2]]));
    clearKeyCache();
    expect(await inputHashes(enc.orgId)).toEqual(hashes.enc);
    expect(await inputHashes(plain.orgId)).toEqual(hashes.plain);
    expect(await verifyAll(ownerDb(), { orgIds })).toMatchObject({ problems: [], unsealed: 0 });
    // the old master key alone no longer opens anything
    setKmsForTests(k1);
    clearKeyCache();
    await expect(inputHashes(enc.orgId)).rejects.toThrow(KmsError);
    setKmsForTests(new LocalKms([["test-k2", key2]]));
    clearKeyCache();
  }, 300_000);
});

describe("database rules", () => {
  it("org_data_keys: a member reads its own organisation's keys only; the app creates first keys only and never changes one", async () => {
    const lumen = (await rows<{ id: string }>(sql`select id from organizations where slug = 'lumen-demo'`))[0].id;
    const ops = (await rows<{ id: string }>(sql`select id from users where email = 'ops@lumen.example'`))[0].id;
    const seen = await withTenant({ userId: ops, orgId: lumen }, (tx) => tx.select().from(t.orgDataKeys), { read: true });
    expect(seen.every((k) => k.orgId === lumen)).toBe(true);
    const as = (q: ReturnType<typeof sql>) => withTenant({ userId: ops, orgId: lumen }, (tx) => tx.execute(q));
    await dbRefuses(as(sql`insert into org_data_keys (org_id, purpose, version, kek_id, wrapped_key, status) values (${lumen}, 'data', 2, 'x', 'lk1.xxxxxxxx', 'active')`), /row-level security/);
    await dbRefuses(as(sql`insert into org_data_keys (org_id, purpose, version, kek_id, wrapped_key, status) values (${enc.orgId}, 'data', 1, 'x', 'lk1.xxxxxxxx', 'active')`), /row-level security/);
    await dbRefuses(as(sql`update org_data_keys set status = 'retired' where org_id = ${lumen}`), /permission denied/);
    await dbRefuses(as(sql`delete from org_data_keys where org_id = ${lumen}`), /permission denied/);
    await dbRefuses(ownerDb().execute(sql`update org_data_keys set version = 9 where org_id = ${enc.orgId} and purpose = 'data'`), /identity never changes/);
    await dbRefuses(ownerDb().execute(sql`update org_data_keys set wrapped_key = wrapped_key || 'x' where org_id = ${enc.orgId}`), /re-wrapped/);
  });

  it("only key maintenance re-seals a value; nobody changes a blind index; chain reads stay append-only for the app", async () => {
    const u = (await rows<{ user_id: string }>(sql`select m.user_id from organization_memberships m where m.org_id = ${enc.orgId} and m.role = 'payment_ops'`))[0].user_id;
    const as = (q: ReturnType<typeof sql>) => withTenant({ userId: u, orgId: enc.orgId }, (tx) => tx.execute(q));
    await dbRefuses(as(sql`update chain_transfers set to_address_enc = from_address_enc where org_id = ${enc.orgId} and source = 'chain_client'`), /only key maintenance/);
    await dbRefuses(as(sql`update merchant_quotes set deposit_address_bidx = ${"a".repeat(64)} where org_id = ${enc.orgId}`), /blind index never changes/);
    await expect(as(sql`update chain_transfers set confirmations = confirmations where org_id = ${enc.orgId} and source = 'chain_client'`)).resolves.toBeDefined(); // finality updates still work
    await dbRefuses(ownerDb().execute(sql`update chain_transfers set to_address_bidx = from_address_bidx where org_id = ${enc.orgId} and to_address_bidx <> from_address_bidx`), /blind index never changes/);
    await dbRefuses(ownerDb().execute(sql`update chain_reads set status = 'ok' where org_id = ${enc.orgId}`), /append-only/);
    await dbRefuses(ownerDb().execute(sql`delete from chain_reads where org_id = ${enc.orgId}`), /append-only/);
    const runtime = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL, max: 1 });
    try { await expect(runtime.query("update chain_reads set address_enc = address_enc")).rejects.toThrow(/permission denied/); } finally { await runtime.end(); }
    await dbRefuses(ownerDb().execute(sql`update chain_transfers set to_address_enc = 'not sealed' where org_id = ${enc.orgId}`), /sealed_chk/);
  });
});

describe("no plaintext in logs or errors", () => {
  it("a moved or altered sealed value, or a changed plaintext copy, is refused without printing either", async () => {
    const [a, b] = await rows<{ tx_hash: string; log_index: number; source: string; to_address_enc: string }>(sql`select tx_hash, log_index, source, to_address_enc from chain_transfers where org_id = ${enc.orgId} and source = 'chain_client' and to_address <> from_address order by tx_hash limit 2`);
    const ent = (await rows<{ entity_id: string }>(sql`select entity_id from chain_transfers where org_id = ${enc.orgId} and tx_hash = ${a.tx_hash}`))[0].entity_id;
    const errs: string[] = [];
    await ownerDb().execute(sql`update chain_transfers set to_address_enc = ${b.to_address_enc} where org_id = ${enc.orgId} and tx_hash = ${a.tx_hash} and log_index = ${a.log_index} and source = ${a.source}`);
    try {
      await ownerDb().transaction((tx) => loadReconcileInput(tx, enc.orgId, ent)).then(() => { throw new Error("expected a refusal"); }, (e: Error) => { expect(e).toBeInstanceOf(FieldCryptoError); errs.push(`${e.message}\n${e.stack}`); });
    } finally {
      await ownerDb().execute(sql`update chain_transfers set to_address_enc = ${a.to_address_enc} where org_id = ${enc.orgId} and tx_hash = ${a.tx_hash} and log_index = ${a.log_index} and source = ${a.source}`);
    }
    const q = (await rows<{ quote_id: string; deposit_address: string }>(sql`select q.quote_id, q.deposit_address from merchant_quotes q join invoices i on i.org_id = q.org_id and i.order_id = q.order_id where q.org_id = ${enc.orgId} and i.entity_id = ${ent} limit 1`))[0];
    await ownerDb().execute(sql`update merchant_quotes set deposit_address = 'TFictAltered000000000000000000000Z' where org_id = ${enc.orgId} and quote_id = ${q.quote_id}`);
    try {
      await ownerDb().transaction((tx) => loadReconcileInput(tx, enc.orgId, ent)).then(() => { throw new Error("expected a refusal"); }, (e: Error) => { expect(e.message).toMatch(/does not agree/); errs.push(`${e.message}\n${e.stack}`); });
    } finally {
      await ownerDb().execute(sql`update merchant_quotes set deposit_address = ${q.deposit_address} where org_id = ${enc.orgId} and quote_id = ${q.quote_id}`);
    }
    expect(errs).toHaveLength(2);
    const values = await everyValue();
    for (const e of errs) for (const v of values) expect(e.includes(v), "an error carries a value").toBe(false);
    expect(errs.join("\n")).not.toContain("TFictAltered");
  });

  it("nothing printed during this file (pipeline, reconciliation, backfill, rotation, refusals) carries an address or a reference", async () => {
    const values = await everyValue();
    expect(values.length).toBeGreaterThan(100);
    const text = captured.join("\n");
    const found = values.filter((v) => text.includes(v));
    expect(found).toEqual([]);
  });
});

/** Every distinct address and reference this file wrote (fictional), at least 12 characters (no accidental matches). */
async function everyValue(): Promise<string[]> {
  const r = await rows<{ v: string }>(sql`select distinct v from (
    select to_address v from chain_transfers union select from_address from chain_transfers union select deposit_address from merchant_quotes
    union select deposit_address from payment_links union select address from address_facts union select address from chain_reads where address is not null
    union select order_ref from ledger_invoices where order_ref is not null union select contact from ledger_invoices where contact is not null) x where length(v) >= 12`);
  return r.map((x) => x.v);
}

describe("plaintext inventory (the contract step's checklist)", () => {
  it("names every column that still holds an address or a reference in the clear", async () => {
    const values = (await everyValue()).filter((v) => !v.startsWith("Fictional Buyer")).slice(0, 400);
    const cols = await rows<{ t: string; c: string }>(sql`select c.table_name t, c.column_name c from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
      where c.table_schema = 'public' and x.table_type = 'BASE TABLE' and c.data_type in ('text', 'jsonb', 'json', 'character varying', 'ARRAY')
      and not exists (select 1 from pg_inherits i join pg_class k on k.oid = i.inhrelid where k.relname = c.table_name) order by 1, 2`);
    const holding: string[] = [];
    for (const { t: tb, c } of cols) {
      const hit = await rows(sql`select 1 from ${sql.identifier(tb)} x where exists (select 1 from jsonb_array_elements_text(${JSON.stringify(values)}::jsonb) v where position(v in x.${sql.identifier(c)}::text) > 0) limit 1`);
      if (hit.length) holding.push(`${tb}.${c}`);
    }
    // expand step: the plaintext columns kept beside their sealed copies (dropped by the contract step), and the copies
    // derived from them that this phase does not seal yet (docs/security/ENCRYPTION_V1.md, "Not sealed yet")
    expect(holding).toEqual(PLAINTEXT_EXPECTED);
  });
});
const PLAINTEXT_EXPECTED = [
  // expand step: plaintext columns kept beside their sealed copies until the contract step drops them
  "address_facts.address", "chain_reads.address", "chain_transfers.from_address", "chain_transfers.to_address", "ledger_invoices.order_ref",
  // NOT SEALED YET (derived copies; the contract step must not run before they are): the engine's stored record of each
  // payment names the transfer's addresses (match_records.chain) and its explanation text names the sender
  "match_records.chain", "match_records.explanation",
  "merchant_quotes.deposit_address", "payment_links.deposit_address",
];

