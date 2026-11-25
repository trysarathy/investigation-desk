/**
 * Clearline Control roles and the server-side permission matrix. Least privilege: an Admin manages members but holds
 * no financial authority; only an Approver approves. Every route checks `can()` on the server before calling the
 * engine, and the engine then applies its own rules (e.g. approver ≠ proposer) with the session user as actor.
 */
import type { ActorRole, WorkspaceAction } from "@/lib/clearline";

export const APP_ROLES = ["admin", "payment_ops", "finance", "approver", "viewer", "provider_admin", "provider_ops", "auditor"] as const;
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
  auditor: "Auditor",
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
  auditor: "viewer",
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
  | "provider_manage"      // rc6: onboarding, policy defaults, theme
  | "manage_policy"        // rc6: merchant matching policy (tolerance, write-off threshold, imported lines) — Admin only
  | "merchant_reconcile"   // rc6: run reconciliation over the merchant's ingested rows
  | "propose_writeoff"     // rc6: submit an engine-proposed write-off for a second person's approval
  | "review_match"         // rc6: mark a sampled match correct or wrong (pilot metric)
  | "merchant_investigate" // rc6 phase 7: assign, note, attach evidence and propose a resolution on a merchant exception
  | "merchant_upload"      // rc7: upload a file, map its columns, save a mapping template, validate
  | "manage_retention"     // rc7: how long uploads and the data derived from them are kept — Admin only
  | "manage_pickup"        // v1 phase 2.1: scheduled pickup sources (SFTP folder, email inbox) — Admin only
  | "merchant_export"      // rc8 founder decision 3: every merchant export (evidence pack, rc6 journal file, rc7 draft journal files,
                           // month-end pack) — exactly Finance, an Approver or an Admin
  | "ledger_connect"       // v1 phase 2.3: connect, choose the organisation of, reconnect or disconnect a ledger — Admin only
  | "access_review"        // v1 phase 1.4: who has access to what, exportable for auditors — a merchant Admin, or a Provider
                           // Admin for the provider's own members
  | "manage_provider_api"  // v1 phase 2.2: connect or disable the merchant's own provider's API (secret references only) — Admin only
  | "sign_posting_rules"   // v1 phase 4: sign a version of the posting rules (with a fresh MFA step-up) — a merchant Admin only
  | "audit_download";      // v1 phase 4: the Auditor's evidence packs, for its granted period (and entities) only, until it expires

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
  manage_policy: ["admin"],
  merchant_reconcile: ["payment_ops", "finance"],
  propose_writeoff: ["finance"],
  review_match: ["payment_ops", "finance", "approver"],
  merchant_investigate: ["payment_ops", "finance"],
  merchant_upload: ["finance", "payment_ops"],
  manage_retention: ["admin"],
  manage_pickup: ["admin"],
  merchant_export: ["finance", "approver", "admin"],
  access_review: ["admin", "provider_admin"],
  ledger_connect: ["admin"],
  manage_provider_api: ["admin"],
  sign_posting_rules: ["admin"],
  audit_download: ["auditor"],
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
