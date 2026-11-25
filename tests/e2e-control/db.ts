import { spawnSync } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { E2E } from "./env";

/**
 * Rebuilds the e2e database from the committed migrations (schema owner) and seeds the fictional demo through the
 * real admin CLI (`scripts/control/admin.ts seed-demo`), exactly as an operator would. Test-only.
 */
export async function resetDatabase() {
  const pool = new Pool({ connectionString: E2E.ownerUrl });
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP FUNCTION IF EXISTS refuse_change CASCADE;");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/control/admin.ts", "seed-demo"], {
    env: { ...process.env, DATABASE_URL: E2E.ownerUrl, CLEARLINE_SEED_PASSWORD: E2E.password },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`seed-demo failed: ${r.stderr || r.stdout}`);
  // v1 1.2: Admins and Approvers cannot use Control without MFA. The fictional ones get the suite's test authenticator,
  // stored exactly as Better Auth stores one (encrypted with the suite's test-only secret). admin@lumen.example is left
  // WITHOUT MFA on purpose: the login-security spec shows the enrolment wall and enrols it through the UI.
  const { symmetricEncrypt } = await import("better-auth/crypto");
  const p2 = new Pool({ connectionString: E2E.ownerUrl });
  try {
    for (const email of ["approver@lumen.example", "approver2@lumen.example", "approver@harbour.example"]) {
      const u = await p2.query("select id from users where email = $1", [email]);
      if (!u.rows[0]) continue;
      const id = u.rows[0].id as string;
      await p2.query("insert into two_factors (id, secret, backup_codes, user_id, verified) values ($1, $2, $3, $4, true)", [`tf_${id}`, await symmetricEncrypt({ key: E2E.authSecret, data: E2E.totpSecret }), await symmetricEncrypt({ key: E2E.authSecret, data: JSON.stringify(["FICT0-E2E00"]) }), id]);
      await p2.query("update users set two_factor_enabled = true where id = $1", [id]);
    }
  } finally { await p2.end(); }
}

/** Test-only: one query as the schema owner (the outbox is readable only by the owner). */
export async function ownerQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const p = new Pool({ connectionString: E2E.ownerUrl });
  try { return (await p.query(text, params)).rows as T[]; } finally { await p.end(); }
}
