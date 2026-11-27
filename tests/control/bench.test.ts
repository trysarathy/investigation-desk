/**
 * rc7 phase 3b: the end-to-end benchmark at a small size (the full size is `npm run bench:e2e`), and the proof that the
 * bulk normalisation decides exactly as the row-by-row path: the same synthetic files normalised both ways give the
 * same row outcomes, the same normalised rows and the same reconciliation decisions. Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { useTestStorage } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import { runBench } from "../../scripts/bench/e2e-core";
import { deleteMerchant } from "../../src/server/merchant-deletion";

beforeAll(async () => { useTestStorage(); await resetAndSeed(); });
afterAll(async () => { await closeDatabase(); await closeOwner(); });

const rows = async (orgId: string, q: (org: string) => ReturnType<typeof sql>) => (await ownerDb().execute(q(orgId))).rows;

describe("benchmark (small)", () => {
  it("bulk and row-by-row normalisation give the same outcomes, rows and decisions", async () => {
    const bulk = await runBench(ownerDb(), { months: 2, paymentsPerMonth: 60, seed: 4242, tag: "bulk" });
    const slow = await runBench(ownerDb(), { months: 2, paymentsPerMonth: 60, seed: 4242, tag: "rowbyrow", rowByRow: true });
    expect(bulk.payments).toBe(120);
    expect(bulk.bankLines).toBeGreaterThan(20);
    expect(bulk.uploads).toBe(16);
    expect(bulk.decisions.records).toBeGreaterThan(100);
    expect(bulk.decisions).toEqual(slow.decisions);
    const outcomes = (org: string) => sql`select u.file_type, u.original_name, r.row_number, r.status, r.normalise_outcome, regexp_replace(r.target_ref, '^bank_lines:FILE-[0-9a-f]+$', 'bank_lines:FILE-<row fingerprint>') as target_ref from upload_rows r join uploads u on u.org_id = r.org_id and u.id = r.upload_id
      where r.org_id = ${org} order by u.entity_id, u.original_name, r.row_number`;
    expect(await rows(bulk.orgId, outcomes)).toEqual(await rows(slow.orgId, outcomes));
    const targets = (org: string) => sql`select u.original_name, t.row_number, t.target_table, regexp_replace(t.target_key, '^FILE-[0-9a-f]+$', 'FILE-<row fingerprint>') as target_key from upload_row_targets t join uploads u on u.org_id = t.org_id and u.id = t.upload_id
      where t.org_id = ${org} order by 1, 2, 3, 4`;
    expect(await rows(bulk.orgId, targets)).toEqual(await rows(slow.orgId, targets));
    // v1 Phase 5.3: sealed copies and blind indexes differ between two organisations by design (random IVs, per-organisation keys)
    for (const tb of ["invoices", "merchant_quotes", "payment_links", "provider_payment_records", "settlement_batches", "settlement_batch_lines", "bank_lines"]) {
      const q = (org: string) => sql`select (to_jsonb(x) - 'org_id' - 'upload_id' - 'uploaded_by' - 'observed_at' - 'mapping_template_id' - 'provenance' - 'bank_account_id' - 'line_id'
        - 'deposit_address_enc' - 'deposit_address_bidx')::text as j from ${sql.identifier(tb)} x where x.org_id = ${org} order by 1`;
      expect(await rows(bulk.orgId, q), tb).toEqual(await rows(slow.orgId, q));
    }
    // v1 decision 9: a statement line's id is its row's fingerprint, which includes the (per-organisation) bank account,
    // so ids differ between the two organisations; within each, every bank line id is still its own row's fingerprint.
    for (const org of [bulk.orgId, slow.orgId]) {
      const bad = await rows(org, (o: string) => sql`select r.row_number from upload_rows r where r.org_id = ${o} and r.normalise_outcome = 'created' and r.target_ref like 'bank_lines:%'
        and r.target_ref <> 'bank_lines:FILE-' || left(r.row_hash, 32)`);
      expect(bad).toEqual([]);
    }
    const decisions = (org: string) => sql`select order_id, decision, rule_id, deciding_step from match_records where org_id = ${org} order by order_id`;
    expect(await rows(bulk.orgId, decisions)).toEqual(await rows(slow.orgId, decisions));
    expect(Object.keys(bulk.timingsMs)).toEqual(expect.arrayContaining(["upload_validate", "normalise_provider_export", "reconcile_with_chain_verify"]));
    for (const r of [bulk, slow]) await deleteMerchant(ownerDb(), r.slug, r.slug);
  });
});
