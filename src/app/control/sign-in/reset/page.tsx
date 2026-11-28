import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/control/security-forms";
import { AuthFrame } from "@/components/control/AuthFrame";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return (
    <AuthFrame title="Choose a new password" foot={<p><a href="/control/sign-in">Back to sign in</a></p>}>
      <ResetPasswordForm />
    </AuthFrame>
  );
}
