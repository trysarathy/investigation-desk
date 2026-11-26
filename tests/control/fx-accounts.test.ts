/**
 * v1 founder decision 9 against PostgreSQL 16: other-currency accounts under an entity, recorded fiat rates
 * (drizzle/0044) and period-end revaluation proposals (duplicates: bank-line-duplicates.test.ts). Fictional values only.
 *  - Rates: RLS isolation like every merchant table, read-only for the app, append-only for the owner.
 *  - A USD account under the SGD entity: its batch is tied in USD; the SGD value needs a rate until one is recorded
 *    (never 0); a statement naming the batch in another currency is a mismatch, never a tie.
 *  - Revaluation: proposals only (nothing stored), only the people who may export journals, other tenants' rates unseen.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetBlank } from "./harness";
import { accountOf, addTestBankAccount, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { batchBridge } from "../../src/server/merchant";
import { recordFiatRate, recordFromRateSource, SetupRefused } from "../../src/server/merchant-setup";
import { periodEndRevaluation } from "../../src/server/fx-revaluation";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { reconcile } from "../../src/lib/clearline/merchant/reconcile";
import { LocalStandInRateSource } from "../../src/lib/clearline/fx/rate-source";
import type { Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
/** The recording clock in these tests (a fictional date after every as-of used here). */
const LATER = new Date("2026-12-31T00:00:00Z");
let n = 0;
const key = () => `fx-key-${++n}-${Date.now()}`;
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
async function setupRefused(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(SetupRefused); expect((e as Error).message).toMatch(re); return; }
  throw new Error("expected SetupRefused");
}

let fin: TenantContext, approver: TenantContext;
/** ENT-LIVE-SG (SGD): its SGD account and a USD account. */
let sgd: string, sgUsd: string;

async function pipeline(entityId: string, bankAccountId: string | undefined, fileType: "bank_statement" | "settlement_report", fileName: string, bytes: Uint8Array, mapping?: Mapping) {
  const up = await createUpload(fin, { entityId, fileType, fileName, bytes, ...(bankAccountId ? { bankAccountId } : {}) }, key());
  if (mapping) await setUploadMapping(fin, up.upload.id, { mapping }, key());
  const v = (await validateUpload(fin, up.upload.id, key())).body;
  return { id: up.upload.id, v };
}
async function confirmAndNormalise(id: string, v: { contentSha256: string; rowsSha256: string | null }, bank = true) {
  await decideUpload(bank ? approver : fin, id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return (await normaliseUpload(bank ? approver : fin, id, key())).body;
}

beforeAll(async () => {
  useTestStorage();
  await resetBlank();
  s = await seedLiveMerchants(ownerDb());
  fin = await liveCtx(s, "finance@live-a.example", "a");
  approver = await liveCtx(s, "approver@live-a.example", "a");
  sgd = await accountOf(s.orgs.a, "ENT-LIVE-SG");
  sgUsd = await addTestBankAccount(ownerDb(), s.orgs.a, "ENT-LIVE-SG", "USD", "ENT-LIVE-SG USD account (fictional)", "0002");
}, 120_000);
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("a USD account under the SGD entity, through the pipeline", () => {
  const bridge = () => batchBridge(fin, sc.US.batch.id);
  it("the USD settlement and USD statement are kept in USD (no longer skipped); tied in USD; the SGD value needs a rate, never 0", async () => {
    const settle = await pipeline("ENT-LIVE-SG", undefined, "settlement_report", "us-settlement.csv", sc.usSettlementCsv(), sc.US_SETTLEMENT_MAPPING);
    expect((await confirmAndNormalise(settle.id, settle.v, false)).counts).toMatchObject({ created: 2, skipped: 0 }); // two payment rows, one USD batch
    const stmt = await pipeline("ENT-LIVE-SG", sgUsd, "bank_statement", "usd.sta", sc.usMt940());
    expect((await confirmAndNormalise(stmt.id, stmt.v)).counts).toEqual({ created: 1, existing: 0, conflict: 0, skipped: 1 }); // the credit in USD; the wire fee is a debit
    expect(await rows(sql`select currency, bank_account_id, value_date from bank_lines where upload_id = ${stmt.id}`)).toEqual([{ currency: "USD", bank_account_id: sgUsd, value_date: "2026-11-14" }]);
    const b = await bridge();
    expect(b.currency).toBe("USD");
    expect(b.bankLineId).not.toBeNull();
    expect(b.checks).toMatchObject({ netEqualsBankLine: true, grossLessFeesRefundsEqualsNet: true, currencyAgrees: true });
    expect(b.entityValue).toMatchObject({ status: "needs_rate", pair: "USD/SGD", currency: "SGD" });
    expect(b.entityValue).not.toHaveProperty("amountMinor");
  });
  it("once a USD/SGD rate is recorded at or before the value date (≤ 24 h older), the SGD value is shown; the tie is unchanged", async () => {
    const before = await bridge();
    await recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair: "USD/SGD", rate: "1.3500", asOf: "2026-11-14T02:00:00Z", source: "Fictional Rate Desk" }, LATER);
    const rated = await bridge();
    expect(rated.entityValue).toMatchObject({ status: "rated", currency: "SGD", pair: "USD/SGD", rate: "1.3500", source: "Fictional Rate Desk", amountMinor: "212504" }); // 1,574.10 × 1.35 = 2,125.035 → 2,125.04
    expect([rated.checks, rated.tied, rated.lines]).toEqual([before.checks, before.tied, before.lines]);
    await refused(batchBridge(await liveCtx(s, "finance@live-b.example", "b"), sc.US.batch.id), "ACCESS_404");
  });
  it("a rate recorded after the value date's end does not count", async () => {
    await recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair: "USD/SGD", rate: "1.4000", asOf: "2026-11-20T00:00:00Z", source: "Later desk (fictional)" }, LATER);
    expect((await bridge()).entityValue).toMatchObject({ status: "rated", rate: "1.3500" });
  });
  it("a statement line naming the USD batch in SGD is never its bank line; without the USD line, it is a currency mismatch, never a tie", async () => {
    const csv = new TextEncoder().encode(`Valuta;Betrag;Verwendungszweck\n14.11.2026;2.125,04;PAYOUT ${sc.US.batch.id}\n`);
    const mapping: Mapping = { fileType: "bank_statement", columns: { bank_account: { constant: sc.US.account }, value_date: { header: "Valuta", dateFormat: "dmy" }, amount: { header: "Betrag", decimalSeparator: "," }, currency: { constant: "SGD" }, reference: { header: "Verwendungszweck" } } };
    const up = await pipeline("ENT-LIVE-SG", sgd, "bank_statement", "sgd-names-usd-batch.csv", csv, mapping);
    expect((await confirmAndNormalise(up.id, up.v)).counts.created).toBe(1);
    const b = await bridge();
    expect(b.checks.currencyAgrees).toBe(true);
    const sgdLine = (await rows(sql`select line_id from bank_lines where upload_id = ${up.id}`))[0].line_id;
    expect(b.bankLineId).not.toBe(sgdLine);
    const input = await withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => loadReconcileInput(tx, fin.orgId, "ENT-LIVE-SG"), { read: true });
    const only = reconcile({ ...input, bankLines: input.bankLines.filter((l) => l.currency === "SGD") }).bridges.find((x) => x.batchId === sc.US.batch.id)!;
    expect([only.checks.currencyAgrees, only.checks.netEqualsBankLine, only.tied, only.bankLineId]).toEqual([false, false, false, null]);
  });
});

describe("recorded fiat rates (0044)", () => {
  it("recorded by the provisioning path; same again is no change; another rate at the same point, the future and bad input are refused; audit holds ids", async () => {
    const r = await recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair: "USD/SGD", rate: "1.3500", asOf: "2026-11-15T02:00:00Z", source: "Fictional Rate Desk" }, LATER);
    expect(r.status).toBe("created");
    expect((await recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair: "USD/SGD", rate: "1.35", asOf: "2026-11-15T02:00:00Z", source: "Fictional Rate Desk" }, LATER)).status).toBe("exists");
    await setupRefused(recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair: "USD/SGD", rate: "1.3600", asOf: "2026-11-15T02:00:00Z", source: "Fictional Rate Desk" }, LATER), /never changed/);
    await setupRefused(recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair: "USD/SGD", rate: "1.3600", asOf: "2099-01-01T00:00:00Z", source: "X" }, LATER), /future/);
    for (const [pair, rate, asOf] of [["USD/USD", "1", "2026-11-14T02:00:00Z"], ["EUR/SGD", "1", "2026-11-14T02:00:00Z"], ["USD/SGD", "0", "2026-11-14T02:00:00Z"], ["USD/SGD", "1.3", "14/11/2026"]])
      await expect(recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair, rate, asOf, source: "X" })).rejects.toBeInstanceOf(SetupRefused);
    const audit = await rows(sql`select details, actor_user_id from audit_events where action = 'fiat_rate_recorded' and entity_id = ${r.rateId}`);
    expect(audit).toEqual([{ details: { rateId: r.rateId, pair: "USD/SGD", asOf: "2026-11-15T02:00:00.000Z" }, actor_user_id: null }]);
    expect(await rows(sql`select distinct recorded_by from fiat_rates`)).toEqual([{ recorded_by: "admin-cli" }]);
  });
  it("the local stand-in source records only what its table holds (no network)", async () => {
    const src = new LocalStandInRateSource({ "USD/AED": "3.6725" });
    expect(await recordFromRateSource(ownerDb(), src, { orgSlug: s.slugs.a, pair: "AED/SGD", asOf: "2026-11-14T02:00:00Z" })).toEqual({ status: "no_rate", pair: "AED/SGD" });
    expect((await recordFromRateSource(ownerDb(), src, { orgSlug: s.slugs.a, pair: "USD/AED", asOf: "2026-11-30T08:00:00Z" }, LATER)).status).toBe("created");
    expect(await rows(sql`select source_label from fiat_rates where base_currency = 'USD' and quote_currency = 'AED'`)).toEqual([{ source_label: "Local stand-in (fictional rates)" }]);
  });
  it("RLS: a merchant's members see only their own rates; another merchant, a forced context and a provider without a grant see none", async () => {
    const finB = await liveCtx(s, "finance@live-b.example", "b");
    const count = async (userId: string, orgId: string) => Number((await as(userId, orgId, sql`select count(*)::int as n from fiat_rates`)).rows[0].n);
    expect(await count(fin.userId, fin.orgId)).toBe(4); // three USD/SGD (pipeline above and here) and one USD/AED
    expect(await count(finB.userId, finB.orgId)).toBe(0);
    expect(await count(finB.userId, s.orgs.a)).toBe(0);
    expect(await count(s.users["admin@provider-a.example"], s.orgs.providerA)).toBe(0);
    expect(await count(s.users["admin@provider-a.example"], s.orgs.a)).toBe(0);
  });
  it("the app cannot record, change or delete a rate (not even an Admin); the owner cannot change or delete one (append-only)", async () => {
    const admin = await liveCtx(s, "admin@live-a.example", "a");
    await dbRefuses(as(admin.userId, admin.orgId, sql`insert into fiat_rates (org_id, base_currency, quote_currency, rate, as_of, source_label, recorded_by) values (${admin.orgId}, 'USD', 'SGD', 9, now(), 'Forged', ${admin.userId})`), /permission denied/);
    await dbRefuses(as(admin.userId, admin.orgId, sql`update fiat_rates set rate = 9`), /permission denied/);
    await dbRefuses(as(admin.userId, admin.orgId, sql`delete from fiat_rates`), /permission denied/);
    for (const [role, p] of [["clearline_runtime", "SELECT"], ["clearline_runtime", "INSERT"], ["clearline_runtime", "UPDATE"], ["clearline_runtime", "DELETE"], ["clearline_jobs", "SELECT"]] as const)
      expect((await rows(sql`select has_table_privilege(${role}, 'public.fiat_rates', ${p}) as ok`))[0].ok, `${role} ${p}`).toBe(role === "clearline_runtime" && p === "SELECT");
    await dbRefuses(ownerDb().execute(sql`update fiat_rates set rate = 9`), /append-only/);
    await dbRefuses(ownerDb().execute(sql`delete from fiat_rates`), /append-only/);
    await dbRefuses(ownerDb().execute(sql`insert into fiat_rates (org_id, base_currency, quote_currency, rate, as_of, source_label, recorded_by) values (${s.orgs.a}, 'USD', 'SGD', 0, now(), 'X', 'admin-cli')`), /fiat_rates_rate_chk/);
  });
});

describe("period-end revaluation proposals", () => {
  const balances = [{ account: "provider_clearing", currency: "USD", foreignMinor: "100000", carryingMinor: "135000", ref: "provider-a-usd" }];
  it("proposed at the period-end rate, pending sign-off, nothing stored; needs a rate without one", async () => {
    const before = Number((await rows(sql`select count(*)::int as n from merchant_journal_proposals`))[0].n);
    const none = await periodEndRevaluation(fin, { entityId: "ENT-LIVE-SG", periodEnd: "2026-11-30", balances });
    expect(none.proposals).toEqual([]);
    expect(none.items).toMatchObject([{ status: "needs_rate" }]);
    await recordFiatRate(ownerDb(), { orgSlug: s.slugs.a, pair: "USD/SGD", rate: "1.3600", asOf: "2026-11-30T08:00:00Z", source: "Fictional Rate Desk" }, LATER);
    const r = await periodEndRevaluation(fin, { entityId: "ENT-LIVE-SG", periodEnd: "2026-11-30", balances });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ kind: "fx_revaluation", status: "proposed", postingRuleStatus: "pending_sign_off", currency: "SGD", entryDate: "2026-11-30",
      lines: [{ side: "debit", account: "provider_clearing", amountMinor: 1000n }, { side: "credit", account: "unrealised_fx", amountMinor: 1000n }] });
    expect(Number((await rows(sql`select count(*)::int as n from merchant_journal_proposals`))[0].n)).toBe(before);
  });
  it("only Finance, an Approver or an Admin; another merchant cannot see these rates; bad input refused", async () => {
    for (const email of ["ops@live-a.example", "viewer@live-a.example"]) await refused(periodEndRevaluation(await liveCtx(s, email, "a"), { entityId: "ENT-LIVE-SG", periodEnd: "2026-11-30", balances }), "ACCESS_403");
    const finB = await liveCtx(s, "finance@live-b.example", "b");
    // org A holds a USD/AED rate as of 30 Nov; merchant B's AED entity cannot use it
    const b = await periodEndRevaluation(finB, { entityId: "ENT-LIVE-AE", periodEnd: "2026-11-30", balances });
    expect([b.proposals, b.items[0].status]).toEqual([[], "needs_rate"]);
    await refused(periodEndRevaluation(finB, { entityId: "ENT-LIVE-SG", periodEnd: "2026-11-30", balances }), "ACCESS_404");
    await refused(periodEndRevaluation(fin, { entityId: "ENT-LIVE-SG", periodEnd: "2026-11-30", balances: [{ ...balances[0], currency: "SGD" }] }), "NOT_OTHER_CURRENCY");
    await refused(periodEndRevaluation(fin, { entityId: "ENT-LIVE-SG", periodEnd: "30/11/2026", balances }), "BAD_REVALUATION_INPUT");
  });
});
