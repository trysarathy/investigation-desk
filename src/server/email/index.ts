import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { disabledSender, type EmailMessage, type EmailSender } from "./sender";
import { outboxSender } from "./outbox";

export type { EmailMessage, EmailSender } from "./sender";

/*
 * Integration (wave 1): B1 (onboarding) and B2 (auth) each added an EmailSender here. Until they are unified in a
 * later slice, both local stand-ins are selectable and both behaviours are kept:
 *   CLEARLINE_EMAIL_SENDER=outbox      -> B2's email_outbox table (the web app may insert, never read)
 *   CLEARLINE_EMAIL_OUTBOX_DIR=<dir>   -> B1's one-JSON-file-per-message folder
 *   neither                            -> B2: messages are dropped with a warning; B1 (required: true): refused, so an
 *                                         invitation is never created that nobody was told about.
 */

export class EmailNotConfigured extends Error {
  constructor() { super("No email sender is configured (set CLEARLINE_EMAIL_SENDER=outbox or CLEARLINE_EMAIL_OUTBOX_DIR for a local outbox)."); }
}

/** B1's local stand-in: one JSON file per message, named `<time>-<id>.json`. */
export class OutboxEmailSender implements EmailSender {
  constructor(readonly dir: string) {}
  async send(message: EmailMessage): Promise<{ id: string }> {
    const id = randomUUID();
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(this.dir, `${Date.now()}-${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), ...message }, null, 2), { mode: 0o600 });
    return { id };
  }
}

/** Every message in an outbox folder, oldest first (tests and the local runbook). */
export async function readOutbox(dir: string): Promise<(EmailMessage & { id: string; at: string })[]> {
  let names: string[];
  try { names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(path.join(dir, n), "utf8"))));
}

let override: EmailSender | undefined;
/** Tests only: replace the sender (pass undefined to restore the configured one). */
export function setEmailSenderForTests(s: EmailSender | undefined) { override = s; }

/** The configured sender. `required: true` refuses (EmailNotConfigured) instead of returning the dropping sender. */
export function emailSender(opts: { required?: boolean } = {}): EmailSender {
  if (override) return override;
  if (process.env.CLEARLINE_EMAIL_SENDER === "outbox") return outboxSender;
  const dir = process.env.CLEARLINE_EMAIL_OUTBOX_DIR;
  if (dir) return new OutboxEmailSender(path.resolve(dir));
  if (opts.required) throw new EmailNotConfigured();
  return disabledSender;
}
