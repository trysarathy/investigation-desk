import type { ReactNode } from "react";
import { pageContext } from "@/server/control-page";
import { ROLE_LABELS } from "@/server/authz";
import { ControlNav } from "@/components/control/Nav";
import { SignOutButton } from "@/components/control/forms";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import s from "@/components/control/control.module.css";

export default async function ControlAppLayout({ children }: { children: ReactNode }) {
  const ctx = await pageContext();
  return (
    <>
      <header className={s.header}>
        <div className={s.headerInner}>
          <p className={s.brand}>Clearline Control<span className={s.brandOrg} data-testid="org-name">{ctx.orgName}</span></p>
          <ThemeToggle />
          <p className={s.who} data-testid="signed-in-as">
            Signed in as <strong>{ctx.name}</strong> ({ctx.email}) · {ROLE_LABELS[ctx.role]} · <a href="/control/security">Security</a> · <SignOutButton />
          </p>
        </div>
        <ControlNav />
      </header>
      <main className={s.main} id="main">{children}</main>
      <footer className={s.footer}>Clearline does not move money. Provider statuses are provider claims; settlement is shown only from independent evidence.</footer>
    </>
  );
}
