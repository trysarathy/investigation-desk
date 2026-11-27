import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, MemoryAlertStateStore, dispatch, evaluate, thresholdsFromEnv, type AlertMetrics, type AlertNotification, type AlertSink } from "@/server/ops/alerts";
import { EmailAlertSink, FileAlertSink, FileAlertStateStore, MultiAlertSink, alertEmail, alertSinkFromEnv } from "@/server/ops/alert-sinks";
import { setLogWriterForTests } from "@/server/ops/log";
import type { EmailMessage } from "@/server/email/sender";

const NOW = new Date("2026-11-25T10:00:00Z");
const quiet = (over: Partial<AlertMetrics> = {}): AlertMetrics => ({
  at: NOW, windowMinutes: 15, failedRuns: 0, deadJobs: 0, loginFailures: 0, mfaFailures: 0, queuedDue: 0, oldestDueSeconds: 0,
  workerLastSeen: new Date(NOW.getTime() - 30_000), chain: {}, backup: { lastRunAt: "2026-11-25T02:00:00Z", lastStatus: "ok", lastSuccessAt: "2026-11-25T02:00:00Z" }, ...over,
});
const tmp = () => mkdtempSync(path.join(tmpdir(), "xe4-alerts-"));
afterEach(() => setLogWriterForTests(undefined));

describe("alert rules", () => {
  it("a quiet system raises nothing", () => expect(evaluate(quiet())).toEqual([]));
  it("failed runs and dead jobs", () => {
    expect(evaluate(quiet({ failedRuns: 1 })).map((a) => a.rule)).toEqual(["failed_runs"]);
    expect(evaluate(quiet({ deadJobs: 2 }))[0]).toMatchObject({ severity: "high", summary: "0 failed reconciliation run(s) and 2 dead job(s) in the last 15 min" });
  });
  it("failed-login spike at the threshold, counting passwords and second factors together", () => {
    expect(evaluate(quiet({ loginFailures: 20, mfaFailures: 9 }))).toEqual([]);
    expect(evaluate(quiet({ loginFailures: 20, mfaFailures: 10 })).map((a) => a.rule)).toEqual(["failed_login_spike"]);
  });
  it("job backlog by size or by age", () => {
    expect(evaluate(quiet({ queuedDue: 50 })).map((a) => a.rule)).toEqual(["job_backlog"]);
    expect(evaluate(quiet({ queuedDue: 1, oldestDueSeconds: 1800 }))[0].summary).toBe("1 due job(s) waiting; the oldest for 30 min");
    expect(evaluate(quiet({ queuedDue: 49, oldestDueSeconds: 1799 }))).toEqual([]);
  });
  it("worker down: never seen, or stale", () => {
    expect(evaluate(quiet({ workerLastSeen: null }))[0]).toMatchObject({ rule: "worker_down", summary: "no job worker has ever reported a pass" });
    expect(evaluate(quiet({ workerLastSeen: new Date(NOW.getTime() - 301_000) }))[0].rule).toBe("worker_down");
    expect(evaluate(quiet({ workerLastSeen: new Date(NOW.getTime() - 300_000) }))).toEqual([]);
  });
  it("chain provider outage per network, only with enough reads", () => {
    const a = evaluate(quiet({ chain: { tron: { total: 10, unavailable: 5 }, ethereum: { total: 10, unavailable: 4 }, base: { total: 4, unavailable: 4 } } }));
    expect(a.map((x) => x.key)).toEqual(["chain_provider_outage:tron"]);
    expect(a[0].summary).toBe("tron: 5 of 10 chain reads unavailable in the last 15 min");
    expect(evaluate(quiet({ chain: { "Bad Name": { total: 99, unavailable: 99 } } }))).toEqual([]);
  });
  it("backup failure: failed, too old, never succeeded; not monitored when no status file is configured", () => {
    expect(evaluate(quiet({ backup: { lastRunAt: null, lastStatus: "failed", lastSuccessAt: "2026-11-25T02:00:00Z" } }))[0].summary).toBe("the last backup run failed");
    expect(evaluate(quiet({ backup: { lastRunAt: null, lastStatus: "ok", lastSuccessAt: "2026-11-24T07:00:00Z" } }))[0].summary).toBe("no successful backup for 27 h (limit 26 h)");
    expect(evaluate(quiet({ backup: { lastRunAt: null, lastStatus: "unknown", lastSuccessAt: null } }))[0].summary).toBe("no successful backup is recorded");
    expect(evaluate(quiet({ backup: null }))).toEqual([]);
  });
  it("every alert names a runbook that exists", () => {
    const all = evaluate(quiet({ failedRuns: 1, loginFailures: 99, queuedDue: 99, workerLastSeen: null, chain: { tron: { total: 9, unavailable: 9 } }, backup: { lastRunAt: null, lastStatus: "failed", lastSuccessAt: null } }));
    expect(all.map((a) => a.rule)).toEqual(["failed_runs", "failed_login_spike", "job_backlog", "worker_down", "chain_provider_outage", "backup_failure"]);
    for (const a of all) expect(() => readFileSync(path.join(__dirname, "../..", a.runbook))).not.toThrow();
  });
  it("thresholds from env; invalid values keep the default", () => {
    expect(thresholdsFromEnv({ CLEARLINE_ALERT_FAILED_LOGINS: "5", CLEARLINE_ALERT_CHAIN_UNAVAILABLE_SHARE: "7", CLEARLINE_ALERT_BACKLOG_JOBS: "x" }))
      .toEqual({ ...DEFAULT_THRESHOLDS, failedLogins: 5 });
  });
});

class Capture implements AlertSink {
  sent: AlertNotification[] = [];
  fail = false;
  async send(n: AlertNotification) { if (this.fail) throw new Error("down"); this.sent.push(n); }
}

describe("dispatch: only changes are sent", () => {
  it("fires once, stays quiet, re-notifies after the interval, resolves once", async () => {
    const store = new MemoryAlertStateStore(); const sink = new Capture();
    const firing = evaluate(quiet({ failedRuns: 1 }));
    expect(await dispatch(firing, store, sink, { now: NOW })).toEqual({ firing: 1, sent: 1, resolved: 0, failed: 0 });
    expect(await dispatch(firing, store, sink, { now: new Date(NOW.getTime() + 60_000) })).toMatchObject({ sent: 0 });
    const later = new Date(NOW.getTime() + 241 * 60_000);
    expect(await dispatch(firing, store, sink, { now: later })).toMatchObject({ sent: 1 });
    expect(sink.sent[1]).toMatchObject({ state: "firing", since: NOW.toISOString() });
    expect(await dispatch([], store, sink, { now: later, environment: "staging" })).toMatchObject({ resolved: 1 });
    expect(sink.sent[2]).toMatchObject({ state: "resolved", rule: "failed_runs", since: NOW.toISOString(), environment: "staging" });
    expect(await dispatch([], store, sink, { now: later })).toMatchObject({ resolved: 0, sent: 0 });
  });
  it("a failing sink is retried next time (state not advanced)", async () => {
    const store = new MemoryAlertStateStore(); const sink = new Capture(); sink.fail = true;
    const firing = evaluate(quiet({ deadJobs: 1 }));
    expect(await dispatch(firing, store, sink, { now: NOW })).toMatchObject({ sent: 0, failed: 1 });
    sink.fail = false;
    expect(await dispatch(firing, store, sink, { now: NOW })).toMatchObject({ sent: 1, failed: 0 });
  });
  it("file sink and file state store survive a restart", async () => {
    const dir = tmp();
    try {
      const sink = new FileAlertSink(path.join(dir, "alerts.jsonl"));
      const firing = evaluate(quiet({ failedRuns: 1 }));
      await dispatch(firing, new FileAlertStateStore(path.join(dir, "state.json")), sink, { now: NOW });
      await dispatch(firing, new FileAlertStateStore(path.join(dir, "state.json")), sink, { now: NOW }); // a "restarted" worker: no repeat
      const lines = readFileSync(path.join(dir, "alerts.jsonl"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ state: "firing", rule: "failed_runs" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("e-mail goes through the pluggable EmailSender, with counts only", async () => {
    const msgs: EmailMessage[] = [];
    const sink = new EmailAlertSink({ async send(m) { msgs.push(m); } }, ["oncall@example.test", "backup@example.test"]);
    await dispatch(evaluate(quiet({ chain: { tron: { total: 8, unavailable: 8 } } })), new MemoryAlertStateStore(), sink, { now: NOW, environment: "staging" });
    expect(msgs.map((m) => m.to)).toEqual(["oncall@example.test", "backup@example.test"]);
    expect(msgs[0]).toMatchObject({ subject: "[HIGH] Clearline staging: chain provider outage (tron)", kind: "ops_alert" });
    expect(msgs[0].text).toContain("tron: 8 of 8 chain reads unavailable");
    expect(msgs[0].text).toContain("docs/runbooks/CHAIN_PROVIDER_OUTAGE.md");
    expect(alertEmail({ ...({} as AlertNotification), state: "resolved", rule: "worker_down", key: "worker_down", severity: "high", summary: "s", runbook: "r", at: "a", since: "b", environment: "local" }).subject).toBe("[RESOLVED] Clearline local: worker down");
  });
  it("sinks from env: log always, file and e-mail when set; a bad address list is refused", () => {
    setLogWriterForTests(() => undefined);
    expect(alertSinkFromEnv({}, () => ({ async send() {} })).kinds).toEqual(["log"]);
    expect(alertSinkFromEnv({ CLEARLINE_ALERT_FILE: "/tmp/a.jsonl", CLEARLINE_ALERT_EMAIL_TO: "a@example.test" }, () => ({ async send() {} })).kinds).toEqual(["log", "file", "email"]);
    expect(() => alertSinkFromEnv({ CLEARLINE_ALERT_EMAIL_TO: "not an address" }, () => ({ async send() {} }))).toThrow();
  });
  it("a multi-sink tries every sink and then reports the failure", async () => {
    setLogWriterForTests(() => undefined);
    const a = new Capture(); a.fail = true; const b = new Capture();
    await expect(new MultiAlertSink([a, b]).send({ state: "firing" } as AlertNotification)).rejects.toThrow("1 alert sink(s) failed");
    expect(b.sent).toHaveLength(1);
  });
});
