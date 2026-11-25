import "server-only";
import { emailSender } from "./email";

/** How long a reset link works (Better Auth's resetPasswordTokenExpiresIn is set to the same value). */
export const RESET_MINUTES = 30;

/**
 * Better Auth's sendResetPassword callback. The link carries the token in the URL FRAGMENT (#token=...), which
 * browsers never send to a server or put in a Referer header; the reset page reads it in the browser.
 *
 * Sent only to a VERIFIED address (src/server/email-verification.ts): an address an administrator mistyped must
 * never receive a link that takes over the account. The caller's answer is the same either way (no enumeration).
 */
export async function sendPasswordResetEmail(user: { email: string; name: string; emailVerified?: boolean }, token: string): Promise<void> {
  if (!user.emailVerified) return;
  const origin = process.env.CLEARLINE_ORIGIN ?? "";
  const link = `${origin}/control/sign-in/reset#token=${encodeURIComponent(token)}`;
  await emailSender().send({
    to: user.email,
    kind: "password_reset",
    subject: "Reset your Clearline Control password",
    text: [
      `Someone asked to reset the password for ${user.email} on Clearline Control.`,
      "",
      `To choose a new password, open this link within ${RESET_MINUTES} minutes. It works once:`,
      link,
      "",
      "Resetting the password signs you out everywhere. If you did not ask for this, ignore this e-mail; your password stays the same.",
    ].join("\n"),
  });
}
