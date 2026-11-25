import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentPrincipal } from "@/server/auth";
import { TwoFactorChallenge } from "@/components/control/security-forms";
import s from "@/components/control/control.module.css";

export const metadata: Metadata = { title: "Second step of sign-in" };

/** After a correct password, for an account with MFA: the code, a recovery code or a passkey. */
export default async function TwoFactorPage() {
  if (await currentPrincipal(await headers())) redirect("/control");
  return (
    <main className={s.narrow}>
      <h1 className={s.title}>Confirm it is you</h1>
      <p className={s.lede}>Your password was right. Now enter the code from your authenticator app.</p>
      <div className={s.panel}><TwoFactorChallenge /></div>
      <p className={s.small}><a href="/control/sign-in">Start again</a></p>
    </main>
  );
}
