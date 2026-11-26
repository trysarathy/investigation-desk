import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * v1 phase 1.1: the pluggable email sender. Deliberately minimal (one method, one message shape) so the auth emails
 * of phase 1.2 can share it. Clearline never signs up for or calls a real email service in this build: the only
 * sender is the local OUTBOX stand-in, which writes each message as a JSON file to CLEARLINE_EMAIL_OUTBOX_DIR (for
 * tests and local runs; the folder holds one-time links, so it lives under the git-ignored .data/ by convention).
 * Without that setting, `emailSender()` refuses: an invitation is then not created at all (never "sent" silently).
 * A production sender is a later, separate decision; it implements this interface and nothing else changes.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text body. Phase 1.1 sends text only. */
  text: string;
  /** What the message is for, e.g. "invitation" (logs and tests key on it; never the address). */
  kind: string;
}

export interface EmailSender {
  /** Delivers (or queues) the message; resolves with the sender's id for it. Throws when it was not accepted. */
  send(message: EmailMessage): Promise<{ id: string }>;
}

export class EmailNotConfigured extends Error {
  constructor() { super("No email sender is configured (set CLEARLINE_EMAIL_OUTBOX_DIR for the local outbox)."); }
}

/** The local stand-in: one JSON file per message, named `<time>-<id>.json`. */
export class OutboxEmailSender implements EmailSender {
  constructor(readonly dir: string) {}
  async send(message: EmailMessage) {
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
/** Tests may install a sender (e.g. one that fails) for the process. */
export function setEmailSenderForTests(s: EmailSender | undefined) { override = s; }

export function emailSender(): EmailSender {
  if (override) return override;
  const dir = process.env.CLEARLINE_EMAIL_OUTBOX_DIR;
  if (!dir) throw new EmailNotConfigured();
  return new OutboxEmailSender(path.resolve(dir));
}
