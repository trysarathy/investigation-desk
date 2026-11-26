/**
 * Overnight (invite links, drizzle/0088) against PostgreSQL 16: with NO email provider, an invitation is delivered as
 * a one-time link returned once to the inviter (platform console, setup wizard, the Admin's members page); the email
 * path is unchanged when a sender exists. The merchant Admin's members page invites, revokes and deactivates through
 * the provisioning role: only an unscoped Admin, never yourself, never the last Admin, never another organisation.
 * Fictional organisations and people only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetBlank } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { closeProvisioningDatabase, withProvisioning } from "../../src/server/db/provisioning";
import { readOutbox } from "../support/email-outbox";
import { createUser, grantMembership } from "../../src/server/admin";
import { createMerchant } from "../../src/server/merchant-setup";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { acceptInvitation, INVITATION_HOURS, tokenSha256 } from "../../src/server/onboarding/invitations";
import { createOrganizationAndInvite } from "../../src/server/onboarding/platform";
import { grantPlatformOperator } from "../../src/server/onboarding/operator";
import { deactivateMember, inviteMemberByLink, membersView, revokeMemberInvitation } from "../../src/server/onboarding/members";
import * as wizard from "../../src/server/onboarding/wizard";
import { assertMfaGate } from "../../src/server/mfa-gate";

if (!process.env.CLEARLINE_TEST_PROVISIONING_URL) throw new Error("BLOCKED: set CLEARLINE_TEST_PROVISIONING_URL (clearline_provisioning; scripts/db/setup-local.sh with a 5th password)");
process.env.DATABASE_PROVISIONING_URL = process.env.CLEARLINE_TEST_PROVISIONING_URL;
process.env.CLEARLINE_EMAIL_SENDER = "outbox";
const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const OWNER_URL = process.env.CLEARLINE_TEST_OWNER_URL!;
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function refused(p: Promise<unknown>, re: RegExp, what?: string) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`, what).toMatch(new RegExp(re.source, "i")); return e; }
  throw new Error(`expected a refusal ${re}${what ? ` (${what})` : ""}`);
}
const tokenOf = (link: string) => /#token=([A-Za-z0-9_-]{43})$/.exec(link)?.[1] ?? "";
type LinkResult = { delivery: string; link?: string; expiresAt?: string; invitationId: string };
const linkOf = (r: LinkResult) => { expect(r.delivery).toBe("link"); return r.link!; };

const ids: Record<string, string> = {};
const orgs: Record<string, string> = {};
const c: Record<string, TenantContext> = {};
const noSender = () => { delete process.env.CLEARLINE_EMAIL_SENDER; };

beforeAll(async () => {
  await resetBlank();
  const db = ownerDb();
  orgs.a = (await createMerchant(db, { slug: "xi-merchant-a", name: "Fictional Merchant XI-A", timezone: "Asia/Singapore" })).orgId;
  orgs.b = (await createMerchant(db, { slug: "xi-merchant-b", name: "Fictional Merchant XI-B", timezone: "Asia/Dubai" })).orgId;
  await db.execute(sql`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values (${orgs.a}, 'ENT-XI-1', 'Fictional Entity XI', 'SGD', 'none', 'Asia/Singapore')`);
  for (const [key, email, slug, role] of [["admin", "admin@xi-a.example", "xi-merchant-a", "admin"], ["admin2", "admin2@xi-a.example", "xi-merchant-a", "admin"],
    ["finance", "finance@xi-a.example", "xi-merchant-a", "finance"], ["approver", "approver@xi-a.example", "xi-merchant-a", "approver"],
    ["scoped", "scoped-admin@xi-a.example", "xi-merchant-a", "admin"], ["adminB", "admin@xi-b.example", "xi-merchant-b", "admin"]] as const) {
    ids[key] = await createUser(db, { email, name: `${key} (fictional)`, password: PASSWORD });
    await grantMembership(db, { orgSlug: slug, email, role, ...(key === "scoped" ? { entities: ["ENT-XI-1"] } : {}) });
    c[key] = await resolveTenant({ userId: ids[key], name: key, email }, slug);
  }
  ids.operator = await createUser(db, { email: "operator@xi-platform.example", name: "Operator (fictional)", password: PASSWORD });
}, 120_000);
afterEach(() => { process.env.CLEARLINE_EMAIL_SENDER = "outbox"; delete process.env.CLEARLINE_PLATFORM_CONSOLE; vi.restoreAllMocks(); });
afterAll(async () => { await closeProvisioningDatabase(); await closeDatabase(); await closeOwner(); });

describe("no email provider: the one-time link is returned to the inviter, once", () => {
  it("an Admin invites by link: absolute link from CLEARLINE_ORIGIN, 72 h, only its SHA-256 stored, never logged, single use", async () => {
    noSender();
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    const before = Date.now();
    const r = await inviteMemberByLink(c.admin, { email: "new-finance@xi-a.example", role: "finance" }) as LinkResult;
    const link = linkOf(r);
    expect(link.startsWith(`${ORIGIN}/control/invite#token=`)).toBe(true);
    const token = tokenOf(link);
    expect(token).toHaveLength(43);
    const exp = new Date(r.expiresAt!).getTime();
    expect(exp - before).toBeGreaterThanOrEqual(INVITATION_HOURS * 3600_000 - 1000);
    expect(exp - Date.now()).toBeLessThanOrEqual(INVITATION_HOURS * 3600_000 + 1000);
    expect(INVITATION_HOURS).toBe(72);
    // stored: the hash only; the token is nowhere in the database (invitation, audit, outbox) or in any log line
    expect(await rows(sql`select token_sha256, invited_via, invited_by from org_invitations where id = ${r.invitationId}`)).toEqual([{ token_sha256: tokenSha256(token), invited_via: "merchant_admin", invited_by: ids.admin }]);
    expect((await rows(sql`select count(*)::int as n from audit_events where summary like ${`%${token}%`} or details::text like ${`%${token}%`}`))[0].n).toBe(0);
    expect(await readOutbox(OWNER_URL, "new-finance@xi-a.example")).toEqual([]);
    for (const l of logs) for (const call of l.mock.calls) expect(JSON.stringify(call)).not.toContain(token);
    expect((await rows(sql`select actor_user_id from audit_events where action = 'invitation_created' and entity_id = ${r.invitationId}`))).toEqual([{ actor_user_id: ids.admin }]);

    // shown once: the members page lists the pending invitation but never a link or token
    const view = await membersView(c.admin);
    expect(view.invitations!.map((x) => x.email)).toContain("new-finance@xi-a.example");
    expect(JSON.stringify(view)).not.toContain(token);

    expect(await acceptInvitation({ token, name: "New Finance (fictional)", password: "a-long-fictional-pass-11" })).toEqual({ orgSlug: "xi-merchant-a", role: "finance", existingUser: false });
    await refused(acceptInvitation({ token, name: "Again", password: "a-long-fictional-pass-12" }), /not valid/, "a used link");
    const m = (await membersView(c.admin)).members.find((x) => x.email === "new-finance@xi-a.example");
    expect(m).toMatchObject({ role: "finance", status: "active", mfa: "not_enabled", lastSignInAt: null });
  });

  it("an expired link is refused; a replaced or revoked link stops working", async () => {
    noSender();
    const late = await inviteMemberByLink(c.admin, { email: "late@xi-a.example", role: "viewer" }) as LinkResult;
    // the owner moves this invitation into the past (its expiry is otherwise immutable)
    await ownerDb().execute(sql`alter table org_invitations disable trigger org_invitations_keep`);
    try {
      await ownerDb().execute(sql`update org_invitations set created_at = now() - interval '4 days', expires_at = now() - interval '1 day' where id = ${late.invitationId}`);
    } finally { await ownerDb().execute(sql`alter table org_invitations enable trigger org_invitations_keep`); }
    await refused(acceptInvitation({ token: tokenOf(late.link!), name: "Late", password: "a-long-fictional-pass-13" }), /expired/);

    const first = await inviteMemberByLink(c.admin, { email: "twice@xi-a.example", role: "viewer" }) as LinkResult;
    const second = await inviteMemberByLink(c.admin, { email: "twice@xi-a.example", role: "approver" }) as LinkResult;
    expect(tokenOf(second.link!)).not.toBe(tokenOf(first.link!));
    await refused(acceptInvitation({ token: tokenOf(first.link!), name: "Twice", password: "a-long-fictional-pass-14" }), /not valid/, "replaced");
    expect(await revokeMemberInvitation(c.admin, { invitationId: second.invitationId })).toMatchObject({ status: "revoked" });
    await refused(acceptInvitation({ token: tokenOf(second.link!), name: "Twice", password: "a-long-fictional-pass-14" }), /not valid/, "revoked");
    expect((await rows(sql`select actor_user_id from audit_events where action = 'invitation_revoked' and entity_id = ${second.invitationId}`))).toEqual([{ actor_user_id: ids.admin }]);
  });

  it("the platform console gives the operator the first Admin's link; accepted, the Admin (and an Approver) must enrol MFA first", async () => {
    noSender();
    process.env.CLEARLINE_PLATFORM_CONSOLE = "1";
    await grantPlatformOperator(ownerDb(), "operator@xi-platform.example");
    const op = { userId: ids.operator, name: "Operator", email: "operator@xi-platform.example" };
    const r = await createOrganizationAndInvite(op, { kind: "merchant", slug: "xi-merchant-c", name: "Fictional Merchant XI-C", timezone: "Asia/Singapore", adminEmail: "first@xi-c.example" }) as LinkResult & { orgId: string };
    const link = linkOf(r);
    expect(new Date(r.expiresAt!).getTime() - Date.now()).toBeGreaterThan(71.9 * 3600_000);
    expect(await acceptInvitation({ token: tokenOf(link), name: "First Admin XI-C (fictional)", password: "a-long-fictional-pass-15" })).toEqual({ orgSlug: "xi-merchant-c", role: "admin", existingUser: false });
    const uid = String((await rows(sql`select id from users where email = 'first@xi-c.example'`))[0].id);
    const first = await resolveTenant({ userId: uid, name: "First", email: "first@xi-c.example" }, "xi-merchant-c");
    const session = (u: string) => ({ principal: { userId: u, name: "x", email: "x" }, sessionId: "s", createdAt: new Date(), mfaEnrolled: false, mfaVerifiedAt: null, reauthenticatedAt: null });
    await refused(assertMfaGate(session(uid), first), /requires multi-factor/);

    // the new Admin invites an Approver by link during setup (the wizard), who is held at MFA enrolment too
    const ap = await wizard.inviteMember(first, { email: "approver@xi-c.example", role: "approver" }) as LinkResult;
    await acceptInvitation({ token: tokenOf(linkOf(ap)), name: "Approver XI-C (fictional)", password: "a-long-fictional-pass-16" });
    const apId = String((await rows(sql`select id from users where email = 'approver@xi-c.example'`))[0].id);
    await refused(assertMfaGate(session(apId), await resolveTenant({ userId: apId, name: "A", email: "approver@xi-c.example" }, "xi-merchant-c")), /requires multi-factor/);
  });

  it("with an email sender configured, the email path is unchanged and no link is returned", async () => {
    const r = await inviteMemberByLink(c.admin, { email: "by-email@xi-a.example", role: "viewer" }) as LinkResult;
    expect(r.delivery).toBe("email");
    expect(r).not.toHaveProperty("link");
    const mail = await readOutbox(OWNER_URL, "by-email@xi-a.example");
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain(`${ORIGIN}/control/invite#token=`);
  });
});

describe("only an unscoped Admin manages members", () => {
  it("a Finance member, an Approver and a scoped Admin cannot invite, revoke or deactivate (service and database)", async () => {
    noSender();
    for (const k of ["finance", "approver"] as const) {
      await refused(inviteMemberByLink(c[k], { email: "x@xi-a.example", role: "viewer" }), /Only an Admin/, k);
      await refused(deactivateMember(c[k], { userId: ids.admin2 }), /Only an Admin/, k);
      await refused(membersView(c[k]), /Only an Admin/, k);
      await refused(withProvisioning({ userId: ids[k], orgId: orgs.a }, (tx) => tx.call("prov_member_invite", ["x@xi-a.example", "viewer", "a".repeat(64), new Date(Date.now() + 3600_000)])), /only an Admin/, k);
      await refused(withProvisioning({ userId: ids[k], orgId: orgs.a }, (tx) => tx.call("prov_member_deactivate", [ids.admin2])), /only an Admin/, k);
    }
    await refused(inviteMemberByLink(c.scoped, { email: "x@xi-a.example", role: "viewer" }), /limited to some entities/);
    await refused(deactivateMember(c.scoped, { userId: ids.finance }), /limited to some entities/);
    await refused(withProvisioning({ userId: ids.scoped, orgId: orgs.a }, (tx) => tx.call("prov_member_invite", ["x@xi-a.example", "viewer", "b".repeat(64), new Date(Date.now() + 3600_000)])), /limited to some entities/);
    await refused(withProvisioning({ userId: ids.scoped, orgId: orgs.a }, (tx) => tx.call("prov_member_deactivate", [ids.finance])), /limited to some entities/);
    // a role outside the merchant roles is refused
    await refused(inviteMemberByLink(c.admin, { email: "x@xi-a.example", role: "provider_admin" as never }), /Invalid|invalid/);
    expect((await rows(sql`select count(*)::int as n from org_invitations where email = 'x@xi-a.example'`))[0].n).toBe(0);
    expect((await rows(sql`select count(*)::int as n from organization_memberships where org_id = ${orgs.a} and revoked_at is not null`))[0].n).toBe(0);
  });
});

describe("deactivating a member", () => {
  it("revokes the membership, ends their sessions, is audited; not yourself; not twice", async () => {
    await ownerDb().execute(sql`insert into sessions (id, expires_at, token, user_id) values ('xi-session-1', now() + interval '1 hour', 'xi-session-token-1', ${ids.approver})`);
    expect(await deactivateMember(c.admin, { userId: ids.approver })).toEqual({ status: "deactivated", userId: ids.approver, sessionsRevoked: 1 });
    expect((await rows(sql`select revoked_at is not null as gone from organization_memberships where org_id = ${orgs.a} and user_id = ${ids.approver}`))[0].gone).toBe(true);
    expect((await rows(sql`select count(*)::int as n from sessions where user_id = ${ids.approver}`))[0].n).toBe(0);
    expect(await rows(sql`select actor_user_id, details->>'role' as role from audit_events where action = 'member_deactivated' and entity_id = ${ids.approver}`)).toEqual([{ actor_user_id: ids.admin, role: "approver" }]);
    await refused(resolveTenant({ userId: ids.approver, name: "a", email: "approver@xi-a.example" }, "xi-merchant-a"), /./, "no access any more");
    expect((await membersView(c.admin)).members.find((m) => m.userId === ids.approver)).toMatchObject({ status: "revoked" });
    await refused(deactivateMember(c.admin, { userId: ids.approver }), /no active member/);

    await refused(deactivateMember(c.admin, { userId: ids.admin }), /cannot deactivate yourself/);
    await refused(withProvisioning({ userId: ids.admin, orgId: orgs.a }, (tx) => tx.call("prov_member_deactivate", [ids.admin])), /cannot deactivate yourself/);
  });

  it("never the last Admin: once one unscoped Admin is left, nobody can remove them", async () => {
    // admin2 removes the scoped Admin and then admin; admin2 is the last unscoped Admin and cannot remove themselves
    await deactivateMember(c.admin2, { userId: ids.scoped });
    await deactivateMember(c.admin2, { userId: ids.admin });
    await refused(deactivateMember(c.admin2, { userId: ids.admin2 }), /cannot deactivate yourself/);
    await refused(withProvisioning({ userId: ids.admin2, orgId: orgs.a }, (tx) => tx.call("prov_member_deactivate", [ids.admin2])), /cannot deactivate yourself/);
    // the deactivated Admin cannot act any more, in the database either
    await refused(withProvisioning({ userId: ids.admin, orgId: orgs.a }, (tx) => tx.call("prov_member_deactivate", [ids.admin2])), /only an Admin/);
    expect((await rows(sql`select count(*)::int as n from organization_memberships where org_id = ${orgs.a} and role = 'admin' and revoked_at is null`))[0].n).toBe(1);
  });
});

describe("organisations stay apart", () => {
  it("org B's Admin neither sees nor affects org A's members or invitations", async () => {
    noSender();
    const a = await inviteMemberByLink(c.admin2, { email: "pending@xi-a.example", role: "viewer" }) as LinkResult;
    const vb = await membersView(c.adminB);
    expect(vb.members.map((m) => m.userId)).toEqual([ids.adminB]);
    expect(vb.invitations).toEqual([]);
    await refused(deactivateMember(c.adminB, { userId: ids.finance }), /no active member/);
    await refused(revokeMemberInvitation(c.adminB, { invitationId: a.invitationId }), /no pending invitation/);
    // B's Admin pointing the transaction at A (where they are no member) is refused by the database
    await refused(withProvisioning({ userId: ids.adminB, orgId: orgs.a }, (tx) => tx.call("prov_member_deactivate", [ids.finance])), /only an Admin/);
    await refused(withProvisioning({ userId: ids.adminB, orgId: orgs.a }, (tx) => tx.call("prov_member_invite", ["y@xi-a.example", "admin", "c".repeat(64), new Date(Date.now() + 3600_000)])), /only an Admin/);
    expect((await rows(sql`select revoked_at is null as active from organization_memberships where org_id = ${orgs.a} and user_id = ${ids.finance}`))[0].active).toBe(true);
    expect((await rows(sql`select status from org_invitations where id = ${a.invitationId}`))[0].status).toBe("pending");
  });
});
