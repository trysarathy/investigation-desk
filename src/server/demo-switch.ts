import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { auth, SESSION_SECONDS } from "./auth";
import { database } from "./db/client";
import * as t from "./db/schema";
import { demoBuild } from "./demo-build";
import { membershipsFor, withTenant, type Principal } from "./tenant";
import { ROLE_LABELS, isAppRole } from "./authz";
import { stampAt } from "./live-clock";

/**
 * Demo build only: the demo role switcher (POST /api/control/demo/switch; the route answers 404 in any other build
 * before this module is loaded, and the bundler drops it: scripts/build/check-chain-recording.mjs --marker demo).
 *
 * Switching SIGNS IN as the seeded demo user: it creates a real Better Auth session row for that user, exactly as a
 * password sign-in does, and ends the caller's session. Nothing is impersonated: there is no "acting as" flag, so
 * every later request is that user's own session, every action is recorded as that user, and every rule (the
 * second-person rule, the Approver-only decisions, the bank-statement confirmation) applies unchanged. Self-approval
 * through the switcher is refused by the same server and database checks as any other self-approval.
 *
 * Who may switch, and to whom (all checked on the server, from the session):
 *   - the caller is signed in, and EVERY organisation they belong to has data mode 'demo' (set only by the schema
 *     owner, migration 0031); a member of a live or sample organisation gets 404;
 *   - the target is an existing user other than the caller, with at least one active membership, and every one of
 *     their organisations is a demo organisation too; anyone else is 404 (never disclosed).
 * Each switch is written to the audit history of the organisations involved.
 */
export const DEMO_SWITCH_MARKER = "clearline-demo[demo-build-only]";
/** The role switcher's own marker (scripts/build/check-chain-recording.mjs --marker switcher). */
export const DEMO_SWITCHER_MARKER = "clearline-demo-switcher[demo-build-only]";
/** The switcher's MFA proof (scripts/build/check-chain-recording.mjs --marker mfa): never in a real build. */
export const DEMO_MFA_PROOF_MARKER = "clearline-demo-mfa-proof[demo-build-only]";

export class DemoSwitchRefused extends Error {
  readonly marker = DEMO_SWITCHER_MARKER;
  constructor(readonly status: 400 | 401 | 404, readonly code: string, message: string) { super(message); }
}
const notFound = () => new DemoSwitchRefused(404, "NOT_FOUND", "Not found.");

/** The seeded demo logins offered by the switcher (fictional; src/server/demo-seed.ts DEMO_USERS). */
export const DEMO_SWITCH_USERS = [
  { email: "finance@northwind.demo", label: "Finance", note: "uploads, reconciles, prepares write-offs and resolutions" },
  { email: "approver@northwind.demo", label: "Approver", note: "approves what someone else prepared" },
  { email: "viewer@northwind.demo", label: "Viewer", note: "read only" },
  { email: "admin@northwind.demo", label: "Admin", note: "settings and members" },
  { email: "ops@providerp.demo", label: "Provider ops", note: "Provider P (demo) console, aggregates only" },
] as const;

async function allDemo(userId: string): Promise<{ ok: boolean; memberships: Awaited<ReturnType<typeof membershipsFor>> }> {
  const ms = await membershipsFor({ userId, name: "", email: "" });
  if (ms.length === 0) return { ok: false, memberships: ms };
  const modes = await withTenant({ userId }, (tx) => tx.select({ id: t.organizations.id, dataMode: t.organizations.dataMode }).from(t.organizations).where(inArray(t.organizations.id, ms.map((m) => m.orgId))), { read: true });
  return { ok: modes.length === ms.length && modes.every((o) => o.dataMode === "demo"), memberships: ms };
}

/** Whether this signed-in user may see and use the switcher (demo build, and only demo organisations). */
export async function demoSwitchAllowed(p: Principal): Promise<boolean> {
  if (!demoBuild()) return false;
  return (await allDemo(p.userId)).ok;
}

export interface DemoSwitchResult {
  userId: string; name: string; email: string; role: string;
  /** The new session's token (the cookie value before signing). */
  token: string;
  /** Where the new user lands. */
  next: string;
}

/** Sign out `caller` (their session `callerSessionId`) and sign in as `targetEmail`. */
export async function switchDemoUser(caller: Principal, callerSessionId: string, targetEmail: unknown): Promise<DemoSwitchResult> {
  if (!demoBuild()) throw notFound();
  if (typeof targetEmail !== "string" || targetEmail.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(targetEmail)) throw new DemoSwitchRefused(400, "INVALID_REQUEST", "Choose one of the demo logins.");
  const email = targetEmail.trim().toLowerCase();
  if (!(await allDemo(caller.userId)).ok) throw notFound();
  if (email === caller.email.toLowerCase()) throw new DemoSwitchRefused(400, "ALREADY_SIGNED_IN", `You are already signed in as ${caller.email}.`);
  const [target] = await database().select({ id: t.users.id, name: t.users.name, email: t.users.email }).from(t.users).where(eq(t.users.email, email));
  if (!target) throw notFound();
  const tgt = await allDemo(target.id);
  if (!tgt.ok) throw notFound();
  const role = tgt.memberships[0].role;
  if (!isAppRole(role)) throw notFound();

  const ac = await auth().$context;
  const session = await ac.internalAdapter.createSession(target.id);
  if (!session?.token) throw new Error("demo switch: no session was created");
  const mfaProved = await demoSwitchMfaProof(session.id, target.id);
  await database().delete(t.sessions).where(and(eq(t.sessions.id, callerSessionId), eq(t.sessions.userId, caller.userId)));

  const callerOrgs = (await membershipsFor(caller)).map((m) => m.orgId);
  const summary = `Demo switcher: ${caller.email} signed out and signed in as ${target.email} (${ROLE_LABELS[role]})`;
  const at = new Date();
  for (const orgId of new Set([...callerOrgs, ...tgt.memberships.map((m) => m.orgId)])) {
    const actor = callerOrgs.includes(orgId) ? caller.userId : target.id;
    await withTenant({ userId: actor, orgId }, (tx) => tx.insert(t.auditEvents).values({ orgId, source: "auth", actorUserId: actor, action: "demo_user_switched", entityType: "user", entityId: target.id, summary, at: stampAt(at), details: { marker: DEMO_SWITCH_MARKER, from: caller.email, to: target.email, ...(mfaProved ? { mfa: DEMO_MFA_PROOF_MARKER } : {}) } }));
  }
  const provider = role === "provider_admin" || role === "provider_ops";
  return { userId: target.id, name: target.name, email: target.email, role, token: session.token, next: provider ? "/control/merchant/provider" : "/control/merchant" };
}

/**
 * v1 wave 1 (demo build ONLY, option (a)): the demo seed enrols the demo Admin and Approver with a fictional TOTP secret
 * (printed by `npm run demo`; `npm run demo:totp` prints a current code), so the MFA gate applies to them unchanged. A
 * switch is a sign-in the presenter already proved with the demo password and, for those roles, the demo authenticator
 * would answer the same; so the session the switcher creates for an ENROLLED target counts as MFA-proved, exactly as a
 * session created by a second-factor check does (src/server/auth.ts). Refused outside a demo build, for a target outside
 * demo organisations, and for a target without MFA (who still meets the enrolment wall). Returns whether it stamped.
 */
export async function demoSwitchMfaProof(sessionId: string, targetUserId: string): Promise<boolean> {
  if (!demoBuild()) throw notFound();
  if (!(await allDemo(targetUserId)).ok) throw notFound();
  const [u] = await database().select({ mfa: t.users.twoFactorEnabled }).from(t.users).where(eq(t.users.id, targetUserId));
  if (!u?.mfa) return false;
  const now = new Date();
  await database().update(t.sessions).set({ mfaVerifiedAt: now, reauthenticatedAt: now }).where(and(eq(t.sessions.id, sessionId), eq(t.sessions.userId, targetUserId)));
  return true;
}

/** The Set-Cookie header for a session token, signed exactly as Better Auth signs its session cookie. */
export async function sessionCookie(token: string): Promise<string> {
  const ac = await auth().$context;
  const c = ac.authCookies.sessionToken;
  const sig = createHmac("sha256", ac.secret).update(token).digest("base64");
  const o = c.attributes as { path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string | boolean };
  const same = typeof o.sameSite === "string" ? o.sameSite.charAt(0).toUpperCase() + o.sameSite.slice(1) : "Strict";
  return [`${c.name}=${encodeURIComponent(`${token}.${sig}`)}`, `Max-Age=${SESSION_SECONDS}`, `Path=${o.path ?? "/"}`, o.httpOnly === false ? "" : "HttpOnly", o.secure ? "Secure" : "", `SameSite=${same}`].filter(Boolean).join("; ");
}

/** The member list shown in the switcher (only the seeded demo logins that exist). */
export async function demoSwitchUsers(): Promise<{ email: string; label: string; note: string }[]> {
  const rows = await database().select({ email: t.users.email }).from(t.users).where(inArray(t.users.email, DEMO_SWITCH_USERS.map((u) => u.email)));
  const have = new Set(rows.map((r) => r.email));
  return DEMO_SWITCH_USERS.filter((u) => have.has(u.email)).map((u) => ({ ...u }));
}

