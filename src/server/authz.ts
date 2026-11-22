/**
 * Clearline Control roles and the server-side permission matrix. Least privilege: an Admin manages members but holds
 * no financial authority; only an Approver approves. Every route checks `can()` on the server before calling the
 * engine, and the engine then applies its own rules (e.g. approver ≠ proposer) with the session user as actor.
 */
import type { ActorRole, WorkspaceAction } from "@/lib/clearline";

export const APP_ROLES = ["admin", "payment_ops", "finance", "approver", "viewer", "provider_admin", "provider_ops"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const isAppRole = (r: string): r is AppRole => (APP_ROLES as readonly string[]).includes(r);

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  payment_ops: "Payment Operations",
  finance: "Finance",
  approver: "Approver",
  viewer: "Viewer",
  provider_admin: "Provider Admin",
  provider_ops: "Provider Ops",
};

/** The engine's own role for this member (the engine's checks run on top of the matrix below). */
export const ENGINE_ROLE: Record<AppRole, ActorRole> = {
  admin: "viewer",
  payment_ops: "operator",
  finance: "operator",
  approver: "approver",
  viewer: "viewer",
  provider_admin: "viewer",
  provider_ops: "viewer",
};

export type Permission =
  | "read"
  | "investigate"          // owner, notes, evidence, info requests, reopen, proposed resolution
  | "request_approval"
  | "decide_approval"
  | "import_statement"
  | "confirm_import"       // second person: an imported file becomes evidence only once an Approver confirms it
  | "accounting_prepare"   // propose / export / record posting / periods / mapping
  | "accounting_approve"
  | "manage_members"
  | "provider_console"     // rc6: merchants' aggregates (rows only under a merchant's full grant, enforced by RLS)
  | "provider_manage";     // rc6: onboarding, policy defaults, theme

const MATRIX: Record<Permission, readonly AppRole[]> = {
  read: ["admin", "payment_ops", "finance", "approver", "viewer"],
  investigate: ["payment_ops"],
  request_approval: ["payment_ops"],
  decide_approval: ["approver"],
  import_statement: ["finance"],
  confirm_import: ["approver"],  // Finance imports; Payment Ops investigates; an Approver decides
  accounting_prepare: ["finance"],
  accounting_approve: ["approver"],
  manage_members: ["admin"],
  provider_console: ["provider_admin", "provider_ops"],
  provider_manage: ["provider_admin"],
};

export const can = (role: AppRole, p: Permission): boolean => MATRIX[p].includes(role);

/**
 * Engine actions the pilot API accepts, with the permission each needs. Anything not listed (simulation, clock,
 * scenario reset, provider or chain injection, payment creation and execution) is refused: there is no payment
 * execution in this build, and evidence arrives only through server-controlled paths.
 */
export const ACTION_PERMISSION: Partial<Record<WorkspaceAction["type"], Permission>> = {
  assign_owner: "investigate",
  add_note: "investigate",
  attach_evidence: "investigate",
  request_info: "investigate",
  reopen: "investigate",
  propose_journal_entries: "accounting_prepare",
  approve_journal_proposal: "accounting_approve",
  reject_journal_proposal: "accounting_approve",
  export_journal: "accounting_prepare",
  record_posting: "accounting_prepare",
  open_accounting_period: "accounting_prepare",
  close_accounting_period: "accounting_prepare",
  set_account_mapping: "accounting_prepare",
  record_reconciliation_export: "accounting_prepare",
  confirm_not_imported: "accounting_approve",
};

/**
 * Not accepted directly: "resolve" (only through an approved approval request — src/server/control.ts decideApproval), and every
 * action that creates payments, executes them, simulates providers, injects evidence or moves the clock.
 */
export const SERVER_ONLY_ACTIONS = ["resolve"] as const;
