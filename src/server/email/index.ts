import "server-only";
import type { Tx } from "../db/client";
import type { ProvTx } from "../db/provisioning";
import { disabledSender, type EmailSender } from "./sender";
import { outboxSender, outboxSenderIn, outboxSenderInProvisioning } from "./outbox";

export type { EmailMessage, EmailSender } from "./sender";

/**
 * The one e-mail sender. CLEARLINE_EMAIL_SENDER=outbox selects the local `email_outbox` table; nothing else is wired
 * (no paid or external service is called from this build). Unconfigured:
 *   - by default messages are dropped with a warning (password reset and e-mail verification answer the same either
 *     way, so a caller learns nothing);
 *   - with `required: true` the sender refuses (EmailNotConfigured), so an invitation is never created that nobody
 *     was told about.
 * `tx` / `prov` bind the outbox to the caller's transaction, so an invitation and its email commit or roll back together.
 *
 * Invitations use `invitationSender` instead: with no sender configured it answers null, and the inviter is shown the
 * one-time link to pass on themselves (src/server/onboarding/invitations.ts, `inviteAndDeliver`).
 */
export class EmailNotConfigured extends Error {
  constructor() { super("No email sender is configured (set CLEARLINE_EMAIL_SENDER=outbox for the local outbox)."); }
}

let override: EmailSender | undefined;
/** Tests only: replace the sender (pass undefined to restore the configured one). */
export function setEmailSenderForTests(s: EmailSender | undefined) { override = s; }

export function emailSender(opts: { required?: boolean; tx?: Pick<Tx, "insert">; prov?: ProvTx } = {}): EmailSender {
  if (override) return override;
  if (process.env.CLEARLINE_EMAIL_SENDER === "outbox") return opts.prov ? outboxSenderInProvisioning(opts.prov) : opts.tx ? outboxSenderIn(opts.tx) : outboxSender;
  if (opts.required) throw new EmailNotConfigured();
  return disabledSender;
}

/** The sender for an invitation, or null when none is configured (the invitation is then delivered as a copyable link). */
export function invitationSender(opts: { tx?: Pick<Tx, "insert">; prov?: ProvTx } = {}): EmailSender | null {
  if (override) return override;
  if (process.env.CLEARLINE_EMAIL_SENDER === "outbox") return emailSender({ ...opts, required: true });
  return null;
}
