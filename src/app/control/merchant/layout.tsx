import type { CSSProperties, ReactNode } from "react";
import { ROLE_LABELS } from "@/server/authz";
import { merchantPage } from "@/server/merchant-page";
import { SignOutButton } from "@/components/control/forms";
import { MerchantNav, type NavItem } from "@/components/merchant/Nav";
import { DemoChip } from "@/components/merchant/ui";
import m from "@/components/merchant/merchant.module.css";

const MERCHANT_NAV: NavItem[] = [
  { href: "/control/merchant", label: "Daily report" },
  { href: "/control/merchant/payments", label: "Payments" },
  { href: "/control/merchant/exceptions", label: "Exceptions" },
  { href: "/control/merchant/batches", label: "Batches" },
  { href: "/control/merchant/approvals", label: "Approvals" },
  { href: "/control/merchant/month-end", label: "Month-end" },
  { href: "/control/merchant/evidence", label: "Evidence packs" },
  { href: "/control/merchant/accounting", label: "Accounting export" },
];

/**
 * The white-label merchant reconciliation surface. The provider's name, logo placeholder and colours come from the
 * provider organisation's theme (read through merchant_provider_theme(), never its other rows); Clearline appears
 * only in the small print. Every page carries the demo label.
 */
export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const { ctx, shell } = await merchantPage();
  const t = shell.theme;
  const vars = { "--brand": t.primary, "--on-brand": t.onPrimary, "--accent": t.accent } as CSSProperties;
  const nav = shell.kind === "merchant" ? MERCHANT_NAV : [];
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
          <p className={m.brandWho} data-testid="signed-in-as">Signed in as <strong>{ctx.name}</strong> ({ctx.email}) · {ROLE_LABELS[ctx.role]} · <SignOutButton /></p>
        </div>
      </header>
      <aside className={m.demo} aria-label="Data notice"><DemoChip /></aside>
      {nav.length ? <MerchantNav items={nav} label="Merchant reconciliation" /> : null}
      <main className={m.mmain} id="main">{children}</main>
      <footer className={m.mfooter}>
        <p>Read-only reconciliation: nothing here moves money or tokens. Provider statuses are claims, not proof; chain data in this pilot is a recorded fixture. {shell.label}.</p>
        <p className={m.powered}>powered by Clearline</p>
      </footer>
    </div>
  );
}
