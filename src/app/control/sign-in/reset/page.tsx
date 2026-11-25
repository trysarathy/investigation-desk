import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/control/security-forms";
import s from "@/components/control/control.module.css";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return (
    <main className={s.narrow}>
      <h1 className={s.title}>Choose a new password</h1>
      <div className={s.panel}><ResetPasswordForm /></div>
      <p className={s.small}><a href="/control/sign-in">Back to sign in</a></p>
    </main>
  );
}
