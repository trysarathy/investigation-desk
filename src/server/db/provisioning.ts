import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AccessDenied } from "../tenant";
import { RequestRefused } from "../errors";
import { neonLoginUrl } from "./neon-logins";

/**
 * v1 phase 1.1: the PROVISIONING connection (DATABASE_PROVISIONING_URL, the `clearline_provisioning` login of
 * migration 0049). The platform console, the invitation acceptance and the setup wizard write ONLY through it, and
 * only by calling the prov_* functions: the role holds no table privilege, so `withProvisioning` exposes nothing but
 * `call`. Never the schema owner, never the runtime login. Reads for the screens stay on the runtime connection.
 */
type ProvDb = NodePgDatabase<Record<string, never>>;
declare global { var __clearlineProvDb: { pool: Pool; db: ProvDb } | undefined }

function provisioningDb(): ProvDb {
  if (!globalThis.__clearlineProvDb) {
    const url = neonLoginUrl("provisioning") ?? process.env.DATABASE_PROVISIONING_URL;
    if (!url) throw new RequestRefused(409, "PROVISIONING_NOT_CONFIGURED", "Setup is not available on this deployment (DATABASE_PROVISIONING_URL is not set).");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_PROVISIONING_POOL_MAX ?? 3), statement_timeout: 15_000 });
    pool.on("error", (e) => console.error(JSON.stringify({ event: "db_provisioning_idle_connection_lost", code: (e as { code?: string }).code ?? "unknown" })));
    globalThis.__clearlineProvDb = { pool, db: drizzle(pool) };
  }
  return globalThis.__clearlineProvDb.db;
}

export async function closeProvisioningDatabase(): Promise<void> {
  const c = globalThis.__clearlineProvDb;
  globalThis.__clearlineProvDb = undefined;
  roleCheck = undefined;
  if (c) await c.pool.end();
}

let roleCheck: Promise<void> | undefined;
/**
 * Refuse to run when the provisioning URL names a login that could do more than call the prov_* functions: a
 * superuser, BYPASSRLS, the schema owner (owns the tables), or a member of clearline_app (the runtime role).
 */
async function assertProvisioningRole(db: ProvDb) {
  const r = await db.execute(sql`select r.rolsuper as su, r.rolbypassrls as bypass, pg_has_role(current_user, 'clearline_app', 'MEMBER') as app,
    exists (select 1 from pg_tables where schemaname = 'public' and tableowner = current_user) as owns
    from pg_roles r where r.rolname = current_user`);
  const row = r.rows[0] ?? {};
  if (row.su || row.bypass || row.app || row.owns) throw new Error("refusing to provision: DATABASE_PROVISIONING_URL must be the clearline_provisioning login (not the owner, the runtime login or a superuser)");
}

/** What a provisioning transaction may do: call one prov_* function with bound parameters. */
export interface ProvTx {
  call(fn: ProvFunction, args: unknown[]): Promise<Record<string, unknown>[]>;
}
export type ProvFunction =
  | "prov_is_platform_operator" | "prov_platform_create_org" | "prov_platform_invite_admin" | "prov_platform_orgs" | "prov_accept_invitation"
  | "prov_add_entity" | "prov_set_entity_ledger" | "prov_add_bank_account" | "prov_link_provider" | "prov_add_mapping_template"
  | "prov_invite_member" | "prov_revoke_invitation" | "prov_mark_step" | "prov_setup_state"
  | "prov_queue_invitation_email"
  | "prov_member_invite" | "prov_member_revoke_invitation" | "prov_member_deactivate";

/** The database's own refusal ("provisioning: …" / "provisioning refused: …") as a request error; anything else is rethrown. */
export function provisioningRefusal(e: unknown): Error {
  const err = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
  const msg = err.cause?.message ?? err.message ?? "";
  const code = err.cause?.code ?? err.code;
  const m = /^provisioning( refused)?: (.*)$/s.exec(msg);
  if (!m) return e instanceof Error ? e : new Error(String(e));
  const text = m[2].charAt(0).toUpperCase() + m[2].slice(1) + (m[2].endsWith(".") ? "" : ".");
  if (m[1] || code === "42501") return new AccessDenied(403, text);
  return new RequestRefused(422, "SETUP_REFUSED", text);
}

/**
 * One provisioning transaction for `ctx` (the session user, and the organisation when acting inside one): the same
 * transaction-local app.user_id / app.org_id the runtime role uses, so the functions check who acts.
 */
export async function withProvisioning<T>(ctx: { userId?: string; orgId?: string }, fn: (tx: ProvTx) => Promise<T>): Promise<T> {
  const db = provisioningDb();
  await (roleCheck ??= assertProvisioningRole(db).catch((e) => { roleCheck = undefined; throw e; }));
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('app.org_id', ${ctx.orgId ?? ""}, true)`);
      const call: ProvTx["call"] = async (name, args) => {
        const params = sql.join(args.map((a) => sql`${a === undefined ? null : typeof a === "object" && a !== null && !(a instanceof Date) ? JSON.stringify(a) : a}`), sql`, `);
        return (await tx.execute(sql`select * from ${sql.identifier(name)}(${params})`)).rows as Record<string, unknown>[];
      };
      return fn({ call });
    });
  } catch (e) { throw provisioningRefusal(e); }
}
