import "server-only";
import { can } from "./authz";
import type { TenantContext } from "./tenant";

export interface NavItem { href: string; label: string }

const MERCHANT_NAV: NavItem[] = [
  { href: "/control/merchant/getting-started", label: "Get started" },
  { href: "/control/merchant/overview", label: "Overview" },
  { href: "/control/merchant", label: "Daily report" },
  { href: "/control/merchant/payments", label: "Payments" },
  { href: "/control/merchant/exceptions", label: "Exceptions" },
  { href: "/control/merchant/batches", label: "Batches" },
  { href: "/control/merchant/uploads", label: "Uploads" },
  { href: "/control/merchant/runs", label: "Runs" },
  { href: "/control/merchant/approvals", label: "Approvals" },
  { href: "/control/merchant/notifications", label: "Notifications" },
  { href: "/control/merchant/month-end", label: "Month-end" },
  { href: "/control/merchant/evidence", label: "Evidence packs" },
  { href: "/control/merchant/accounting", label: "Accounting export" },
  { href: "/control/merchant/ledger", label: "Ledger" },
  { href: "/control/merchant/posting-rules", label: "Posting rules" },
  { href: "/control/merchant/pilot", label: "Pilot metrics" },
  { href: "/control/merchant/settings", label: "Settings" },
];

const PROVIDER_NAV: NavItem[] = [
  { href: "/control/merchant/provider", label: "Merchants" },
  { href: "/control/merchant/provider/onboarding", label: "Onboarding" },
  { href: "/control/merchant/provider/pilot", label: "Pilot metrics" },
];

/**
 * The merchant workspace menu for this member's role (moved unchanged from the merchant layout so the command palette
 * uses the very same filtering): the nav shows these pages and the palette offers only these.
 */
export function merchantNavFor(ctx: Pick<TenantContext, "role" | "entityScope">, kind: "merchant" | "provider"): NavItem[] {
  // rc8 founder decision 3: the evidence packs page is listed only for the roles that may download them
  const merchantNav = MERCHANT_NAV.filter((i) => i.href !== "/control/merchant/evidence" || can(ctx.role, "merchant_export"));
  // v1 phase 1.4: the access review, for an Admin of the merchant or the provider with access to every entity
  const review = can(ctx.role, "access_review") && ctx.entityScope === null ? [{ href: "/control/merchant/access-review", label: "Access review" }] : [];
  // v1 phase 4: an Auditor sees only its own page
  return can(ctx.role, "audit_download") ? [{ href: "/control/merchant/audit", label: "Audit" }] : kind === "merchant" ? [...merchantNav, ...(can(ctx.role, "manage_members") ? [...((process.env.DATABASE_PROVISIONING_URL || process.env.CLEARLINE_DB_FROM_NEON === "1") && ctx.entityScope === null ? [{ href: "/control/merchant/setup", label: "Setup" }] : []), { href: "/control/merchant/admin", label: "Admin" }] : []), ...review] : [...PROVIDER_NAV, ...review];
}

/** Command-palette actions this role may take: links to the page where the work starts. Never approve (no shortcut, no palette entry). */
export function merchantActionsFor(ctx: Pick<TenantContext, "role">, nav: readonly NavItem[]): NavItem[] {
  const has = (href: string) => nav.some((i) => i.href === href);
  return [
    ...(can(ctx.role, "merchant_upload") && has("/control/merchant/uploads") ? [{ href: "/control/merchant/uploads", label: "Upload a file" }] : []),
    ...(can(ctx.role, "investigate") && has("/control/merchant/exceptions") ? [{ href: "/control/merchant/exceptions", label: "Work the open exceptions" }] : []),
    ...(has("/control/merchant/month-end") ? [{ href: "/control/merchant/month-end", label: "Check the month-end close" }] : []),
  ];
}
