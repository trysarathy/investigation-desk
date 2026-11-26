import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { suggestMapping, validateMapping, type FileType } from "@/lib/clearline/mapping";
import { defaultPolicyFor } from "@/lib/clearline/merchant/config";
import type { FiatCurrency } from "@/lib/clearline/merchant/types";
import { normaliseLast4 } from "@/lib/clearline/bank-accounts";
import * as t from "../db/schema";
import { SETUP_STEPS, type SetupStep } from "../db/onboarding-schema";
import { withProvisioning } from "../db/provisioning";
import { can, ROLE_LABELS, type AppRole } from "../authz";
import { RequestRefused } from "../errors";
import { headerSignature, listMappingTemplates } from "../mapping-templates";
import { merchantShell } from "../merchant-ui";
import { listOrgUsers } from "../org-admin";
import { AccessDenied, requireUnscoped, type TenantContext, withTenant } from "../tenant";
import { offsetOf, parseUtcOffset, SetupRefused, validTimeZone } from "../merchant-setup";
import { invitationSender } from "../email";
import { Email, invitationEmail, inviteAndDeliver } from "./invitations";

/**
 * v1 phase 1.1: the merchant's SETUP WIZARD (/control/merchant/setup), for the merchant's Admin.
 *
 * Writes: ONLY through the provisioning role (prov_* functions, src/server/db/provisioning.ts). The database checks
 * again that the session user is an active Admin of app_org_id(), that setup is not finished, and audits each write.
 * Reads: the runtime connection, exactly as the other merchant screens read (its grants are unchanged), plus
 * prov_setup_state() for the steps and pending invitations (the runtime role cannot read those tables).
 *
 * Conservative choices (see the report's "Decisions made"):
 *  - the tolerance step CONFIRMS the approved default per entity (larger of 0.5% or SGD 5 / USD 5 / AED 20); a
 *    change is made on the Settings page, whose validation and audit are unchanged. The wizard never writes a policy
 *    other than the default, and never touches the imported-bank-line flag (it stays off);
 *  - the ledger step records a choice only; no Xero or QuickBooks connection is made;
 *  - after "Finish setup" every wizard write is refused (later changes: the operator's CLI, or Settings).
 */
export const STEP_LABELS: Record<SetupStep, string> = {
  entities: "Entities and currencies", ledger: "Ledger", bank_accounts: "Bank accounts", tolerance: "Matching tolerance",
  provider: "Payment provider", mapping_templates: "Mapping templates", members: "Users and roles", finish: "Finish",
};
export const WIZARD_STEPS = SETUP_STEPS;
export const MEMBER_ROLES = ["admin", "payment_ops", "finance", "approver", "viewer"] as const satisfies readonly AppRole[];
export const TEMPLATE_FILE_TYPES = ["orders_invoices", "bank_statement", "ledger_invoices", "provider_export"] as const satisfies readonly FileType[];

/** Only a merchant organisation's Admin runs its setup (the database checks it again). */
export function requireSetupAdmin(ctx: TenantContext) {
  if (!can(ctx.role, "manage_members")) throw new AccessDenied(403, "Only an Admin of this organisation runs its setup.");
  // wave 1: setup changes the whole organisation (entities, bank accounts, members); the database agrees (drizzle/0069)
  requireUnscoped(ctx);
}

const prov = <T>(ctx: TenantContext, fn: Parameters<typeof withProvisioning<T>>[1]) => withProvisioning({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const asRefusal = (e: unknown): never => { if (e instanceof SetupRefused) throw new RequestRefused(422, "SETUP_REFUSED", e.message); throw e; };

export interface SetupView {
  orgName: string;
  kind: "merchant" | "provider";
  steps: Partial<Record<SetupStep, string>>;
  finished: boolean;
  entities: { id: string; name: string; currency: string; timezone: string; utcOffsetMinutes: number; ledger: string;
    policy: { revision: number; toleranceBps: number; toleranceAbsMinor: string; toleranceCombine: string; isDefault: boolean } | null }[];
  bankAccounts: { id: string; entityId: string; name: string; currency: string; last4: string; bankName: string; status: string }[];
  providerName: string | null;
  templates: { id: string; name: string; version: number; fileType: string }[];
  members: { userId: string; name: string; email: string; role: string; revoked: boolean }[];
  invitations: { id: string; email: string; role: string; expiresAt: string; expired: boolean }[];
}

/** Everything the wizard shows (Admin only). */
export async function setupView(ctx: TenantContext): Promise<SetupView> {
  requireSetupAdmin(ctx);
  const shell = await merchantShell(ctx);
  if (shell.kind !== "merchant") throw new AccessDenied(404, "Not found.");
  const [state] = await prov(ctx, (tx) => tx.call("prov_setup_state", []));
  const s = state.prov_setup_state as { steps: Record<string, string>; invitations: SetupView["invitations"] };
  const { entities, accounts } = await withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const ents = await tx.select().from(t.merchantEntities).where(eq(t.merchantEntities.orgId, ctx.orgId)).orderBy(asc(t.merchantEntities.id));
    const pols = await tx.select().from(t.merchantPolicy).where(eq(t.merchantPolicy.orgId, ctx.orgId));
    const accts = await tx.select().from(t.bankAccounts).where(eq(t.bankAccounts.orgId, ctx.orgId)).orderBy(asc(t.bankAccounts.entityId), asc(t.bankAccounts.displayName));
    return {
      entities: ents.map((e) => {
        const p = pols.find((x) => x.entityId === e.id);
        const d = defaultPolicyFor(e.functionalCurrency as FiatCurrency);
        return { id: e.id, name: e.name, currency: e.functionalCurrency, timezone: e.timezone, utcOffsetMinutes: e.utcOffsetMinutes, ledger: e.ledger,
          policy: p ? { revision: p.revision, toleranceBps: p.toleranceBps, toleranceAbsMinor: p.toleranceAbsMinor.toString(), toleranceCombine: p.toleranceCombine,
            isDefault: p.toleranceBps === d.tolerancePct && p.toleranceAbsMinor === d.toleranceAbsMinor && p.toleranceCombine === d.toleranceCombine && !p.allowImportedBankLinesAsVerified } : null };
      }),
      accounts: accts.map((a) => ({ id: a.id, entityId: a.entityId, name: a.displayName, currency: a.currency, last4: a.accountLast4, bankName: a.bankName, status: a.status })),
    };
  }, { read: true });
  const [templates, users] = await Promise.all([listMappingTemplates(ctx), listOrgUsers(ctx)]);
  return {
    orgName: ctx.orgName, kind: shell.kind, steps: s.steps, finished: !!s.steps.finish, entities, bankAccounts: accounts, providerName: shell.providerName,
    templates: templates.map((x) => ({ id: x.id, name: x.name, version: x.version, fileType: x.fileType })),
    members: users.map((u) => ({ userId: u.userId, name: u.name, email: u.email, role: u.role, revoked: !!u.revokedAt })),
    invitations: s.invitations,
  };
}

// ---------------------------------------------------------------------------------------------
// Writes (each one provisioning-role call; validated here first, then by the database)
// ---------------------------------------------------------------------------------------------

const EntityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "an entity id is 1–64 letters, digits, dashes or underscores");
const Ledger = z.enum(["xero", "quickbooks", "none"]);
const Currency = z.enum(["SGD", "USD", "AED"]);

export const EntityInput = z.object({
  entityId: EntityId, name: z.string().trim().min(1).max(200), currency: Currency, timezone: z.string().min(1).max(64),
  utcOffset: z.string().max(10).optional(), ledger: Ledger.default("none"),
}).strict();
export async function addEntity(ctx: TenantContext, input: z.input<typeof EntityInput>) {
  requireSetupAdmin(ctx);
  const v = EntityInput.parse(input);
  let offset: number;
  try { offset = v.utcOffset ? parseUtcOffset(v.utcOffset) : offsetOf(validTimeZone(v.timezone)); validTimeZone(v.timezone); } catch (e) { return asRefusal(e); }
  const [r] = await prov(ctx, (tx) => tx.call("prov_add_entity", [v.entityId, v.name, v.currency, v.timezone, offset, v.ledger]));
  const d = defaultPolicyFor(v.currency);
  return { status: String(r.prov_add_entity), entityId: v.entityId, utcOffsetMinutes: offset, policy: { toleranceBps: d.tolerancePct, toleranceAbsMinor: d.toleranceAbsMinor.toString(), toleranceCombine: d.toleranceCombine } };
}

export const LedgerInput = z.object({ entityId: EntityId, ledger: Ledger }).strict();
export async function setLedger(ctx: TenantContext, input: z.input<typeof LedgerInput>) {
  requireSetupAdmin(ctx);
  const v = LedgerInput.parse(input);
  const [r] = await prov(ctx, (tx) => tx.call("prov_set_entity_ledger", [v.entityId, v.ledger]));
  return { status: String(r.prov_set_entity_ledger), entityId: v.entityId, ledger: v.ledger };
}

const Bic = z.string().trim().toUpperCase().regex(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "a BIC is 8 or 11 letters and digits (e.g. FICTSGSGXXX)");
export const BankAccountInput = z.object({
  entityId: EntityId, name: z.string().trim().min(1).max(120), currency: Currency, last4: z.string().max(12), bankName: z.string().trim().min(1).max(120),
  bic: z.union([Bic, z.literal("")]).optional(),
}).strict();
export async function addBankAccount(ctx: TenantContext, input: z.input<typeof BankAccountInput>) {
  requireSetupAdmin(ctx);
  const v = BankAccountInput.parse(input);
  const last4 = normaliseLast4(v.last4);
  // never echoed: a longer value might be a full account number
  if (!last4) throw new RequestRefused(422, "LAST4_ONLY", "Enter exactly the LAST FOUR letters or digits of the account number; the full number is never stored.");
  const [r] = await prov(ctx, (tx) => tx.call("prov_add_bank_account", [v.entityId, v.name, v.currency, last4, v.bankName, v.bic || null]));
  return { bankAccountId: String(r.prov_add_bank_account), entityId: v.entityId, currency: v.currency };
}

export const ProviderInput = z.object({ providerSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "a provider code is 2–63 lower-case letters, digits or dashes") }).strict();
export async function linkProvider(ctx: TenantContext, input: z.input<typeof ProviderInput>) {
  requireSetupAdmin(ctx);
  const v = ProviderInput.parse(input);
  const [r] = await prov(ctx, (tx) => tx.call("prov_link_provider", [v.providerSlug]));
  return { status: String(r.prov_link_provider) };
}

export const TemplateInput = z.object({
  fileType: z.enum(TEMPLATE_FILE_TYPES), name: z.string().trim().min(1).max(120),
  /** The header row of a file of this type, as pasted (comma, semicolon or tab separated). */
  headerLine: z.string().min(1).max(4000),
}).strict();
export function headersOfLine(line: string): string[] {
  const first = line.split(/\r?\n/)[0];
  const sep = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  return first.split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").trim()).filter((h) => h.length > 0).slice(0, 200);
}
/** A starter template from a header row: the suggested mapping, saved only if it maps every required field. */
export async function addMappingTemplate(ctx: TenantContext, input: z.input<typeof TemplateInput>) {
  requireSetupAdmin(ctx);
  const v = TemplateInput.parse(input);
  const headers = headersOfLine(v.headerLine);
  if (!headers.length) throw new RequestRefused(422, "MAPPING_INVALID", "Paste the header row of a file.");
  const proposal = suggestMapping(headers, v.fileType).proposal;
  const mapping = { fileType: v.fileType, columns: Object.fromEntries(Object.entries(proposal).map(([k, x]) => [k, { header: x.header }])) };
  const check = validateMapping(mapping, headers);
  if (!check.ok) {
    throw new RequestRefused(422, "MAPPING_INCOMPLETE", `The suggested mapping is not complete, so nothing was saved: ${check.issues.map((i) => i.message).join(" ")} Map this file on its first upload instead.`);
  }
  const [r] = await prov(ctx, (tx) => tx.call("prov_add_mapping_template", [v.fileType, v.name, headerSignature(headers), check.mapping]));
  return { templateId: String(r.id), version: Number(r.version), fields: Object.keys(check.mapping.columns).length };
}

export const InviteInput = z.object({ email: Email, role: z.enum(MEMBER_ROLES) }).strict();
/** Invite a member: the invitation and its email in one provisioning transaction (no sender: the one-time link is returned). */
export async function inviteMember(ctx: TenantContext, input: z.input<typeof InviteInput>) {
  requireSetupAdmin(ctx);
  const v = InviteInput.parse(input);
  return prov(ctx, async (tx) => inviteAndDeliver(
    async (tk) => ({ invitationId: String((await tx.call("prov_invite_member", [v.email, v.role, tk.sha256, tk.expiresAt]))[0].prov_invite_member), role: v.role, roleLabel: ROLE_LABELS[v.role] }),
    (tk) => invitationEmail({ to: v.email, orgName: ctx.orgName, role: v.role, token: tk.token, expiresAt: tk.expiresAt }),
    invitationSender({ prov: tx })));
}

export const RevokeInput = z.object({ invitationId: z.uuid() }).strict();
export async function revokeInvitation(ctx: TenantContext, input: z.input<typeof RevokeInput>) {
  requireSetupAdmin(ctx);
  const v = RevokeInput.parse(input);
  await prov(ctx, (tx) => tx.call("prov_revoke_invitation", [v.invitationId]));
  return { status: "revoked" };
}

export const StepInput = z.object({ step: z.enum(SETUP_STEPS) }).strict();
export async function markStep(ctx: TenantContext, input: z.input<typeof StepInput>) {
  requireSetupAdmin(ctx);
  const v = StepInput.parse(input);
  const [r] = await prov(ctx, (tx) => tx.call("prov_mark_step", [v.step]));
  return { status: String(r.prov_mark_step), step: v.step };
}

/** The wizard's actions by URL segment (/api/control/merchant/setup/<action>). */
export const SETUP_ACTIONS = {
  entity: addEntity, ledger: setLedger, "bank-account": addBankAccount, provider: linkProvider, "mapping-template": addMappingTemplate,
  invite: inviteMember, "revoke-invitation": revokeInvitation, step: markStep,
} as const satisfies Record<string, (ctx: TenantContext, input: never) => Promise<unknown>>;
export type SetupAction = keyof typeof SETUP_ACTIONS;
export const isSetupAction = (a: string): a is SetupAction => Object.hasOwn(SETUP_ACTIONS, a);

