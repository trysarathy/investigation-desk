import type { Metadata } from "next";
import s from "@/components/control/control.module.css";
import { AcceptInvitationForm } from "@/components/onboarding/forms";

export const metadata: Metadata = { title: "Accept invitation" };

/** v1 phase 1.1: invite-only onboarding. The one-time token is in the link's #fragment; the form sends it once. */
export default function InvitePage() {
  return (
    <main className={s.narrow} id="main">
      <h1 className={s.title}>Accept your invitation</h1>
      <p className={s.lede}>Clearline is invite-only: an administrator invited you by email. Choose your password to join; then sign in.</p>
      <div className={s.panel}>
        <AcceptInvitationForm />
      </div>
      <p className={`${s.small} ${s.muted}`}>The link works once and expires after three days. Nothing happens unless you accept.</p>
    </main>
  );
}
