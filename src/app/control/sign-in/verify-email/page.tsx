import type { Metadata } from "next";
import { VerifyEmailForm } from "@/components/control/security-forms";
import { AuthFrame } from "@/components/control/AuthFrame";

export const metadata: Metadata = { title: "Verify e-mail address", referrer: "no-referrer" };

export default function VerifyEmailPage() {
  return (
    <AuthFrame title="Verify your e-mail address" foot={<p><a href="/control">Go to Clearline Control</a></p>}>
      <VerifyEmailForm />
    </AuthFrame>
  );
}
