import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentPrincipal } from "@/server/auth";
import { SignInForm } from "@/components/control/forms";
import s from "@/components/control/control.module.css";
import { demoBuild } from "@/server/demo-build";
import { DEMO_DATA_LABEL } from "@/lib/clearline/data-mode";

export const metadata: Metadata = { title: "Sign in" };

/** Accounts are created by an administrator; there is no sign-up. */
export default async function SignInPage() {
  if (await currentPrincipal(await headers())) redirect("/control");
  return (
    <main className={s.narrow}>
      <h1 className={s.title}>Clearline Control</h1>
      <p className={s.lede}>Sign in with the account your administrator created for you.</p>
      <div className={s.panel}>
        <SignInForm />
      </div>
      <p className={`${s.small} ${s.muted}`}>Private staging. Every organisation, person and payment here is fictional.</p>
      {demoBuild() ? <p className={s.small} data-testid="data-label">{DEMO_DATA_LABEL}: sign in with one of the demo logins that <code>npm run demo</code> printed.</p> : null}
    </main>
  );
}
