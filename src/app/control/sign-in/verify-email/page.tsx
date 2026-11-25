import type { Metadata } from "next";
import { VerifyEmailForm } from "@/components/control/security-forms";
import s from "@/components/control/control.module.css";

export const metadata: Metadata = { title: "Verify e-mail address", referrer: "no-referrer" };

export default function VerifyEmailPage() {
  return (
    <main className={s.narrow}>
      <h1 className={s.title}>Verify your e-mail address</h1>
      <div className={s.panel}><VerifyEmailForm /></div>
      <p className={s.small}><a href="/control">Go to Clearline Control</a></p>
    </main>
  );
}
