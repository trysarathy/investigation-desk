import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentPrincipal } from "@/server/auth";
import { TwoFactorChallenge } from "@/components/control/security-forms";
import { AuthFrame } from "@/components/control/AuthFrame";

export const metadata: Metadata = { title: "Second step of sign-in" };

/** After a correct password, for an account with MFA: the code, a recovery code or a passkey. */
export default async function TwoFactorPage() {
  if (await currentPrincipal(await headers())) redirect("/control");
  return (
    <AuthFrame title="Confirm it is you" eyebrow="Sign in · step 2 of 2" otp lede="Your password was right. Now enter the code from your authenticator app."
      foot={<p><a href="/control/sign-in">Start again</a></p>}>
      <TwoFactorChallenge />
    </AuthFrame>
  );
}
