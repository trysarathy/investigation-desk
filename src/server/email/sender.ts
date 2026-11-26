/**
 * The ONE pluggable e-mail sender (v1 phases 1.1 and 1.2, unified at the wave 1 integration). Deliberately minimal:
 * one message, one recipient, `send({ to, subject, text, html?, kind? })`. No real e-mail service is wired in this
 * build; the only implementations are the local outbox (./outbox.ts, the `email_outbox` table) and "disabled". A
 * deployment that adds a provider implements this interface and selects it in ./index.ts; nothing else changes.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** What the message is for, e.g. "invitation" (stored with the message; logs and tests key on it, never the address). */
  kind?: string;
}

export interface EmailSender {
  /** Resolves once the message is accepted for delivery; throws when it is not. Must never log the body (it may hold a one-time link). */
  send(message: EmailMessage): Promise<void>;
}

/** Drops every message (no sender configured). Logs only that a message was dropped, never its recipient or body. */
export const disabledSender: EmailSender = {
  async send() {
    console.warn("clearline-email: no e-mail sender is configured (CLEARLINE_EMAIL_SENDER); a message was not sent");
  },
};

/** Limits shared by every sender (mirrors the outbox table's check constraints). */
export function validMessage(m: EmailMessage): boolean {
  return typeof m.to === "string" && /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(m.to) && m.to.length <= 254
    && typeof m.subject === "string" && m.subject.length > 0 && m.subject.length <= 300 && !/[\r\n]/.test(m.subject)
    && typeof m.text === "string" && m.text.length <= 20_000 && (m.html === undefined || m.html.length <= 50_000)
    && (m.kind === undefined || /^[a-z_]{1,40}$/.test(m.kind));
}
