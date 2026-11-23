/** rc6 phase 1: provider → merchant tenancy, RLS, aggregates-only default, grants, immutable facts. Test mode · illustrative data. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { withTenant } from "../../src/server/tenant";
import { createUser, grantMembership } from "../../src/server/admin";

let ids: Record<string, string>;
const org: Record<string, string> = {};
const q = (s: string) => ownerDb().execute(sql.raw(s));
const asUser = (userId: string, orgId: string, s: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(s));

beforeAll(async () => {
  ids = await resetAndSeed();
  await q(`TRUNCATE provider_grants, match_reviews, pilot_time_log, merchant_journal_proposals, writeoff_proposals, recon_exceptions, match_records,
    fx_rates, settlement_batch_lines, settlement_batches, provider_payment_records, chain_transfers, payment_links, merchant_quotes, invoices,
    merchant_policy, merchant_entities CASCADE`);
  for (const [slug, kind] of [["pay-provider-a", "provider"], ["pay-provider-b", "provider"], ["merchant-sg", "merchant"], ["merchant-ae", "merchant"]] as const) {
    const r = await q(`insert into organizations (slug, name, timezone, kind) values ('${slug}', '${slug} (fictional)', 'Asia/Singapore', '${kind}') returning id`);
    org[slug] = (r.rows[0] as { id: string }).id;
  }
  await q(`update organizations set provider_org_id = '${org["pay-provider-a"]}' where id in ('${org["merchant-sg"]}', '${org["merchant-ae"]}')`);
  for (const [email, slug, role] of [["fin@merchant-sg.example", "merchant-sg", "finance"], ["fin@merchant-ae.example", "merchant-ae", "finance"],
    ["admin@provider-a.example", "pay-provider-a", "provider_admin"], ["ops@provider-b.example", "pay-provider-b", "provider_ops"]] as const) {
    ids[email] = await createUser(ownerDb(), { email, name: `${email} (fictional)`, password: PASSWORD });
    await grantMembership(ownerDb(), { orgSlug: slug, email, role: role as never });
  }
  for (const m of ["merchant-sg", "merchant-ae"]) {
    await q(`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values ('${org[m]}', 'ENT-1', 'Entity (fictional)', '${m === "merchant-sg" ? "SGD" : "AED"}', 'xero', 'Asia/Singapore')`);
    await q(`insert into invoices (org_id, order_id, entity_id, amount_minor, currency, status, issued_at) values ('${org[m]}', 'BK-1', 'ENT-1', 135000, '${m === "merchant-sg" ? "SGD" : "AED"}', 'open', now())`);
    await q(`insert into match_records (org_id, order_id, decision, deciding_step, rule_id, chain, provider, bank, ledger, explanation, engine_version, input_sha256)
      values ('${org[m]}', 'BK-1', 'matched', 2, 'M2.reference.quote', '{}', '{}', '{}', '{}', '{}', 'test', '${"0".repeat(64)}')`);
    await q(`insert into recon_exceptions (org_id, id, order_id, owner_role, reason, next_step, opened_at) values ('${org[m]}', 'EX-1', 'BK-1', 'Treasury', 'Held for review (fictional)', 'Ask the provider', now())`);
  }
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("reference data", () => {
  it("only the three public token contracts are seeded (USDT on Ethereum by founder decision, rc7), and only TRON and Ethereum are enabled", async () => {
    const t = (await q(`select network, contract, symbol, decimals from token_config order by network, contract`)).rows;
    expect(t).toEqual([
      { network: "ethereum", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
      { network: "ethereum", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
      { network: "tron", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", symbol: "USDT", decimals: 6 },
    ]);
    const n = (await q(`select network from network_config where enabled order by network`)).rows.map((r) => (r as { network: string }).network);
    expect(n).toEqual(["ethereum", "tron"]);
  });
  it("every merchant table has forced RLS", async () => {
    const r = await q(`select relname from pg_class where relname in ('invoices','chain_transfers','chain_reads','bank_lines','match_records','differences','recon_exceptions','writeoff_proposals','merchant_journal_proposals') and not (relrowsecurity and relforcerowsecurity)`);
    expect(r.rows).toEqual([]);
  });
});

describe("merchant isolation", () => {
  it("a merchant user sees only their own merchant, even with another merchant forced into the context", async () => {
    const mine = (await asUser(ids["fin@merchant-sg.example"], org["merchant-sg"], sql`select org_id from invoices`)).rows;
    expect(mine.map((r) => r.org_id)).toEqual([org["merchant-sg"]]);
    const forced = (await asUser(ids["fin@merchant-sg.example"], org["merchant-ae"], sql`select count(*)::int as n from invoices`)).rows[0].n;
    expect(forced).toBe(0);
  });
});

describe("provider access: aggregates by default, rows only with a merchant's full grant", () => {
  it("without a grant a provider sees NO merchant rows, only aggregates of its own merchants", async () => {
    const p = ids["admin@provider-a.example"]; const po = org["pay-provider-a"];
    expect((await asUser(p, po, sql`select count(*)::int as n from invoices`)).rows[0].n).toBe(0);
    expect((await asUser(p, po, sql`select count(*)::int as n from match_records`)).rows[0].n).toBe(0);
    const h = (await asUser(p, po, sql`select merchant_name, payments::int, auto_matched::int, exceptions_open::int, grant_scope from provider_merchant_health(${po}) order by merchant_name`)).rows;
    expect(h).toEqual([
      { merchant_name: "merchant-ae (fictional)", payments: 1, auto_matched: 1, exceptions_open: 1, grant_scope: "aggregates" },
      { merchant_name: "merchant-sg (fictional)", payments: 1, auto_matched: 1, exceptions_open: 1, grant_scope: "aggregates" },
    ]);
  });
  it("another provider gets no aggregates for merchants that are not its own, and a merchant user cannot call the function", async () => {
    const b = (await asUser(ids["ops@provider-b.example"], org["pay-provider-b"], sql`select count(*)::int as n from provider_merchant_health(${org["pay-provider-b"]})`)).rows[0].n;
    expect(b).toBe(0);
    const spoof = (await asUser(ids["ops@provider-b.example"], org["pay-provider-b"], sql`select count(*)::int as n from provider_merchant_health(${org["pay-provider-a"]})`)).rows[0].n;
    expect(spoof).toBe(0);
    const merchantCall = (await asUser(ids["fin@merchant-sg.example"], org["merchant-sg"], sql`select count(*)::int as n from provider_merchant_health(${org["merchant-sg"]})`)).rows[0].n;
    expect(merchantCall).toBe(0);
  });
  it("a merchant's full grant opens read access to THAT merchant only; revoking it closes it; the provider can never write", async () => {
    await asUser(ids["fin@merchant-sg.example"], org["merchant-sg"], sql`insert into provider_grants (merchant_org_id, provider_org_id, scope, granted_by) values (${org["merchant-sg"]}, ${org["pay-provider-a"]}, 'full', ${ids["fin@merchant-sg.example"]})`);
    const p = ids["admin@provider-a.example"]; const po = org["pay-provider-a"];
    const rows = (await asUser(p, po, sql`select org_id from invoices`)).rows;
    expect(rows.map((r) => r.org_id)).toEqual([org["merchant-sg"]]);
    await expect(asUser(p, po, sql`update invoices set status = 'paid' where org_id = ${org["merchant-sg"]}`)).resolves.toMatchObject({ rowCount: 0 });
    await q(`update provider_grants set revoked_at = now() where merchant_org_id = '${org["merchant-sg"]}'`);
    expect((await asUser(p, po, sql`select count(*)::int as n from invoices`)).rows[0].n).toBe(0);
  });
  it("a grant cannot be created for another merchant, or in someone else's name", async () => {
    await expect(asUser(ids["fin@merchant-sg.example"], org["merchant-sg"], sql`insert into provider_grants (merchant_org_id, provider_org_id, scope, granted_by) values (${org["merchant-ae"]}, ${org["pay-provider-a"]}, 'full', ${ids["fin@merchant-sg.example"]})`)).rejects.toThrow();
    await expect(asUser(ids["fin@merchant-ae.example"], org["merchant-ae"], sql`insert into provider_grants (merchant_org_id, provider_org_id, scope, granted_by) values (${org["merchant-ae"]}, ${org["pay-provider-a"]}, 'full', ${ids["fin@merchant-sg.example"]})`)).rejects.toThrow();
  });
});

describe("immutable facts and gated write-offs", () => {
  it("a chain transfer's amount cannot change, but its confirmations can (reorg); a bank line never changes", async () => {
    const o = org["merchant-sg"]; const u = ids["fin@merchant-sg.example"];
    await asUser(u, o, sql`insert into chain_transfers (org_id, network, tx_hash, log_index, token_contract, from_address, to_address, amount_base_units, decimals, block, block_time, confirmations, finalised, source)
      values (${o}, 'tron', 'tx_fictional_1', 0, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'T_FICTIONAL_FROM', 'T_FICTIONAL_TO', 999000000, 6, 100, now(), 25, true, 'recorded_fixture')`);
    await expect(asUser(u, o, sql`update chain_transfers set amount_base_units = 1 where tx_hash = 'tx_fictional_1'`)).rejects.toThrow();
    await expect(asUser(u, o, sql`update chain_transfers set confirmations = 3, finalised = false where tx_hash = 'tx_fictional_1'`)).resolves.toBeDefined();
    await asUser(u, o, sql`insert into bank_lines (org_id, line_id, account, currency, value_date, amount_minor, description, source) values (${o}, 'BL-1', 'SIMBANK-SGD (fictional)', 'SGD', '2026-11-25', 596124, 'PROVIDER SETTLEMENT (fictional)', 'seed_fictional')`);
    await expect(asUser(u, o, sql`update bank_lines set amount_minor = 1 where line_id = 'BL-1'`)).rejects.toThrow();
    await expect(asUser(u, o, sql`insert into bank_lines (org_id, line_id, account, currency, value_date, amount_minor, description, source) values (${o}, 'BL-2', 'X', 'SGD', '2026-11-25', 1, 'x', 'csv_import')`)).rejects.toThrow(); // csv_import needs import provenance
  });
  it("a write-off cannot be set approved without an approved two-person request; journal rules stay pending sign-off", async () => {
    const o = org["merchant-sg"]; const u = ids["fin@merchant-sg.example"];
    await asUser(u, o, sql`insert into writeoff_proposals (org_id, id, order_id, amount_minor, currency, difference_ids) values (${o}, 'WO-1', 'BK-1', 135, 'SGD', '["D-1"]')`);
    await expect(asUser(u, o, sql`update writeoff_proposals set status = 'approved' where id = 'WO-1'`)).rejects.toThrow();
    await expect(asUser(u, o, sql`update writeoff_proposals set amount_minor = 1 where id = 'WO-1'`)).rejects.toThrow();
    await expect(asUser(u, o, sql`insert into merchant_journal_proposals (org_id, id, entity_id, pattern, lines, currency, evidence_refs, posting_rule_status) values (${o}, 'J-1', 'ENT-1', 'x', '[]', 'SGD', '[]', 'signed_off')`)).rejects.toThrow();
  });
});
