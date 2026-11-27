/**
 * v1 phase 5.5: where alerts go. No paid paging service is wired in; the implementations are local stand-ins:
 *   FileAlertSink     one JSON notification per line (CLEARLINE_ALERT_FILE), mode 0600
 *   EmailAlertSink    through the existing pluggable EmailSender (src/server/email): to CLEARLINE_ALERT_EMAIL_TO
 *   LogAlertSink      one structured log line per notification (always on, so an alert is never only in a file)
 * A deployment adding a pager implements AlertSink. Notifications carry counts only (./alerts.ts).
 *
 * Alert state (what was already sent) lives in CLEARLINE_ALERT_STATE_FILE when set, otherwise in the worker's memory
 * (a restart then re-sends each firing alert once).
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmailSender } from "../email/sender";
import type { AlertNotification, AlertSink, AlertState, AlertStateStore } from "./alerts";
import { MemoryAlertStateStore } from "./alerts";
import { log } from "./log";

export class FileAlertSink implements AlertSink {
  constructor(readonly file: string) {}
  async send(n: AlertNotification) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, `${JSON.stringify(n)}\n`, { mode: 0o600 });
  }
}

export class LogAlertSink implements AlertSink {
  async send(n: AlertNotification) {
    (n.state === "firing" ? log.warn : log.info)(n.state === "firing" ? "alert_firing" : "alert_resolved",
      { rule: n.rule, key: n.key, severity: n.severity, since: n.since, summary: n.summary });
  }
}

/** Subject and text from the notification's own fields (counts only; never a customer's data). */
export function alertEmail(n: AlertNotification): { subject: string; text: string } {
  const tag = n.state === "firing" ? `[${n.severity.toUpperCase()}]` : "[RESOLVED]";
  const subject = `${tag} Clearline ${n.environment}: ${n.rule.replace(/_/g, " ")}${n.key.includes(":") ? ` (${n.key.split(":")[1]})` : ""}`.slice(0, 300);
  const text = [
    `${n.state === "firing" ? "Firing" : "Resolved"}: ${n.summary}`,
    `Rule: ${n.rule} · severity ${n.severity} · environment ${n.environment}`,
    `Since: ${n.since} · this notice: ${n.at}`,
    `Runbook: ${n.runbook}`,
    "",
    "This message holds counts only. Look up details in the operator console or the logs, never by replying.",
  ].join("\n");
  return { subject, text };
}

export class EmailAlertSink implements AlertSink {
  constructor(private readonly sender: EmailSender, private readonly to: string[]) {}
  async send(n: AlertNotification) {
    const m = alertEmail(n);
    for (const to of this.to) await this.sender.send({ to, ...m, kind: "ops_alert" });
  }
}

/** Sends to every sink; throws (after trying all) if any failed, so the dispatcher retries next time. */
export class MultiAlertSink implements AlertSink {
  constructor(readonly sinks: AlertSink[]) {}
  async send(n: AlertNotification) {
    let failed = 0;
    for (const s of this.sinks) { try { await s.send(n); } catch (e) { failed++; log.error("alert_sink_failed", e, { sink: s.constructor.name }); } }
    if (failed) throw new Error(`${failed} alert sink(s) failed`);
  }
}

export class FileAlertStateStore implements AlertStateStore {
  constructor(readonly file: string) {}
  async load(): Promise<AlertState> {
    try { return JSON.parse(await readFile(this.file, "utf8")) as AlertState; } catch { return {}; }
  }
  async save(s: AlertState) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
    await rename(tmp, this.file);
  }
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+$/;

/** The configured sinks and state store. Log is always on; file and e-mail are added when configured. */
export function alertSinkFromEnv(env: Record<string, string | undefined>, emailSender: () => EmailSender): { sink: AlertSink; store: AlertStateStore; kinds: string[] } {
  const sinks: AlertSink[] = [new LogAlertSink()];
  const kinds = ["log"];
  if (env.CLEARLINE_ALERT_FILE) { sinks.push(new FileAlertSink(path.resolve(env.CLEARLINE_ALERT_FILE))); kinds.push("file"); }
  const to = (env.CLEARLINE_ALERT_EMAIL_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (to.length) {
    if (!to.every((a) => EMAIL.test(a))) throw new Error("CLEARLINE_ALERT_EMAIL_TO must be a comma-separated list of e-mail addresses");
    sinks.push(new EmailAlertSink(emailSender(), to)); kinds.push("email");
  }
  const store = env.CLEARLINE_ALERT_STATE_FILE ? new FileAlertStateStore(path.resolve(env.CLEARLINE_ALERT_STATE_FILE)) : new MemoryAlertStateStore();
  return { sink: new MultiAlertSink(sinks), store, kinds };
}
