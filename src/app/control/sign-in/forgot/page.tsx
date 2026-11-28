import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/control/security-forms";
import { AuthFrame } from "@/components/control/AuthFrame";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame title="Reset your password" lede="Enter your e-mail address. If it belongs to an account with a verified address, we send a link that works once, for 30 minutes."
      foot={<p><a href="/control/sign-in">Back to sign in</a></p>}>
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
