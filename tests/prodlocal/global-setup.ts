/**
 * The operator's first run, exactly as docs/runbooks/DEPLOYMENT_RUNBOOK_RC7.md ("First run") does it: the admin CLI
 * against the owner login (create-provider, create-merchant, add-entity, add-bank-account, link-provider, add-member).
 * Then, TEST-ONLY, the Admin's and the Approver's authenticator is the suite's fictional TOTP secret, stored exactly as
 * Better Auth stores one (as tests/e2e-control/db.ts does), so the proof can sign in with MFA. Idempotent.
 */
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { PRODLOCAL as P } from "./env";

function admin(...args: string[]) {
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/control/admin.ts", ...args], {
    env: { ...process.env, DATABASE_OWNER_URL: P.ownerUrl, DATABASE_URL: P.ownerUrl, CLEARLINE_SEED_PASSWORD: P.password }, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`admin ${args[0]} failed: ${(r.stderr || r.stdout).slice(0, 500)}`);
}

export default async function globalSetup() {
  admin("create-provider", "harbour-settle-prodlocal", "--name", "Harbour Settle (fictional)", "--timezone", "UTC");
  admin("create-merchant", P.org, "--name", "Harbourline Trading (fictional)", "--timezone", "Asia/Singapore");
  admin("add-entity", P.org, P.entity, "--name", "Harbourline Trading Pte Ltd (fictional)", "--currency", "SGD", "--timezone", "Asia/Singapore", "--utc-offset", "+08:00", "--ledger", "xero");
  const pool = new Pool({ connectionString: P.ownerUrl });
  try {
    const has = await pool.query("select 1 from bank_accounts b join organizations o on o.id = b.org_id where o.slug = $1 and b.entity_id = $2", [P.org, P.entity]);
    if (!has.rowCount) admin("add-bank-account", P.org, P.entity, "--name", "SGD operating (fictional)", "--currency", "SGD", "--last4", "0001", "--bank", "Fictional Test Bank");
    admin("link-provider", P.org, "harbour-settle-prodlocal");
    for (const [role, email] of [["admin", P.people.admin], ["approver", P.people.approver], ["finance", P.people.finance], ["payment_ops", P.people.ops]]) admin("add-member", P.org, email, role, "--name", `${role} (fictional)`);
    const { symmetricEncrypt } = await import("better-auth/crypto");
    for (const email of [P.people.admin, P.people.approver]) {
      const id = (await pool.query("select id from users where email = $1", [email])).rows[0].id as string;
      await pool.query("delete from two_factors where user_id = $1", [id]);
      await pool.query("insert into two_factors (id, secret, backup_codes, user_id, verified) values ($1, $2, $3, $4, true)",
        [`tf_${id}`, await symmetricEncrypt({ key: P.authSecret, data: P.totpSecret }), await symmetricEncrypt({ key: P.authSecret, data: JSON.stringify(["FICT0-PRODL"]) }), id]);
      await pool.query("update users set two_factor_enabled = true where id = $1", [id]);
    }
  } finally { await pool.end(); }
}
