import type { ReactNode } from "react";
import { pageContext } from "@/server/control-page";
import { ROLE_LABELS } from "@/server/authz";
import { ControlNav } from "@/components/control/Nav";
import { SignOutButton } from "@/components/control/forms";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import s from "@/components/control/control.module.css";
import x from "@/components/control/screens.module.css";
import { ProductMark } from "@/components/control/member-status";

export default async function ControlAppLayout({ children }: { children: ReactNode }) {
  const ctx = await pageContext();
  return (
    <>
      <header className={`${s.header} ${x.appHeader}`}>
        <div className={x.barInner}>
          <div className={x.barLeft}>
            <ProductMark className={x.mark} />
            <p className={x.product}><span>Clearline Control<span className={x.barSub} data-testid="org-name">{ctx.orgName}</span></span></p>
          </div>
          <div className={x.barRight}>
            <ThemeToggle />
            <p data-testid="signed-in-as">
              Signed in as <strong>{ctx.name}</strong> (<span className={x.mono}>{ctx.email}</span>) · {ROLE_LABELS[ctx.role]} · <a href="/control/security">Security</a> · <SignOutButton />
            </p>
          </div>
        </div>
        <ControlNav />
      </header>
      <main className={s.main} id="main">{children}</main>
      <footer className={s.footer}>Clearline does not move money. Provider statuses are provider claims; settlement is shown only from independent evidence.</footer>
    </>
  );
}
