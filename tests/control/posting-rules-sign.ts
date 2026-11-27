/**
 * Wave 2 integration: c3's ledger tests sign the posting rules in d2's real table (drizzle/0077), as the schema owner,
 * the way d2's sign-off would record it (a fictional Admin, an MFA step-up just now). postingRulesSigned holds only when
 * the newest standing signature is the CURRENT catalogue version (d2's contract).
 */
import { sql } from "drizzle-orm";
import { postingRulesCatalogue } from "../../src/lib/clearline/merchant/posting-rules";
import { ownerDb } from "./harness";

export const currentPostingRulesVersion = () => postingRulesCatalogue().version;
/** A well-formed version that is not the current catalogue's (an older one). */
export const OLDER_POSTING_RULES = { version: "PR-000000000000", sha256: "0".repeat(64) };

export async function signPostingRules(orgId: string, adminUserId: string, v: { version: string; sha256: string } = postingRulesCatalogue()) {
  const r = await ownerDb().execute(sql`insert into posting_rules_signatures (org_id, version, version_sha256, catalogue, signed_by_user_id, signed_by_name, mfa_verified_at)
    values (${orgId}, ${v.version}, ${v.sha256}, '{}'::jsonb, ${adminUserId}, 'Test signer (fictional)', now()) returning id`);
  return String(r.rows[0].id);
}
export async function revokePostingRules(id: string, adminUserId: string) {
  await ownerDb().execute(sql`update posting_rules_signatures set revoked_at = now(), revoked_by_user_id = ${adminUserId}, revoked_reason = 'test revocation (fictional)' where id = ${id}`);
}
