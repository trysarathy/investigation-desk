/**
 * v1 phase 3: a digest of what reconciliation stored for one organisation (decisions, parts, differences, exceptions,
 * write-offs, journal proposals, chain facts and run counts), without the values that differ between two runs of the
 * same data by design (random run ids, wall-clock times, the benchmark's own org id and rule-set label). Two code
 * versions that store the same results on the same seed give the same digests.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/server/db/client";

const TABLES: Record<string, string> = {
  match_records: `select order_id, decision, deciding_step, rule_id, chain, provider, bank, ledger, explanation, engine_version, input_sha256, bank_evidence, settled from match_records where org_id = $1 order by order_id`,
  differences: `select id, order_id, type, amount_minor, currency, reason, rule_id, stamp_source, superseded_at is not null as superseded, run_id is not null as has_run from differences where org_id = $1 order by id`,
  recon_exceptions: `select id, order_id, entity_id, owner_role, reason, next_step, status, closed_at is not null as closed from recon_exceptions where org_id = $1 order by id`,
  writeoff_proposals: `select id, order_id, amount_minor, currency, difference_ids, status from writeoff_proposals where org_id = $1 order by id`,
  merchant_journal_proposals: `select id, entity_id, pattern, lines, currency, evidence_refs, status, posting_rule_status from merchant_journal_proposals where org_id = $1 order by id`,
  chain_transfers: `select network, tx_hash, log_index, source, token_contract, from_address, to_address, amount_base_units, decimals, block, block_time, confirmations, finalised, claimed_symbol, block_hash from chain_transfers where org_id = $1 order by network, tx_hash, log_index, source`,
  runs: `select entity_id, trigger, status, policy_revision, input_sha256, matched, with_difference, review, exceptions, unpaid, kept, notices from reconciliation_runs where org_id = $1 order by started_at, finished_at, entity_id`,
};

export async function dbDigest(owner: Db, orgId: string, rulesLabel?: string): Promise<Record<string, { rows: number; sha256: string }>> {
  const out: Record<string, { rows: number; sha256: string }> = {};
  for (const [name, q] of Object.entries(TABLES)) {
    const client = (owner as unknown as { $client: { query: (q: string, p: unknown[]) => Promise<{ rows: unknown[] }> } }).$client;
    const rows = (await client.query(q, [orgId])).rows;
    let text = JSON.stringify(rows);
    if (rulesLabel) text = text.split(rulesLabel).join("<rules>");
    out[name] = { rows: rows.length, sha256: createHash("sha256").update(text).digest("hex") };
  }
  void sql;
  return out;
}
