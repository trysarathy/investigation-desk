import "server-only";
import { database } from "../db/client";
import { emailOutbox } from "../db/schema";
import { validMessage, type EmailMessage, type EmailSender } from "./sender";

/**
 * The LOCAL stand-in sender: writes each message to the `email_outbox` table instead of sending it. For tests, local
 * development and private staging only. The web app's database role may INSERT here but never read (a message holds a
 * one-time link); tests and an operator read the outbox as the schema owner (drizzle/0051).
 */
export const outboxSender: EmailSender = {
  async send(m: EmailMessage) {
    if (!validMessage(m)) throw new Error("clearline-email: message refused (recipient, subject or size)");
    await database().insert(emailOutbox).values({ toAddress: m.to, subject: m.subject, textBody: m.text, htmlBody: m.html ?? null });
  },
};
