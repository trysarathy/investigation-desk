import type { Metadata } from "next";
import { AuthFrame } from "@/components/control/AuthFrame";
import { AcceptInvitationForm } from "@/components/onboarding/forms";

export const metadata: Metadata = { title: "Accept invitation" };

/** v1 phase 1.1: invite-only onboarding. The one-time token is in the link's #fragment; the form sends it once. */
export default function InvitePage() {
  return (
    <AuthFrame title="Accept your invitation" eyebrow="Invitation"
      lede="Clearline is invite-only: an administrator sent you this one-time link. Choose your name and password to join, then sign in. Admins and Approvers set up multi-factor sign-in at their first sign-in."
      foot={<p>The link works once and expires after three days. Nothing happens unless you accept.</p>}>
      <AcceptInvitationForm />
    </AuthFrame>
  );
}
