import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/control/security-forms";
import s from "@/components/control/control.module.css";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <main className={s.narrow}>
      <h1 className={s.title}>Reset your password</h1>
      <p className={s.lede}>Enter your e-mail address. If it belongs to an account with a verified address, we send a link that works once, for 30 minutes.</p>
      <div className={s.panel}><ForgotPasswordForm /></div>
      <p className={s.small}><a href="/control/sign-in">Back to sign in</a></p>
    </main>
  );
}
