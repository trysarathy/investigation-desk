/**
 * v1 phase 1.1 onboarding against PostgreSQL 16: the narrow `clearline_provisioning` role (drizzle/0049), the
 * platform console, invitations, the merchant's setup wizard, and invite-only sign-up. The runtime role's grants are
 * compared with a snapshot captured before the provisioning role existed. Fictional organisations and people only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { closeOwner, ownerDb, PASSWORD, resetBlank } from "./harness";
import { runtimeGrantSnapshot } from "./runtime-grants";
import { closeDatabase } from "../../src/server/db/client";
import { closeProvisioningDatabase, withProvisioning } from "../../src/server/db/provisioning";
import { readOutbox, setEmailSenderForTests } from "../../src/server/email";
import { createUser, grantMembership } from "../../src/server/admin";
import { createMerchant, createProvider } from "../../src/server/merchant-setup";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { defaultPolicyFor } from "../../src/lib/clearline/merchant/config";
import { acceptInvitation, tokenSha256 } from "../../src/server/onboarding/invitations";
import { createOrganizationAndInvite, platformOrgs, reinviteFirstAdmin, requirePlatformOperator } from "../../src/server/onboarding/platform";
import { grantPlatformOperator, inviteFirstAdmin, revokePlatformOperator } from "../../src/server/onboarding/operator";
import * as wizard from "../../src/server/onboarding/wizard";
import { GET as authGET, POST as authPOST } from "../../src/app/api/auth/[...all]/route";

if (!process.env.CLEARLINE_TEST_PROVISIONING_URL) throw new Error("BLOCKED: set CLEARLINE_TEST_PROVISIONING_URL (clearline_provisioning; scripts/db/setup-local.sh with a 5th password)");
process.env.DATABASE_PROVISIONING_URL = process.env.CLEARLINE_TEST_PROVISIONING_URL;

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const outbox = mkdtempSync(path.join(tmpdir(), "clearline-xb1-outbox-"));
process.env.CLEARLINE_EMAIL_OUTBOX_DIR = outbox;
const provPool = new Pool({ connectionString: process.env.CLEARLINE_TEST_PROVISIONING_URL, max: 2 });
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function refused(p: Promise<unknown>, re: RegExp, what?: string) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`, what).toMatch(new RegExp(re.source, "i")); return e; }
  throw new Error(`expected a refusal ${re}${what ? ` (${what})` : ""}`);
}
/** One statement on the provisioning LOGIN itself, as an attacker holding its password would run it. */
async function asProvisioningLogin(text: string, ctx: { userId?: string; orgId?: string } = {}) {
  const c = await provPool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [ctx.userId ?? "", ctx.orgId ?? ""]);
    return (await c.query(text)).rows;
  } finally { await c.query("rollback").catch(() => undefined); c.release(); }
}
/** The newest invitation email to `to`, and its token. */
async function lastInvite(to: string) {
  const m = (await readOutbox(outbox)).filter((x) => x.to === to).at(-1);
  if (!m) throw new Error(`no invitation email to ${to}`);
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(m.text)?.[1];
  if (!token) throw new Error("no token in the email");
  return { message: m, token };
}

const ids: Record<string, string> = {};
const orgs: Record<string, string> = {};
let admin: TenantContext, finance: TenantContext, otherAdmin: TenantContext;

beforeAll(async () => {
  await resetBlank();
  const db = ownerDb();
  orgs.prov = (await createProvider(db, { slug: "xb1-provider", name: "Fictional Provider (xb1)", timezone: "Asia/Singapore" })).orgId;
  orgs.a = (await createMerchant(db, { slug: "xb1-merchant-a", name: "Fictional Merchant A", timezone: "Asia/Singapore" })).orgId;
  orgs.b = (await createMerchant(db, { slug: "xb1-merchant-b", name: "Fictional Merchant B", timezone: "Asia/Dubai" })).orgId;
  for (const [email, slug, role] of [["admin@xb1-a.example", "xb1-merchant-a", "admin"], ["finance@xb1-a.example", "xb1-merchant-a", "finance"], ["admin@xb1-b.example", "xb1-merchant-b", "admin"]] as const) {
    ids[email] = await createUser(db, { email, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
    await grantMembership(db, { orgSlug: slug, email, role });
  }
  ids.operator = await createUser(db, { email: "operator@platform.example", name: "Operator (fictional)", password: PASSWORD });
  const p = (email: string) => ({ userId: ids[email], name: email, email });
  admin = await resolveTenant(p("admin@xb1-a.example"), "xb1-merchant-a");
  finance = await resolveTenant(p("finance@xb1-a.example"), "xb1-merchant-a");
  otherAdmin = await resolveTenant(p("admin@xb1-b.example"), "xb1-merchant-b");
}, 120_000);
afterEach(() => { setEmailSenderForTests(undefined); delete process.env.CLEARLINE_PLATFORM_CONSOLE; });
afterAll(async () => { await provPool.end(); await closeProvisioningDatabase(); await closeDatabase(); await closeOwner(); rmSync(outbox, { recursive: true, force: true }); });

describe("the runtime role is exactly unchanged", () => {
  it("its grants, memberships, attributes and policies equal the snapshot taken before migration 0048 (base 6352925)", async () => {
    const before = JSON.parse(readFileSync(path.join(__dirname, "fixtures/runtime-grants.json"), "utf8")) as string[];
    const after = await runtimeGrantSnapshot((t) => ownerDb().execute(sql.raw(t)) as never);
    expect(after).toEqual(before);
    // and it reaches none of the new tables or functions
    for (const tb of ["platform_operators", "org_invitations", "org_setup_steps"]) {
      expect((await rows(sql`select has_table_privilege('clearline_runtime', ${tb}, 'SELECT') as s, has_table_privilege('clearline_runtime', ${tb}, 'INSERT') as i`))[0]).toEqual({ s: false, i: false });
    }
    expect((await rows(sql`select count(*)::int as n from pg_proc where proname like 'prov\\_%' and has_function_privilege('clearline_runtime', oid, 'EXECUTE')`))[0].n).toBe(0);
  });

  it("the runtime login cannot call a provisioning function or read the onboarding tables", async () => {
    const runtime = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL, max: 1 });
    try {
      await refused(runtime.query("select prov_setup_state()"), /permission denied/);
      await refused(runtime.query("select * from org_invitations"), /permission denied/);
      await refused(runtime.query("select * from platform_operators"), /permission denied/);
    } finally { await runtime.end(); }
  });
});

describe("the provisioning role holds only its function grants", () => {
  it("is NOBYPASSRLS, not a superuser, owns nothing, is not the runtime role, and has no privilege on any table or sequence", async () => {
    expect(await rows(sql`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, pg_has_role('clearline_provisioning', 'clearline_app', 'MEMBER') as app from pg_roles where rolname = 'clearline_provisioning'`))
      .toEqual([{ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, app: false }]);
    expect((await rows(sql`select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'clearline_provisioning'`))[0].n).toBe(0);
    const tablePrivs = await rows(sql`select c.relname, p from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where n.nspname = 'public' and c.relkind in ('r','p','v','m','f','S') and has_table_privilege('clearline_provisioning', c.oid, p)`);
    expect(tablePrivs).toEqual([]);
    expect((await rows(sql`select has_schema_privilege('clearline_provisioning', 'public', 'CREATE') as c`))[0].c).toBe(false);
  });

  it("may execute exactly the 14 prov_* entry points (the internal helpers are not executable), besides what PUBLIC may execute", async () => {
    const fns = (await rows(sql`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'prov\\_%' and has_function_privilege('clearline_provisioning', p.oid, 'EXECUTE') order by 1`)).map((r) => r.f);
    expect(fns).toEqual(["prov_accept_invitation", "prov_add_bank_account", "prov_add_entity", "prov_add_mapping_template", "prov_invite_member", "prov_is_platform_operator",
      "prov_link_provider", "prov_mark_step", "prov_platform_create_org", "prov_platform_invite_admin", "prov_platform_orgs", "prov_revoke_invitation", "prov_set_entity_ledger", "prov_setup_state"]);
    // everything else it may execute, PUBLIC (hence the runtime role) may execute too: nothing extra was granted
    expect(await rows(sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not like 'prov\\_%'
      and has_function_privilege('clearline_provisioning', p.oid, 'EXECUTE') and not has_function_privilege('clearline_runtime', p.oid, 'EXECUTE')`)).toEqual([]);
  });

  it("cannot read any organisation's rows, write a table, create an object or call an internal helper", async () => {
    const as = { userId: ids["admin@xb1-a.example"], orgId: orgs.a };
    for (const q of ["select * from organizations", "select * from users", "select * from accounts", "select * from merchant_entities", "select * from bank_accounts",
      "select * from org_invitations", "select * from audit_events", "select * from organization_memberships"]) {
      await refused(asProvisioningLogin(q, as), /permission denied/, q);
    }
    await refused(asProvisioningLogin(`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values ('${orgs.a}', 'X', 'X', 'SGD', 'none', 'UTC')`, as), /permission denied/);
    await refused(asProvisioningLogin(`update organizations set provider_org_id = null`, as), /permission denied/);
    await refused(asProvisioningLogin(`insert into platform_operators (user_id) values ('${ids["admin@xb1-a.example"]}')`, as), /permission denied/);
    await refused(asProvisioningLogin("create table prov_owned (x int)", as), /permission denied/);
    await refused(asProvisioningLogin(`select prov_audit('${orgs.a}', 'x', 'x', 'x', 'x', '{}')`, as), /permission denied/);
    await refused(asProvisioningLogin("select prov_admin_org()", as), /permission denied/);
    await refused(asProvisioningLogin("select prov_insert_invitation(null, 'a@b.example', 'admin', repeat('a', 64), now() + interval '1 day', 'cli')", as), /permission denied/);
  });

  it("an Admin's context reaches only its own organisation: another organisation is refused, and so is a context with no user", async () => {
    // admin of A pointing app.org_id at B (where they are no member)
    await refused(asProvisioningLogin("select prov_setup_state()", { userId: ids["admin@xb1-a.example"], orgId: orgs.b }), /only an Admin of this organisation/);
    await refused(asProvisioningLogin("select prov_add_entity('ENT-X', 'X', 'SGD', 'UTC', 0, 'none')", { userId: ids["admin@xb1-a.example"], orgId: orgs.b }), /only an Admin/);
    await refused(asProvisioningLogin("select prov_invite_member('x@xb1-b.example', 'admin', repeat('b', 64), now() + interval '1 day')", { userId: ids["admin@xb1-a.example"], orgId: orgs.b }), /only an Admin/);
    await refused(asProvisioningLogin("select prov_setup_state()", {}), /no signed-in user/);
    // a provider organisation has no setup wizard
    await refused(asProvisioningLogin("select prov_setup_state()", { userId: ids["admin@xb1-a.example"], orgId: orgs.prov }), /only an Admin/);
    // the platform functions need a platform operator
    await refused(asProvisioningLogin("select * from prov_platform_orgs()", { userId: ids["admin@xb1-a.example"] }), /only a platform operator/);
    await refused(asProvisioningLogin(`select prov_platform_invite_admin('${orgs.b}', 'x@xb1-b.example', repeat('c', 64), now() + interval '1 day')`, { userId: ids["admin@xb1-a.example"] }), /only a platform operator/);
    expect((await rows(sql`select count(*)::int as n from org_invitations`))[0].n).toBe(0);
  });
});

describe("the setup wizard (merchant Admin, provisioning role)", () => {
  it("a non-Admin is refused in the server and again in the database", async () => {
    await refused(wizard.addEntity(finance, { entityId: "ENT-F", name: "No (fictional)", currency: "SGD", timezone: "Asia/Singapore" }), /Only an Admin/);
    await refused(wizard.setupView(finance), /Only an Admin/);
    // a Finance member's context straight into the database function: refused there too
    await refused(withProvisioning({ userId: finance.userId, orgId: finance.orgId }, (tx) => tx.call("prov_add_entity", ["ENT-F", "No", "SGD", "UTC", 0, "none"])), /only an Admin/);
    await refused(withProvisioning({ userId: finance.userId, orgId: finance.orgId }, (tx) => tx.call("prov_mark_step", ["entities"])), /only an Admin/);
    expect((await rows(sql`select count(*)::int as n from merchant_entities where id = 'ENT-F'`))[0].n).toBe(0);
  });

  it("happy path: entities with the approved default policy, ledger, bank account, provider, mapping template, an invitation accepted, then finish", async () => {
    const view0 = await wizard.setupView(admin);
    expect(view0).toMatchObject({ orgName: "Fictional Merchant A", kind: "merchant", finished: false, entities: [], invitations: [], providerName: null });

    expect(await wizard.addEntity(admin, { entityId: "ENT-SG", name: "Fictional Merchant A Pte (fictional)", currency: "SGD", timezone: "Asia/Singapore" }))
      .toMatchObject({ status: "created", utcOffsetMinutes: 480 });
    expect(await wizard.addEntity(admin, { entityId: "ENT-SG", name: "Fictional Merchant A Pte (fictional)", currency: "SGD", timezone: "Asia/Singapore" })).toMatchObject({ status: "exists" });
    await refused(wizard.addEntity(admin, { entityId: "ENT-SG", name: "Changed", currency: "USD", timezone: "Asia/Singapore" }), /already exists with different values/);
    await wizard.addEntity(admin, { entityId: "ENT-US", name: "Fictional Merchant A Inc (fictional)", currency: "USD", timezone: "UTC", utcOffset: "UTC" });
    await wizard.addEntity(admin, { entityId: "ENT-AE", name: "Fictional Merchant A FZ (fictional)", currency: "AED", timezone: "Asia/Dubai", ledger: "xero" });
    // the default policy written by the database equals the approved per-currency default, imported bank lines never verify
    for (const [ent, cur] of [["ENT-SG", "SGD"], ["ENT-US", "USD"], ["ENT-AE", "AED"]] as const) {
      const d = defaultPolicyFor(cur);
      expect((await rows(sql`select tolerance_bps, tolerance_abs_minor::text as abs, tolerance_combine, writeoff_threshold_minor::text as w, approver_roles,
        allow_imported_bank_lines_as_verified as imported, sender_fee_bound_base_units::text as fee, revision from merchant_policy where org_id = ${orgs.a} and entity_id = ${ent}`))[0])
        .toEqual({ tolerance_bps: d.tolerancePct, abs: d.toleranceAbsMinor.toString(), tolerance_combine: "larger", w: d.writeoffThresholdMinor.toString(), approver_roles: ["approver"],
          imported: false, fee: d.senderFeeBoundBaseUnits.toString(), revision: 1 });
    }
    expect(defaultPolicyFor("AED").toleranceAbsMinor).toBe(2000n);
    await wizard.markStep(admin, { step: "entities" });

    expect(await wizard.setLedger(admin, { entityId: "ENT-SG", ledger: "quickbooks" })).toMatchObject({ status: "changed" });
    expect(await wizard.setLedger(admin, { entityId: "ENT-SG", ledger: "quickbooks" })).toMatchObject({ status: "unchanged" });
    await refused(wizard.setLedger(admin, { entityId: "ENT-NOPE", ledger: "xero" }), /no such entity/);
    await wizard.markStep(admin, { step: "ledger" });

    await refused(wizard.addBankAccount(admin, { entityId: "ENT-SG", name: "Operating", currency: "SGD", last4: "123456789", bankName: "Fictional Bank" }), /LAST FOUR/);
    const acct = await wizard.addBankAccount(admin, { entityId: "ENT-SG", name: "Operating", currency: "SGD", last4: "4321", bankName: "Fictional Bank", bic: "FICTSGSGXXX" });
    await wizard.addBankAccount(admin, { entityId: "ENT-SG", name: "USD collections", currency: "USD", last4: "ab12", bankName: "Fictional Bank" });
    expect((await rows(sql`select account_last4, created_by from bank_accounts where id = ${acct.bankAccountId}`))[0]).toEqual({ account_last4: "4321", created_by: admin.userId });
    await wizard.markStep(admin, { step: "bank_accounts" });
    await wizard.markStep(admin, { step: "tolerance" });

    await refused(wizard.linkProvider(admin, { providerSlug: "xb1-merchant-b" }), /no provider has that code/);
    expect(await wizard.linkProvider(admin, { providerSlug: "xb1-provider" })).toEqual({ status: "linked" });
    expect((await rows(sql`select provider_org_id from organizations where id = ${orgs.a}`))[0].provider_org_id).toBe(orgs.prov);
    expect((await rows(sql`select count(*)::int as n from provider_grants where merchant_org_id = ${orgs.a}`))[0].n).toBe(0);
    await wizard.markStep(admin, { step: "provider" });

    const tpl = await wizard.addMappingTemplate(admin, { fileType: "bank_statement", name: "Fictional Bank CSV", headerLine: "Value Date,Description,Amount,Currency,Bank Account,Reference" });
    expect(tpl).toMatchObject({ version: 1 });
    expect((await rows(sql`select created_by, provider_org_id from mapping_templates where id = ${tpl.templateId}`))[0]).toEqual({ created_by: admin.userId, provider_org_id: null });
    await refused(wizard.addMappingTemplate(admin, { fileType: "orders_invoices", name: "Too thin", headerLine: "Colour,Size" }), /not complete/);
    await wizard.markStep(admin, { step: "mapping_templates" });

    const inv = await wizard.inviteMember(admin, { email: "New.Finance@xb1-a.example", role: "finance" });
    const { message, token } = await lastInvite("new.finance@xb1-a.example");
    expect(message.subject).toBe("You are invited to Fictional Merchant A on Clearline");
    expect((await rows(sql`select token_sha256, status, invited_via, invited_by from org_invitations where id = ${inv.invitationId}`))[0])
      .toEqual({ token_sha256: tokenSha256(token), status: "pending", invited_via: "merchant_admin", invited_by: admin.userId });
    expect((await wizard.setupView(admin)).invitations).toMatchObject([{ id: inv.invitationId, email: "new.finance@xb1-a.example", role: "finance", expired: false }]);
    await refused(acceptInvitation({ token, name: "New Finance (fictional)" }), /needs a password/);
    expect(await acceptInvitation({ token, name: "New Finance (fictional)", password: "a-long-fictional-pass-01" })).toEqual({ orgSlug: "xb1-merchant-a", role: "finance", existingUser: false });
    await refused(acceptInvitation({ token, name: "Again", password: "a-long-fictional-pass-01" }), /not valid/);
    const res = await authPOST(new Request(`${ORIGIN}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "198.51.100.201" },
      body: JSON.stringify({ email: "new.finance@xb1-a.example", password: "a-long-fictional-pass-01" }) }));
    expect(res.status).toBe(200);
    expect((await rows(sql`select m.role from organization_memberships m join users u on u.id = m.user_id where u.email = 'new.finance@xb1-a.example' and m.org_id = ${orgs.a}`))).toEqual([{ role: "finance" }]);
    await wizard.markStep(admin, { step: "members" });

    const done = await wizard.setupView(admin);
    expect(Object.keys(done.steps).sort()).toEqual(["bank_accounts", "entities", "ledger", "mapping_templates", "members", "provider", "tolerance"]);
    expect(done.entities.map((e) => [e.id, e.ledger, e.policy?.isDefault])).toEqual([["ENT-AE", "xero", true], ["ENT-SG", "quickbooks", true], ["ENT-US", "none", true]]);
    expect(done.bankAccounts).toHaveLength(2);
    expect(done.providerName).toBe("Fictional Provider (xb1)");

    expect(await wizard.markStep(admin, { step: "finish" })).toMatchObject({ status: "done" });
    expect((await wizard.setupView(admin)).finished).toBe(true);
    // after Finish, every wizard write is refused
    await refused(wizard.addEntity(admin, { entityId: "ENT-LATE", name: "Late (fictional)", currency: "SGD", timezone: "Asia/Singapore" }), /setup is finished/);
    await refused(wizard.inviteMember(admin, { email: "late@xb1-a.example", role: "viewer" }), /setup is finished/);

    // every write is audited with the Admin as actor (the acceptance with the new member as actor)
    const audit = await rows(sql`select action, actor_user_id from audit_events where org_id = ${orgs.a} and summary like '%provisioning role%' order by seq`);
    const actions = audit.map((r) => r.action);
    for (const a of ["merchant_entity_created", "merchant_entity_ledger_set", "bank_account_created", "merchant_provider_linked", "mapping_template_saved", "invitation_created", "invitation_accepted", "setup_step_done", "setup_finished"]) {
      expect(actions, a).toContain(a);
    }
    expect(audit.filter((r) => r.action !== "invitation_accepted").every((r) => r.actor_user_id === admin.userId)).toBe(true);
    expect(audit.filter((r) => r.action === "merchant_entity_created")).toHaveLength(3);
  });

  it("finish needs the entities, ledger and tolerance steps; an Admin of another merchant still sees only its own setup", async () => {
    await refused(wizard.markStep(otherAdmin, { step: "finish" }), /at least one entity/);
    await wizard.addEntity(otherAdmin, { entityId: "ENT-B", name: "Fictional Merchant B FZ (fictional)", currency: "AED", timezone: "Asia/Dubai" });
    await refused(wizard.markStep(otherAdmin, { step: "finish" }), /confirm the entities, ledger and tolerance/);
    const v = await wizard.setupView(otherAdmin);
    expect(v.entities.map((e) => e.id)).toEqual(["ENT-B"]);
    expect(v.finished).toBe(false);
    expect(v.invitations).toEqual([]);
  });

  it("an invitation is rolled back when the email sender refuses it (no invitation nobody was told about)", async () => {
    setEmailSenderForTests({ send: async () => { throw new Error("fictional sender outage"); } });
    await refused(wizard.inviteMember(otherAdmin, { email: "nobody@xb1-b.example", role: "viewer" }), /fictional sender outage/);
    expect((await rows(sql`select count(*)::int as n from org_invitations where email = 'nobody@xb1-b.example'`))[0].n).toBe(0);
    expect((await rows(sql`select count(*)::int as n from audit_events where org_id = ${orgs.b} and action = 'invitation_created'`))[0].n).toBe(0);
  });

  it("re-inviting replaces the pending invitation; a revoked or expired token is refused; an existing account joins with its own password", async () => {
    await wizard.inviteMember(otherAdmin, { email: "twice@xb1-b.example", role: "viewer" });
    const first = await lastInvite("twice@xb1-b.example");
    const second = await wizard.inviteMember(otherAdmin, { email: "twice@xb1-b.example", role: "approver" });
    await refused(acceptInvitation({ token: first.token, name: "Twice", password: "a-long-fictional-pass-02" }), /not valid/);
    await wizard.revokeInvitation(otherAdmin, { invitationId: second.invitationId });
    await refused(acceptInvitation({ token: (await lastInvite("twice@xb1-b.example")).token, name: "Twice", password: "a-long-fictional-pass-02" }), /not valid/);
    await refused(wizard.revokeInvitation(admin, { invitationId: second.invitationId }), /setup is finished|no pending invitation/);

    // expired: an invitation written by the owner with a past expiry
    await ownerDb().execute(sql`insert into org_invitations (org_id, email, role, token_sha256, invited_via, created_at, expires_at)
      values (${orgs.b}, 'late@xb1-b.example', 'viewer', ${tokenSha256("E".repeat(43))}, 'cli', now() - interval '4 days', now() - interval '1 day')`);
    await refused(acceptInvitation({ token: "E".repeat(43), name: "Late", password: "a-long-fictional-pass-03" }), /expired/);

    // an existing account (Admin of A) invited to B keeps its password: nothing about the account changes
    const pwBefore = (await rows(sql`select password from accounts where user_id = ${admin.userId}`))[0].password;
    await wizard.inviteMember(otherAdmin, { email: "admin@xb1-a.example", role: "viewer" });
    expect(await acceptInvitation({ token: (await lastInvite("admin@xb1-a.example")).token, password: "ignored-for-existing-1" })).toEqual({ orgSlug: "xb1-merchant-b", role: "viewer", existingUser: true });
    expect((await rows(sql`select password from accounts where user_id = ${admin.userId}`))[0].password).toBe(pwBefore);
    // already a member: a new invitation is refused
    await refused(wizard.inviteMember(otherAdmin, { email: "admin@xb1-a.example", role: "finance" }), /already a member/);
  });
});

describe("the platform console (platform operators, CLEARLINE_PLATFORM_CONSOLE=1)", () => {
  const op = () => ({ userId: ids.operator, name: "Operator", email: "operator@platform.example" });

  it("is not found unless the flag is on AND the user is a platform operator", async () => {
    await refused(requirePlatformOperator(op()), /Not found/);
    process.env.CLEARLINE_PLATFORM_CONSOLE = "1";
    await refused(requirePlatformOperator(op()), /Not found/);
    await refused(platformOrgs({ userId: admin.userId, name: "a", email: "a" }), /Not found/);
    expect(await grantPlatformOperator(ownerDb(), "operator@platform.example")).toMatchObject({ status: "granted" });
    expect(await grantPlatformOperator(ownerDb(), "operator@platform.example")).toMatchObject({ status: "exists" });
    await expect(requirePlatformOperator(op())).resolves.toMatchObject({ userId: ids.operator });
    delete process.env.CLEARLINE_PLATFORM_CONSOLE;
    await refused(requirePlatformOperator(op()), /Not found/);
  });

  it("creates an empty live merchant under a provider and invites its first admin, who accepts and is its Admin", async () => {
    process.env.CLEARLINE_PLATFORM_CONSOLE = "1";
    const r = await createOrganizationAndInvite(op(), { kind: "merchant", slug: "xb1-merchant-c", name: "Fictional Merchant C", timezone: "Asia/Singapore", providerSlug: "xb1-provider", adminEmail: "first@xb1-c.example" });
    expect((await rows(sql`select kind, data_mode, fictional, provider_org_id from organizations where id = ${r.orgId}`))[0]).toEqual({ kind: "merchant", data_mode: "live", fictional: false, provider_org_id: orgs.prov });
    expect((await rows(sql`select version::int as version from org_engine_state where org_id = ${r.orgId}`))[0]).toEqual({ version: 1 });
    await refused(createOrganizationAndInvite(op(), { kind: "merchant", slug: "xb1-merchant-c", name: "Again", timezone: "UTC", adminEmail: "x@xb1-c.example" }), /already used/);
    await refused(createOrganizationAndInvite(op(), { kind: "provider", slug: "xb1-provider-2", name: "P", timezone: "UTC", providerSlug: "xb1-provider", adminEmail: "x@xb1-p.example" }), /only a merchant is served/);
    const listed = (await platformOrgs(op())).find((o) => o.id === r.orgId);
    expect(listed).toMatchObject({ slug: "xb1-merchant-c", kind: "merchant", admins: 0, pendingInvitations: 1, setupFinished: false });

    const { token } = await lastInvite("first@xb1-c.example");
    expect(await acceptInvitation({ token, name: "First Admin C (fictional)", password: "a-long-fictional-pass-04" })).toEqual({ orgSlug: "xb1-merchant-c", role: "admin", existingUser: false });
    await refused(reinviteFirstAdmin(op(), { orgId: r.orgId, adminEmail: "second@xb1-c.example" }), /already has an admin/);
    expect(await rows(sql`select action, actor_user_id = ${ids.operator} as by_operator from audit_events where org_id = ${r.orgId} order by seq`))
      .toEqual([{ action: "organization_created", by_operator: true }, { action: "invitation_created", by_operator: true }, { action: "invitation_accepted", by_operator: false }]);
  });

  it("a provider's first admin is a Provider Admin; revoking the operator closes the console and signs them out", async () => {
    process.env.CLEARLINE_PLATFORM_CONSOLE = "1";
    const r = await createOrganizationAndInvite(op(), { kind: "provider", slug: "xb1-provider-3", name: "Fictional Provider 3", timezone: "UTC", adminEmail: "first@xb1-p3.example" });
    expect(await acceptInvitation({ token: (await lastInvite("first@xb1-p3.example")).token, name: "P3 Admin (fictional)", password: "a-long-fictional-pass-05" })).toMatchObject({ role: "provider_admin" });
    expect(r.kind).toBe("provider");
    expect(await revokePlatformOperator(ownerDb(), "operator@platform.example")).toMatchObject({ status: "revoked" });
    await refused(requirePlatformOperator(op()), /Not found/);
  });
});

describe("the operator's CLI path (schema owner)", () => {
  it("invite-admin invites an organisation's first admin through the email sender, and is refused once it has one", async () => {
    const d = await createMerchant(ownerDb(), { slug: "xb1-merchant-d", name: "Fictional Merchant D", timezone: "UTC" });
    const r = await inviteFirstAdmin(ownerDb(), { orgSlug: "xb1-merchant-d", email: "first@xb1-d.example" });
    expect(r).toMatchObject({ status: "invited", role: "admin", orgId: d.orgId });
    expect(await acceptInvitation({ token: (await lastInvite("first@xb1-d.example")).token, name: "D Admin (fictional)", password: "a-long-fictional-pass-06" })).toMatchObject({ role: "admin" });
    await refused(inviteFirstAdmin(ownerDb(), { orgSlug: "xb1-merchant-d", email: "again@xb1-d.example" }), /already has an admin/);
    await refused(inviteFirstAdmin(ownerDb(), { orgSlug: "xb1-merchant-d", email: "not-an-email" }), /not an email/);
  });
});

describe("invite-only: there is no public sign-up", () => {
  it("every sign-up path is refused before Better Auth, on every method and spelling, and creates nobody", async () => {
    const body = JSON.stringify({ email: "walk-in@xb1.example", password: "a-long-fictional-pass-07", name: "Walk-in" });
    const post = (p: string) => authPOST(new Request(`${ORIGIN}${p}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body }));
    for (const p of ["/api/auth/sign-up/email", "/api/auth/sign-up", "/api/auth/Sign-Up/email", "/api/auth/sign-up%2Femail", "/api/auth/signup/email"]) {
      const res = await post(p);
      expect(res.status, p).toBe(404);
    }
    // a foreign origin gets the same answer (refused before the CSRF check, so nothing about the route is disclosed)
    const foreign = await authPOST(new Request(`${ORIGIN}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body }));
    expect(foreign.status).toBe(404);
    expect((await authGET(new Request(`${ORIGIN}/api/auth/sign-up/email`))).status).toBe(404);
    expect((await rows(sql`select count(*)::int as n from users where email = 'walk-in@xb1.example'`))[0].n).toBe(0);
    // and the library itself has sign-up disabled (the second layer): no source calls its sign-up API
    const src = readFileSync(path.join(__dirname, "../../src/server/auth.ts"), "utf8");
    expect(src).toMatch(/disableSignUp: true/);
  });
});
