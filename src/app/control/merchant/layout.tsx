import type { CSSProperties, ReactNode } from "react";
import { ROLE_LABELS, can } from "@/server/authz";
import { merchantPage } from "@/server/merchant-page";
import { unreadCount } from "@/server/notifications";
import { SignOutButton } from "@/components/control/forms";
import { MerchantNav, type NavItem } from "@/components/merchant/Nav";
import { DataChip } from "@/components/merchant/ui";
import m from "@/components/merchant/merchant.module.css";

const MERCHANT_NAV: NavItem[] = [
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
  { href: "/control/merchant/pilot", label: "Pilot metrics" },
  { href: "/control/merchant/settings", label: "Settings" },
];

const PROVIDER_NAV: NavItem[] = [
  { href: "/control/merchant/provider", label: "Merchants" },
  { href: "/control/merchant/provider/onboarding", label: "Onboarding" },
  { href: "/control/merchant/provider/pilot", label: "Pilot metrics" },
];

/**
 * The white-label merchant reconciliation surface. The provider's name, logo placeholder and colours come from the
 * provider organisation's theme (read through merchant_provider_theme(), never its other rows); Clearline appears
 * only in the small print. Every page carries the organisation's data label (rc7: the demo label for sample data,
 * "Your data" for a live merchant).
 */
export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const { ctx, shell } = await merchantPage();
  const t = shell.theme;
  const vars = { "--brand": t.primary, "--on-brand": t.onPrimary, "--accent": t.accent } as CSSProperties;
  const nav = shell.kind === "merchant" ? [...MERCHANT_NAV, ...(can(ctx.role, "manage_members") ? [{ href: "/control/merchant/admin", label: "Admin" }] : [])] : PROVIDER_NAV;
  const unread = shell.kind === "merchant" ? await unreadCount(ctx) : 0;
  return (
    <div className={m.mroot} style={vars}>
      <a className={m.skip} href="#main">Skip to content</a>
      <header className={m.brandBar}>
        <div className={m.brandInner}>
          <div className={m.brandLeft}>
            <span className={m.logo} role="img" aria-label={t.logoAlt} data-testid="brand-logo">{t.logoText}</span>
            <div>
              <p className={m.brandName} data-testid="brand-name">{t.name}</p>
              <p className={m.brandSub} data-testid="org-name">{shell.kind === "provider" ? "Provider console" : `Merchant reconciliation · ${ctx.orgName}`}</p>
            </div>
          </div>
          <p className={m.brandWho} data-testid="signed-in-as">Signed in as <strong>{ctx.name}</strong> ({ctx.email}) · {ROLE_LABELS[ctx.role]} · {shell.kind === "merchant" ? <><a className={m.bell} href="/control/merchant/notifications" data-testid="bell" aria-label={`Notifications: ${unread} unread`}>Notifications<span className={m.bellCount} aria-hidden="true">{unread}</span></a> · </> : null}<SignOutButton /></p>
        </div>
      </header>
      <aside className={m.demo} aria-label="Data notice"><DataChip label={shell.label} /></aside>
      <MerchantNav items={nav} label={shell.kind === "provider" ? "Provider console" : "Merchant reconciliation"} />
      <main className={m.mmain} id="main">{children}</main>
      <footer className={m.mfooter}>
        <p>Read-only reconciliation: nothing here moves money or tokens. Provider statuses are claims, not proof{shell.dataMode === "live" ? "; imported bank statements are not bank-authenticated" : "; chain data in this pilot is a recorded fixture"}. {shell.label}.</p>
        <p className={m.powered}>powered by Clearline</p>
      </footer>
    </div>
  );
}
