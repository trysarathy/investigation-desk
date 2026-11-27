import type { CSSProperties, ReactNode } from "react";
import { ROLE_LABELS } from "@/server/authz";
import { merchantPage } from "@/server/merchant-page";
import { unreadCount } from "@/server/notifications";
import { SignOutButton } from "@/components/control/forms";
import { MerchantNav } from "@/components/merchant/Nav";
import { merchantActionsFor, merchantNavFor } from "@/server/merchant-nav";
import { CommandPalette, LiveRefresh, ShortcutSheet, ThemeToggle } from "@/components/ui";
import { DataChip } from "@/components/merchant/ui";
import { DemoBar } from "@/components/merchant/DemoBar";
import m from "@/components/merchant/merchant.module.css";

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
  const nav = merchantNavFor(ctx, shell.kind);
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
          <div className={m.brandTools}>
            {shell.kind === "merchant" ? <CommandPalette pages={nav} actions={merchantActionsFor(ctx, nav)} searchUrl="/api/control/merchant/search" buttonClassName={m.brandButton} /> : <CommandPalette pages={nav} buttonClassName={m.brandButton} />}
            <LiveRefresh />
            <ThemeToggle className={m.brandIcon} />
          </div>
          <p className={m.brandWho} data-testid="signed-in-as">Signed in as <strong>{ctx.name}</strong> ({ctx.email}) · {ROLE_LABELS[ctx.role]}{ctx.entityScope !== null ? <span data-testid="entity-scope"> for {ctx.entityScope.length ? ctx.entityScope.join(", ") : "no entity"} only</span> : null} · {shell.kind === "merchant" ? <><a className={m.bell} href="/control/merchant/notifications" data-testid="bell">Notifications <span className={m.bellCount}>{unread}</span><span className={m.srOnly}> unread</span></a> · </> : null}<a href="/control/security">Security</a> · <SignOutButton /></p>
        </div>
      </header>
      <aside className={m.demo} aria-label="Data notice"><DataChip label={shell.label} /><DemoBar dataMode={shell.dataMode} who={{ userId: ctx.userId, name: ctx.name, email: ctx.email }} /></aside>
      <MerchantNav items={nav} label={shell.kind === "provider" ? "Provider console" : "Merchant reconciliation"} />
      <main className={m.mmain} id="main">{children}</main>
      <ShortcutSheet />
      <footer className={m.mfooter}>
        <p>Read-only reconciliation: nothing here moves money or tokens. Provider statuses are claims, not proof{shell.dataMode === "demo" ? "; imported bank statements are not bank-authenticated; chain data in this demo build is recorded (fictional)" : shell.dataMode === "live" ? "; imported bank statements are not bank-authenticated" : "; chain data in this pilot is a recorded fixture"}. {shell.label}.</p>
        <p className={m.powered}>powered by Clearline</p>
      </footer>
    </div>
  );
}
