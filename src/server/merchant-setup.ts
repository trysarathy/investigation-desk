import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import * as t from "./db/schema";
import { createOrganization, createUser, grantMembership } from "./admin";
import { PolicyPatch } from "./merchant";
import { defaultPolicyFor } from "@/lib/clearline/merchant/config";
import type { FiatCurrency } from "@/lib/clearline/merchant/types";
import { normaliseLast4 } from "@/lib/clearline/bank-accounts";

/**
 * rc8 founder decision 4: an operator creates a merchant from scratch with the admin CLI (no wizard):
 * `npm run control:admin -- create-merchant | create-provider | add-entity | add-bank-account | close-bank-account | set-policy |
 * link-provider | add-member`.
 *
 * - The schema OWNER login only (DATABASE_OWNER_URL), checked on connect: the login must own the tables and must not
 *   be a member of clearline_app. The runtime app's grants and row-level security are unchanged; the web app still
 *   cannot create organisations, entities or policies for itself.
 * - Idempotent: re-running a command with the same values changes nothing ("exists"/"unchanged"); a slug or entity id
 *   already used with different values is refused, never silently changed.
 * - Overwriting (a policy change, a provider relink, a member's role change) is a dry run unless `--confirm <org-slug>`
 *   repeats the organisation's slug, like delete-merchant.
 * - Output and audit rows hold ids, roles and counts only: never an email, a name, a password or file contents.
 * - Read-only on funds: nothing here moves money, and the policy is validated exactly as the Settings page validates it.
 */

export class SetupRefused extends Error {}

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "a slug is 2–63 lower-case letters, digits or dashes");
const Name = z.string().trim().min(1).max(200);
const EntityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "an entity id is 1–64 letters, digits, dashes or underscores");
const Currency = z.enum(["SGD", "USD", "AED"]);
const Ledger = z.enum(["xero", "quickbooks", "none"]);
const Email = z.string().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "not an email address");
export const MERCHANT_MEMBER_ROLES = ["admin", "payment_ops", "finance", "approver", "viewer"] as const;
export const PROVIDER_MEMBER_ROLES = ["provider_admin", "provider_ops"] as const;

function parse<T>(s: z.ZodType<T>, v: unknown, what: string): T {
  const r = s.safeParse(v);
  if (!r.success) throw new SetupRefused(`${what}: ${r.error.issues[0]?.message ?? "invalid"}`);
  return r.data;
}
export function validTimeZone(tz: string): string {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { throw new SetupRefused("timezone: not an IANA time zone (e.g. Asia/Singapore)"); }
  return tz;
}
/** "+08:00", "-05:30", "480" (minutes) or "UTC". Whole quarter hours between -12:00 and +14:00. */
export function parseUtcOffset(v: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(v);
  const n = v === "UTC" || v === "Z" ? 0 : m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : /^-?\d{1,3}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < -720 || n > 840 || n % 15 !== 0) throw new SetupRefused("utc offset: use +HH:MM, -HH:MM or minutes, in whole quarter hours between -12:00 and +14:00");
  return n;
}
/** The zone's offset at `at` (the engine keeps one fixed offset per entity: no daylight saving). */
export function offsetOf(tz: string, at = new Date()): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return part === "GMT" ? 0 : parseUtcOffset(part.replace("GMT", ""));
}

// ---------------------------------------------------------------------------------------------
// The owner connection
// ---------------------------------------------------------------------------------------------

/** Open the OWNER connection from DATABASE_OWNER_URL, or refuse. The URL is never printed. */
export async function openOwnerDb(url: string | undefined): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!url) throw new SetupRefused("set DATABASE_OWNER_URL to the schema owner login (clearline_owner); merchant setup never runs on the runtime login");
  const pool = new Pool({ connectionString: url, max: 2 });
  const close = () => pool.end();
  try {
    const r = await pool.query(`select (select tableowner from pg_tables where schemaname = 'public' and tablename = 'organizations') = current_user as owns,
      pg_has_role(current_user, 'clearline_app', 'MEMBER') as app`);
    if (!r.rows[0]?.owns || r.rows[0]?.app) throw new SetupRefused("DATABASE_OWNER_URL is not the schema owner login (it does not own the tables, or it is the runtime app's login): refusing");
  } catch (e) { await close(); throw e; }
  return { db: drizzle(pool, { schema }) as Db, close };
}

async function orgBySlug(db: Db, slug: string) {
  const [o] = await db.select().from(t.organizations).where(eq(t.organizations.slug, parse(Slug, slug, "slug")));
  return o;
}
async function merchantOrg(db: Db, slug: string) {
  const o = await orgBySlug(db, slug);
  if (!o) throw new SetupRefused("No organisation has that slug.");
  if (o.kind !== "merchant") throw new SetupRefused("That organisation is a provider, not a merchant.");
  return o;
}
const audit = (db: Pick<Db, "insert">, orgId: string, action: string, entityType: string, entityId: string, summary: string, details: Record<string, unknown>) =>
  db.insert(t.auditEvents).values({ orgId, source: "server", actorUserId: null, action, entityType, entityId, summary: `${summary} (operator, admin CLI)`, at: new Date(), details });
const confirmed = (slug: string, confirm: string | undefined) => {
  if (confirm !== undefined && confirm !== slug) throw new SetupRefused("--confirm must repeat the organisation's slug exactly; nothing changed.");
  return confirm === slug;
};

// ---------------------------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------------------------

/** A LIVE merchant organisation ("Your data"), empty, in its own time zone. Same slug and values again: no change. */
export async function createMerchant(db: Db, input: { slug: string; name: string; timezone: string }) {
  const slug = parse(Slug, input.slug, "slug"), name = parse(Name, input.name, "name"), timezone = validTimeZone(input.timezone);
  const prior = await orgBySlug(db, slug);
  if (prior) {
    if (prior.kind === "merchant" && prior.dataMode === "live" && prior.name === name && prior.timezone === timezone) return { status: "exists" as const, orgId: prior.id, slug };
    throw new SetupRefused("That slug is already used by a different organisation (kind, data mode, name or time zone differ); nothing changed.");
  }
  const orgId = await createOrganization(db, { slug, name, seed: "empty", dataMode: "live" });
  await db.update(t.organizations).set({ timezone }).where(eq(t.organizations.id, orgId));
  return { status: "created" as const, orgId, slug };
}

/** A payment provider organisation (it serves merchants; its members are Provider Admin or Provider Ops). */
export async function createProvider(db: Db, input: { slug: string; name: string; timezone: string }) {
  const slug = parse(Slug, input.slug, "slug"), name = parse(Name, input.name, "name"), timezone = validTimeZone(input.timezone);
  const prior = await orgBySlug(db, slug);
  if (prior) {
    if (prior.kind === "provider" && prior.name === name && prior.timezone === timezone) return { status: "exists" as const, orgId: prior.id, slug };
    throw new SetupRefused("That slug is already used by a different organisation; nothing changed.");
  }
  const orgId = await createOrganization(db, { slug, name, seed: "empty", dataMode: "live" });
  await db.update(t.organizations).set({ kind: "provider", timezone }).where(eq(t.organizations.id, orgId));
  return { status: "created" as const, orgId, slug };
}

// ---------------------------------------------------------------------------------------------
// Entities and their matching policy
// ---------------------------------------------------------------------------------------------

/** A legal entity and its default policy (defaultPolicyFor(currency); the imported-bank-line flag off), in one transaction. */
export async function addEntity(db: Db, input: { orgSlug: string; entityId: string; name: string; currency: string; timezone: string; utcOffset?: string; ledger?: string }) {
  const org = await merchantOrg(db, input.orgSlug);
  const id = parse(EntityId, input.entityId, "entity id"), name = parse(Name, input.name, "legal name"), currency = parse(Currency, input.currency, "currency") as FiatCurrency;
  const timezone = validTimeZone(input.timezone), ledger = parse(Ledger, input.ledger ?? "none", "ledger");
  const utcOffsetMinutes = input.utcOffset !== undefined ? parseUtcOffset(input.utcOffset) : offsetOf(timezone);
  const [prior] = await db.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, org.id), eq(t.merchantEntities.id, id)));
  if (prior) {
    if (prior.name === name && prior.functionalCurrency === currency && prior.timezone === timezone && prior.utcOffsetMinutes === utcOffsetMinutes && prior.ledger === ledger) {
      return { status: "exists" as const, orgId: org.id, entityId: id, utcOffsetMinutes };
    }
    throw new SetupRefused("That entity already exists with different values; nothing changed (an entity's currency or day never changes under its data).");
  }
  const p = defaultPolicyFor(currency);
  await db.transaction(async (tx) => {
    await tx.insert(t.merchantEntities).values({ orgId: org.id, id, name, functionalCurrency: currency, ledger, timezone, utcOffsetMinutes });
    await tx.insert(t.merchantPolicy).values({
      orgId: org.id, entityId: id, toleranceBps: p.tolerancePct, toleranceAbsMinor: p.toleranceAbsMinor, toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor,
      approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: p.senderFeeBoundBaseUnits.toString(),
    });
    await audit(tx, org.id, "merchant_entity_created", "merchant_entity", id, `Entity ${id} created (${currency}, UTC offset ${utcOffsetMinutes} min) with the default policy, revision 1`, { currency, ledger, utcOffsetMinutes, policyRevision: 1 });
  });
  return { status: "created" as const, orgId: org.id, entityId: id, utcOffsetMinutes, policyRevision: 1 };
}

type PolicyField = keyof z.infer<typeof PolicyPatch>;
const POLICY_COLUMNS: Record<PolicyField, keyof typeof t.merchantPolicy.$inferSelect> = {
  toleranceBps: "toleranceBps", toleranceAbsMinor: "toleranceAbsMinor", toleranceCombine: "toleranceCombine", writeoffThresholdMinor: "writeoffThresholdMinor",
  allowImportedBankLinesAsVerified: "allowImportedBankLinesAsVerified",
};
const plain = (v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/**
 * Change an entity's matching policy with the SAME validation as the Settings page (PolicyPatch). `defaults: true`
 * starts from defaultPolicyFor(currency) (the imported-bank-line flag off); explicit fields override it. A dry run
 * unless `confirm` repeats the organisation's slug; applying writes the next revision and an audit row.
 */
export async function setPolicy(db: Db, input: { orgSlug: string; entityId: string; patch: Record<string, unknown>; defaults?: boolean; confirm?: string }) {
  const org = await merchantOrg(db, input.orgSlug);
  const id = parse(EntityId, input.entityId, "entity id");
  const [ent] = await db.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, org.id), eq(t.merchantEntities.id, id)));
  const [cur] = await db.select().from(t.merchantPolicy).where(and(eq(t.merchantPolicy.orgId, org.id), eq(t.merchantPolicy.entityId, id)));
  if (!ent || !cur) throw new SetupRefused("No such entity in that organisation (add it with add-entity).");
  const d = defaultPolicyFor(ent.functionalCurrency as FiatCurrency);
  const base = input.defaults ? { toleranceBps: d.tolerancePct, toleranceAbsMinor: d.toleranceAbsMinor.toString(), toleranceCombine: d.toleranceCombine, writeoffThresholdMinor: d.writeoffThresholdMinor.toString(), allowImportedBankLinesAsVerified: false } : {};
  const r = PolicyPatch.safeParse({ ...base, ...input.patch });
  if (!r.success) throw new SetupRefused(`policy: ${r.error.issues.map((i) => `${i.path.join(".") || "patch"} ${i.message}`).join("; ")} (the Settings page's validation)`);
  const changes: Partial<Record<PolicyField, { from: unknown; to: unknown }>> = {};
  for (const [k, v] of Object.entries(r.data) as [PolicyField, unknown][]) {
    const was = cur[POLICY_COLUMNS[k]];
    if (v !== undefined && plain(was) !== plain(v)) changes[k] = { from: plain(was), to: plain(v) };
  }
  const fields = Object.keys(changes) as PolicyField[];
  if (!fields.length) return { status: "unchanged" as const, orgId: org.id, entityId: id, revision: cur.revision };
  if (!confirmed(org.slug, input.confirm)) return { status: "dry_run" as const, orgId: org.id, entityId: id, revision: cur.revision, wouldChange: changes };
  const set = Object.fromEntries(fields.map((k) => [POLICY_COLUMNS[k], r.data[k]]));
  const revision = await db.transaction(async (tx) => {
    const u = await tx.update(t.merchantPolicy).set({ ...set, revision: cur.revision + 1, updatedAt: new Date() })
      .where(and(eq(t.merchantPolicy.orgId, org.id), eq(t.merchantPolicy.entityId, id), eq(t.merchantPolicy.revision, cur.revision))).returning({ revision: t.merchantPolicy.revision });
    if (!u.length) throw new SetupRefused("The policy changed while this ran; nothing changed. Run it again.");
    await audit(tx, org.id, "merchant_policy_updated", "merchant_entity", id, `Matching policy revision ${u[0].revision}: ${fields.join(", ")}`, Object.fromEntries(fields.map((k) => [k, changes[k]!.to])));
    return u[0].revision;
  });
  return { status: "applied" as const, orgId: org.id, entityId: id, revision, changed: fields };
}

// ---------------------------------------------------------------------------------------------
// Bank accounts (v1)
// ---------------------------------------------------------------------------------------------

const AccountName = z.string().trim().min(1).max(120);
const BankName = z.string().trim().min(1).max(120);
const Bic = z.string().regex(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "a BIC is 8 or 11 letters and digits (e.g. FICTSGSGXXX)");
/** Only the last four characters are ever accepted: a longer value is refused (and never echoed), so no full number is stored. */
const LAST4_HELP = "pass exactly the LAST FOUR letters or digits of the account number; the full number is never stored";

/**
 * A bank account of an entity (`add-bank-account`). Its currency may differ from the entity's functional currency;
 * reconciliation still reads only statement lines in the entity's functional currency. Same name and values again: no
 * change; the same name with other values is refused (an account's entity, currency and number never change).
 */
export async function addBankAccount(db: Db, input: { orgSlug: string; entityId: string; name: string; currency: string; last4: string; bankName: string; bic?: string }) {
  const org = await merchantOrg(db, input.orgSlug);
  const entityId = parse(EntityId, input.entityId, "entity id"), displayName = parse(AccountName, input.name, "account name");
  const currency = parse(Currency, input.currency, "currency");
  const last4 = normaliseLast4(input.last4);
  if (!last4) throw new SetupRefused(`last four: ${LAST4_HELP}`);
  const bankName = parse(BankName, input.bankName, "bank name"), bic = input.bic === undefined ? null : parse(Bic, input.bic.trim().toUpperCase(), "bic");
  const [ent] = await db.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, org.id), eq(t.merchantEntities.id, entityId)));
  if (!ent) throw new SetupRefused("No such entity in that organisation (add it with add-entity).");
  const [prior] = await db.select().from(t.bankAccounts).where(and(eq(t.bankAccounts.orgId, org.id), eq(t.bankAccounts.entityId, entityId), eq(t.bankAccounts.displayName, displayName)));
  if (prior) {
    if (prior.currency === currency && prior.accountLast4 === last4 && prior.bankName === bankName && prior.bic === bic && prior.status === "active") {
      return { status: "exists" as const, orgId: org.id, entityId, bankAccountId: prior.id, currency };
    }
    throw new SetupRefused("That entity already has an account with this name and different values (or it is closed); nothing changed.");
  }
  const id = await db.transaction(async (tx) => {
    const [a] = await tx.insert(t.bankAccounts).values({ orgId: org.id, entityId, currency, displayName, accountLast4: last4, bankName, bic, status: "active", createdBy: null }).returning({ id: t.bankAccounts.id });
    await audit(tx, org.id, "bank_account_created", "bank_account", a.id, `Bank account ${a.id} added to entity ${entityId} (${currency})`, { entityId, bankAccountId: a.id, currency });
    return a.id;
  });
  return { status: "created" as const, orgId: org.id, entityId, bankAccountId: id, currency, entityCurrency: ent.functionalCurrency };
}

/** Close an account (`close-bank-account`): no new statements are uploaded to it; its lines stay. A dry run unless confirmed. */
export async function closeBankAccount(db: Db, input: { orgSlug: string; bankAccountId: string; confirm?: string }) {
  const org = await merchantOrg(db, input.orgSlug);
  const id = parse(z.uuid(), input.bankAccountId, "bank account id");
  const [a] = await db.select().from(t.bankAccounts).where(and(eq(t.bankAccounts.orgId, org.id), eq(t.bankAccounts.id, id)));
  if (!a) throw new SetupRefused("No such bank account in that organisation.");
  if (a.status === "closed") return { status: "exists" as const, orgId: org.id, bankAccountId: id };
  if (!confirmed(org.slug, input.confirm)) return { status: "dry_run" as const, orgId: org.id, bankAccountId: id, wouldClose: true };
  await db.transaction(async (tx) => {
    await tx.update(t.bankAccounts).set({ status: "closed", closedAt: new Date() }).where(and(eq(t.bankAccounts.orgId, org.id), eq(t.bankAccounts.id, id)));
    await audit(tx, org.id, "bank_account_closed", "bank_account", id, `Bank account ${id} closed (no new statements)`, { entityId: a.entityId, bankAccountId: id });
  });
  return { status: "closed" as const, orgId: org.id, bankAccountId: id };
}

// ---------------------------------------------------------------------------------------------
// Provider link and members
// ---------------------------------------------------------------------------------------------

/**
 * Link a merchant to an existing provider organisation (organizations.provider_org_id). The provider starts with
 * aggregates only (the merchant's own Admin decides a full grant) and may still invite only Viewers. A relink to a
 * different provider is a dry run unless confirmed; it revokes the old provider's grant.
 */
export async function linkProvider(db: Db, input: { orgSlug: string; providerSlug: string; confirm?: string }) {
  const org = await merchantOrg(db, input.orgSlug);
  const prov = await orgBySlug(db, input.providerSlug);
  if (!prov || prov.kind !== "provider") throw new SetupRefused("No provider organisation has that slug (create it with create-provider).");
  if (org.providerOrgId === prov.id) return { status: "exists" as const, orgId: org.id, providerOrgId: prov.id };
  if (org.providerOrgId && !confirmed(org.slug, input.confirm)) return { status: "dry_run" as const, orgId: org.id, providerOrgId: prov.id, wouldReplaceProviderOrgId: org.providerOrgId };
  const revoked = await db.transaction(async (tx) => {
    const g = await tx.update(t.providerGrants).set({ revokedAt: new Date() }).where(and(eq(t.providerGrants.merchantOrgId, org.id), isNull(t.providerGrants.revokedAt))).returning({ p: t.providerGrants.providerOrgId });
    await tx.update(t.organizations).set({ providerOrgId: prov.id }).where(eq(t.organizations.id, org.id));
    await audit(tx, org.id, "merchant_provider_linked", "organization", org.id, `Served by provider organisation ${prov.id}; aggregates only until the merchant's Admin grants more`, { providerOrgId: prov.id, previousProviderOrgId: org.providerOrgId, grantsRevoked: g.length });
    return g.length;
  });
  return { status: org.providerOrgId ? "relinked" as const : "linked" as const, orgId: org.id, providerOrgId: prov.id, grantsRevoked: revoked };
}

/**
 * Give a person a role in an organisation. A new person's password comes ONLY from CLEARLINE_SEED_PASSWORD (passed
 * here by the CLI from the environment; never an argument, never printed); without it, use the provider's invitation
 * flow (accept-invitation). A different role for an existing member is a dry run unless confirmed.
 */
export async function addMember(db: Db, input: { orgSlug: string; email: string; role: string; name?: string; password?: string; confirm?: string }) {
  const org = await orgBySlug(db, input.orgSlug);
  if (!org) throw new SetupRefused("No organisation has that slug.");
  const email = parse(Email, input.email.trim().toLowerCase(), "email");
  const roles: readonly string[] = org.kind === "provider" ? PROVIDER_MEMBER_ROLES : MERCHANT_MEMBER_ROLES;
  if (!roles.includes(input.role)) throw new SetupRefused(`role: one of ${roles.join(", ")} for a ${org.kind}`);
  const role = input.role as (typeof MERCHANT_MEMBER_ROLES)[number] | (typeof PROVIDER_MEMBER_ROLES)[number];
  let [user] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, email));
  let created = false;
  if (!user) {
    if (!input.password) throw new SetupRefused("This person has no account: set CLEARLINE_SEED_PASSWORD (12+ characters, from a secrets store, never an argument), or use the provider's invitation and accept-invitation.");
    if (input.password.length < 12) throw new SetupRefused("CLEARLINE_SEED_PASSWORD must be at least 12 characters.");
    user = { id: await createUser(db, { email, name: parse(Name, input.name ?? email.split("@")[0], "name"), password: input.password }) };
    created = true;
  }
  const [m] = await db.select().from(t.organizationMemberships).where(and(eq(t.organizationMemberships.orgId, org.id), eq(t.organizationMemberships.userId, user.id)));
  if (m && m.role === role && !m.revokedAt) return { status: "exists" as const, orgId: org.id, userId: user.id, role };
  if (m && !confirmed(org.slug, input.confirm)) return { status: "dry_run" as const, orgId: org.id, userId: user.id, role, wouldReplaceRole: m.revokedAt ? "(revoked)" : m.role };
  await grantMembership(db, { orgSlug: org.slug, email, role });
  return { status: m ? "role_changed" as const : "granted" as const, orgId: org.id, userId: user.id, role, userCreated: created };
}

/** What an organisation holds after setup (ids and counts only), for the operator's check. */
export async function setupSummary(db: Db, orgSlug: string) {
  const org = await orgBySlug(db, orgSlug);
  if (!org) throw new SetupRefused("No organisation has that slug.");
  const ents = await db.select({ id: t.merchantEntities.id, currency: t.merchantEntities.functionalCurrency, utcOffsetMinutes: t.merchantEntities.utcOffsetMinutes }).from(t.merchantEntities).where(eq(t.merchantEntities.orgId, org.id));
  const accts = await db.select({ id: t.bankAccounts.id, entityId: t.bankAccounts.entityId, currency: t.bankAccounts.currency, status: t.bankAccounts.status }).from(t.bankAccounts).where(eq(t.bankAccounts.orgId, org.id));
  const pol = await db.select({ entityId: t.merchantPolicy.entityId, revision: t.merchantPolicy.revision }).from(t.merchantPolicy).where(eq(t.merchantPolicy.orgId, org.id));
  const mem = (await db.execute(sql`select role, count(*)::int as n from organization_memberships where org_id = ${org.id} and revoked_at is null group by role order by role`)).rows as { role: string; n: number }[];
  return { orgId: org.id, slug: org.slug, kind: org.kind, dataMode: org.dataMode, providerOrgId: org.providerOrgId, entities: ents.map((e) => ({ ...e, policyRevision: pol.find((p) => p.entityId === e.id)?.revision ?? null, bankAccounts: accts.filter((a) => a.entityId === e.id).map(({ entityId: _e, ...a }) => (void _e, a)) })), members: Object.fromEntries(mem.map((r) => [r.role, r.n])) };
}
