import "server-only";
import { database, type Tx } from "../db/client";
import { emailOutbox } from "../db/schema";
import type { ProvTx } from "../db/provisioning";
import { validMessage, type EmailMessage, type EmailSender } from "./sender";

/**
 * The LOCAL stand-in sender: writes each message to the `email_outbox` table instead of sending it. For tests, local
 * development and private staging only. The web app's database role may INSERT here but never read (a message holds a
 * one-time link); tests and an operator read the outbox as the schema owner (drizzle/0051).
 */
const refuse = () => new Error("clearline-email: message refused (recipient, subject, size or kind)");
const row = (m: EmailMessage) => ({ toAddress: m.to, subject: m.subject, textBody: m.text, htmlBody: m.html ?? null, kind: m.kind ?? null });

/** On the web app's own connection (password reset, e-mail verification). */
export const outboxSender: EmailSender = {
  async send(m: EmailMessage) {
    if (!validMessage(m)) throw refuse();
    await database().insert(emailOutbox).values(row(m));
  },
};

/** Inside an owner transaction (the operator's admin CLI): the message commits or rolls back with that transaction. */
export function outboxSenderIn(tx: Pick<Tx, "insert">): EmailSender {
  return { async send(m) { if (!validMessage(m)) throw refuse(); await tx.insert(emailOutbox).values(row(m)); } };
}

/**
 * Inside a provisioning transaction (platform console, setup wizard): the provisioning role holds no table privilege, so
 * the invitation email is queued by prov_queue_invitation_email (drizzle/0068), which accepts it only for an invitation
 * created in that same transaction. Invitations only; html is not used by them.
 */
export function outboxSenderInProvisioning(tx: ProvTx): EmailSender {
  return {
    async send(m) {
      if (!validMessage(m) || m.kind !== "invitation" || m.html !== undefined) throw refuse();
      await tx.call("prov_queue_invitation_email", [m.to, m.subject, m.text]);
    },
  };
}
