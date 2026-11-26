/**
 * v1 phase 0 against PostgreSQL 16: bank accounts of an entity (drizzle/0039). Isolation (RLS, like every merchant
 * table), the app can only read them, a new bank statement names an ACTIVE account of its entity (service and
 * database), its lines must be in the account's currency (refused before storing for MT940 / camt.053, rows rejected
 * for tables, and a database backstop on bank_lines), normalised lines carry the account, and the second-person
 * confirmation of statements is unchanged. Fictional values only, built in the test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetBlank } from "./harness";
import { accountOf, addTestBankAccount, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, withTenant } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, setUploadMapping, validateUpload, validationReport } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { closeBankAccount } from "../../src/server/merchant-setup";

let s: LiveSeed;
let n = 0;
const key = () => `ba-key-${++n}-${Date.now()}`;
const as = (userId: string, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(q));
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

/** ENT-LIVE-SG (SGD) has its SGD account and, like a Singapore company, a USD account. */
let sgd: string, sgUsd: string, usd: string, ae: string;

beforeAll(async () => {
  useTestStorage();
  await resetBlank();
  s = await seedLiveMerchants(ownerDb());
  sgd = await accountOf(s.orgs.a, "ENT-LIVE-SG");
  usd = await accountOf(s.orgs.a, "ENT-LIVE-US");
  ae = await accountOf(s.orgs.b, "ENT-LIVE-AE");
  sgUsd = await addTestBankAccount(ownerDb(), s.orgs.a, "ENT-LIVE-SG", "USD", "ENT-LIVE-SG USD account (fictional)", "0002");
}, 120_000);
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("isolation and grants", () => {
  it("a merchant's members see only their own accounts; another merchant, a forced context and a provider without a grant see none", async () => {
    const finA = await liveCtx(s, "finance@live-a.example", "a"), finB = await liveCtx(s, "finance@live-b.example", "b");
    const ids = async (userId: string, orgId: string) => (await as(userId, orgId, sql`select id from bank_accounts order by id`)).rows.map((r) => r.id);
    expect(await ids(finA.userId, finA.orgId)).toEqual([sgd, sgUsd, usd].sort());
    expect(await ids(finB.userId, finB.orgId)).toEqual([ae]);
    expect(await ids(finB.userId, s.orgs.a)).toEqual([]);
    expect(await ids(s.users["admin@provider-a.example"], s.orgs.providerA)).toEqual([]);
    expect(await ids(s.users["admin@provider-a.example"], s.orgs.a)).toEqual([]);
  });
  it("the app cannot create, change or delete an account, not even an Admin of the merchant (provisioning path only)", async () => {
    const admin = await liveCtx(s, "admin@live-a.example", "a");
    await dbRefuses(as(admin.userId, admin.orgId, sql`insert into bank_accounts (org_id, entity_id, currency, display_name, account_last4, bank_name) values (${admin.orgId}, 'ENT-LIVE-SG', 'SGD', 'Forged (fictional)', '9999', 'X')`), /permission denied/);
    await dbRefuses(as(admin.userId, admin.orgId, sql`update bank_accounts set currency = 'USD' where id = ${sgd}`), /permission denied/);
    await dbRefuses(as(admin.userId, admin.orgId, sql`delete from bank_accounts where id = ${sgd}`), /permission denied/);
    for (const [role, p] of [["clearline_runtime", "SELECT"], ["clearline_runtime", "INSERT"], ["clearline_runtime", "UPDATE"], ["clearline_runtime", "DELETE"], ["clearline_jobs", "SELECT"]] as const) {
      expect((await rows(sql`select has_table_privilege(${role}, 'public.bank_accounts', ${p}) as ok`))[0].ok, `${role} ${p}`).toBe(role === "clearline_runtime" && p === "SELECT");
    }
  });
  it("the owner cannot change an account's entity, currency or number, reopen a closed account, or delete one", async () => {
    await dbRefuses(ownerDb().execute(sql`update bank_accounts set currency = 'SGD' where id = ${usd}`), /never change/);
    await dbRefuses(ownerDb().execute(sql`update bank_accounts set account_last4 = '1111' where id = ${usd}`), /never change/);
    await dbRefuses(ownerDb().execute(sql`delete from bank_accounts where id = ${usd}`), /append-only/);
    await dbRefuses(ownerDb().execute(sql`insert into bank_accounts (org_id, entity_id, currency, display_name, account_last4, bank_name) values (${s.orgs.a}, 'ENT-LIVE-SG', 'SGD', 'Full number (fictional)', 'DE8937040044', 'X')`), /bank_accounts_last4_chk/);
  });
});

describe("a bank statement names its account", () => {
  it("required for a statement, refused for other files, another entity's or merchant's account, and a closed account", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const base = { entityId: "ENT-LIVE-SG", fileType: "bank_statement" as const, fileName: "statement.csv", bytes: sc.sgBankCsv("req") };
    await refused(createUpload(fin, base, key()), "BANK_ACCOUNT_REQUIRED");
    await refused(createUpload(fin, { ...base, fileType: "provider_export", bankAccountId: sgd }, key()), "BANK_ACCOUNT_NOT_STATEMENT");
    await refused(createUpload(fin, { ...base, bankAccountId: usd }, key()), "ACCESS_404"); // ENT-LIVE-US's account
    await refused(createUpload(fin, { ...base, bankAccountId: ae }, key()), "ACCESS_404"); // merchant B's account
    const closing = await addTestBankAccount(ownerDb(), s.orgs.a, "ENT-LIVE-SG", "SGD", "Old account (fictional)", "0003");
    expect((await closeBankAccount(ownerDb(), { orgSlug: s.slugs.a, bankAccountId: closing })).status).toBe("dry_run");
    expect((await closeBankAccount(ownerDb(), { orgSlug: s.slugs.a, bankAccountId: closing, confirm: s.slugs.a })).status).toBe("closed");
    await dbRefuses(ownerDb().execute(sql`update bank_accounts set status = 'active', closed_at = null where id = ${closing}`), /never reopened/);
    await refused(createUpload(fin, { ...base, bankAccountId: closing }, key()), "BANK_ACCOUNT_CLOSED");
    expect((await rows(sql`select count(*)::int as n from uploads`))[0].n).toBe(0);
  });
  it("the database refuses a new statement without an account, with another entity's account, and a change of account", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const insert = (entity: string, account: string | null, sha: string) => as(fin.userId, fin.orgId, sql`insert into uploads (org_id, entity_id, bank_account_id, file_type, file_format, original_name, byte_size, content_sha256, encrypted, uploaded_by, delete_after)
      values (${fin.orgId}, ${entity}, ${account}, 'bank_statement', 'csv', 'x.csv', 1, ${sha.repeat(64)}, false, ${fin.userId}, now() + interval '90 days')`);
    await dbRefuses(insert("ENT-LIVE-SG", null, "a"), /names the bank account/);
    await dbRefuses(insert("ENT-LIVE-SG", usd, "b"), /active bank account of its entity/);
    await dbRefuses(as(fin.userId, fin.orgId, sql`insert into uploads (org_id, entity_id, bank_account_id, file_type, file_format, original_name, byte_size, content_sha256, encrypted, uploaded_by, delete_after)
      values (${fin.orgId}, 'ENT-LIVE-SG', ${sgd}, 'provider_export', 'csv', 'x.csv', 1, ${"c".repeat(64)}, false, ${fin.userId}, now() + interval '90 days')`), /uploads_bank_account_type_chk/);
    const up = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "bank_statement", bankAccountId: sgd, fileName: "s.csv", bytes: sc.sgBankCsv("move") }, key());
    expect(up.upload.bankAccountId).toBe(sgd);
    await dbRefuses(ownerDb().execute(sql`update uploads set bank_account_id = ${sgUsd} where id = ${up.upload.id}`), /bank account never changes/);
    const audit = await rows(sql`select details from audit_events where action = 'upload_stored' and entity_id = ${up.upload.id}`);
    expect(audit[0].details).toMatchObject({ bankAccountId: sgd, entityId: "ENT-LIVE-SG" });
  });
});

describe("statement currency = account currency", () => {
  it("an MT940 statement in USD is refused before storing for the SGD account (audited), and stored for the entity's USD account", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const before = Number((await rows(sql`select count(*)::int as n from uploads`))[0].n);
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "bank_statement", bankAccountId: sgd, fileName: "usd.sta", bytes: sc.usMt940() }, key()), "STATEMENT_CURRENCY_MISMATCH");
    expect(Number((await rows(sql`select count(*)::int as n from uploads`))[0].n)).toBe(before);
    expect(await rows(sql`select details from audit_events where action = 'upload_refused' and details->>'code' = 'STATEMENT_CURRENCY_MISMATCH'`))
      .toEqual([{ details: { code: "STATEMENT_CURRENCY_MISMATCH", byteSize: sc.usMt940().byteLength, fileType: "bank_statement", entityId: "ENT-LIVE-SG", bankAccountId: sgd } }]);
    const ok = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "bank_statement", bankAccountId: sgUsd, fileName: "usd.sta", bytes: sc.usMt940() }, key());
    const v = (await validateUpload(fin, ok.upload.id, key())).body;
    expect(v.counts).toMatchObject({ rows: 2, accepted: 2, rejected: 0 });
    await decideUpload(await liveCtx(s, "approver@live-a.example", "a"), ok.upload.id, { decision: "confirm", reason: "USD statement checked (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
    // v1 founder decision 9: a USD account's credits under the SGD entity are kept in USD (reconciled in the account's
    // currency, never converted); the debit is skipped. (Before decision 9 both lines were skipped.)
    expect((await normaliseUpload(fin, ok.upload.id, key())).body.counts).toEqual({ created: 1, existing: 0, conflict: 0, skipped: 1 });
  });
  it("a CSV statement mapped as SGD uploaded to the USD account: every row is rejected (currency_not_bank_account) and nothing can be confirmed", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const up = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "bank_statement", bankAccountId: sgUsd, fileName: "sgd.csv", bytes: sc.sgBankCsv("wrong-account") }, key());
    await setUploadMapping(fin, up.upload.id, { mapping: sc.SG_BANK_MAPPING }, key());
    const v = (await validateUpload(fin, up.upload.id, key())).body;
    expect(v.counts).toMatchObject({ rows: 3, accepted: 0, warning: 0, rejected: 3 });
    const report = await validationReport(fin, up.upload.id);
    expect(report.rows.every((r) => (r.reasonCodes as { code: string }[]).some((c) => c.code === "currency_not_bank_account"))).toBe(true);
    await refused(decideUpload(await liveCtx(s, "approver@live-a.example", "a"), up.upload.id, { decision: "confirm", reason: "x (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key()), "NOTHING_TO_CONFIRM");
  });
  it("the database refuses a bank line in another currency than its account, for another entity, or not its upload's account", async () => {
    const line = (id: string, account: string, currency: string, entity = "ENT-LIVE-SG") => ownerDb().execute(sql`insert into bank_lines (org_id, line_id, account, currency, value_date, amount_minor, description, source, entity_id, bank_account_id)
      values (${s.orgs.a}, ${id}, 'ACC-FICT', ${currency}, '2026-11-03', 100, 'x', 'seed_fictional', ${entity}, ${account})`);
    await dbRefuses(line("BL-1", sgd, "USD"), /statement currency differs from the bank account's currency/);
    await dbRefuses(line("BL-2", usd, "USD", "ENT-LIVE-SG"), /bank account of its entity/);
    await line("BL-3", sgUsd, "USD");
    expect(await rows(sql`select bank_account_id from bank_lines where line_id = 'BL-3'`)).toEqual([{ bank_account_id: sgUsd }]);
  });
});

describe("the SGD statement through the whole pipeline", () => {
  it("lines carry the upload's account; the second-person confirmation is unchanged (uploader and Finance refused, an Approver confirms)", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a"), approver = await liveCtx(s, "approver@live-a.example", "a");
    const up = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "bank_statement", bankAccountId: sgd, fileName: "sgd-ok.csv", bytes: sc.sgBankCsv("ok") }, key());
    await setUploadMapping(fin, up.upload.id, { mapping: sc.SG_BANK_MAPPING }, key());
    const v = (await validateUpload(fin, up.upload.id, key())).body;
    expect(v.counts).toMatchObject({ rows: 3, accepted: 3, rejected: 0 });
    const decision = { decision: "confirm" as const, reason: "Statement checked (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! };
    await refused(decideUpload(fin, up.upload.id, decision, key()), "ACCESS_403");
    await dbRefuses(as(fin.userId, fin.orgId, sql`update uploads set status = 'confirmed', confirmed_by = ${fin.userId}, confirmed_at = now() where id = ${up.upload.id}`), /maker-checker|uploads_confirmer_chk/);
    expect((await decideUpload(approver, up.upload.id, decision, key())).body).toMatchObject({ status: "confirmed", confirmedBy: approver.userId, bankAccountId: sgd });
    // while confirmed (provenance otherwise in order): a file_import line must belong to its upload's account
    await dbRefuses(ownerDb().execute(sql`insert into bank_lines (org_id, line_id, account, currency, value_date, amount_minor, description, source, entity_id, bank_account_id, upload_id, source_row, uploaded_by)
      values (${s.orgs.a}, 'FILE-FORGED', 'ACC-FICT', 'SGD', '2026-11-03', 100, 'x', 'file_import', 'ENT-LIVE-SG', null, ${up.upload.id}, 2, ${fin.userId})`), /belongs to its upload's bank account/);
    const norm = (await normaliseUpload(approver, up.upload.id, key())).body;
    expect(norm.counts.created).toBe(2); // two credits in SGD; the bracketed fee is a debit (skipped)
    const lines = await ownerDb().select({ a: t.bankLines.bankAccountId, c: t.bankLines.currency }).from(t.bankLines).where(and(eq(t.bankLines.orgId, s.orgs.a), eq(t.bankLines.uploadId, up.upload.id)));
    expect(lines).toEqual([{ a: sgd, c: "SGD" }, { a: sgd, c: "SGD" }]);
  });
});
