import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decide, healthResponse, readyResponse, workerStaleSeconds } from "@/server/ops/health";
import { loadIncidents, statusView } from "@/server/ops/status";
import { readBackupStatus } from "@/server/ops/monitor";
import { PUBLIC_STATUS_PATHS, deploymentGate } from "@/middleware";
import { setLogWriterForTests } from "@/server/ops/log";

const NOW = new Date("2026-11-25T10:00:00Z");
const tmp = () => mkdtempSync(path.join(tmpdir(), "xe4-health-"));
afterEach(() => setLogWriterForTests(undefined));

describe("backup status file", () => {
  it("reads ok/failed, and treats missing or malformed as unknown", async () => {
    const dir = tmp();
    try {
      const f = path.join(dir, "backup-status.json");
      writeFileSync(f, JSON.stringify({ lastRunAt: "2026-11-25T02:00:00Z", lastStatus: "ok", lastSuccessAt: "2026-11-25T02:00:00Z" }));
      expect(await readBackupStatus(f)).toEqual({ lastRunAt: "2026-11-25T02:00:00Z", lastStatus: "ok", lastSuccessAt: "2026-11-25T02:00:00Z" });
      writeFileSync(f, "{not json");
      expect(await readBackupStatus(f)).toEqual({ lastRunAt: null, lastStatus: "unknown", lastSuccessAt: null });
      expect((await readBackupStatus(path.join(dir, "none.json"))).lastStatus).toBe("unknown");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("uptime checks", () => {
  it("decide: database and worker states", () => {
    expect(decide("unreachable", NOW, 300)).toEqual({ database: "fail", worker: "stale" });
    expect(decide(null, NOW, 300)).toEqual({ database: "ok", worker: "stale" });
    expect(decide(new Date(NOW.getTime() - 299_000), NOW, 300)).toEqual({ database: "ok", worker: "ok" });
    expect(workerStaleSeconds({ CLEARLINE_WORKER_STALE_SECONDS: "5" })).toBe(300);
    expect(workerStaleSeconds({ CLEARLINE_WORKER_STALE_SECONDS: "600" })).toBe(600);
  });
  it("/api/health fails only on the database; /api/ready needs the worker too; neither leaks detail", async () => {
    const fresh = async () => new Date();
    const stale = async () => new Date(Date.now() - 3_600_000);
    const down = async (): Promise<Date> => { throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password authentication failed for clearline_runtime"); };
    const body = async (r: Response) => ({ status: r.status, json: await r.json(), cache: r.headers.get("cache-control") });
    expect(await body(await healthResponse(fresh))).toEqual({ status: 200, json: { status: "ok", checks: { database: "ok", worker: "ok" } }, cache: "no-store" });
    expect(await body(await healthResponse(stale))).toMatchObject({ status: 200, json: { status: "degraded" } });
    const h = await healthResponse(down);
    expect(h.status).toBe(503);
    expect(await h.text()).toBe('{"status":"down","checks":{"database":"fail","worker":"stale"}}');
    expect(await body(await readyResponse(fresh))).toMatchObject({ status: 200, json: { status: "ready" } });
    expect(await body(await readyResponse(stale))).toMatchObject({ status: 503, json: { status: "not_ready", checks: { database: "ok", worker: "stale" } } });
    expect((await readyResponse(down)).status).toBe(503);
  });
});

describe("status page data", () => {
  const ok = { database: "ok", worker: "ok" } as const;
  it("components follow the checks; open incidents can only make things look worse", () => {
    expect(statusView(ok, { ok: true, incidents: [] }, NOW).overall).toBe("operational");
    expect(statusView({ database: "ok", worker: "stale" }, { ok: true, incidents: [] }, NOW).components.find((c) => c.id === "jobs")?.state).toBe("degraded");
    const v = statusView({ database: "fail", worker: "stale" }, { ok: true, incidents: [] }, NOW);
    expect(v.overall).toBe("outage");
    const inc = { id: "i1", title: "Chain data delayed", status: "identified", impact: "minor", components: ["chain_data"], startedAt: NOW.toISOString(), updates: [] } as const;
    expect(statusView(ok, { ok: true, incidents: [{ ...inc, components: [...inc.components], updates: [] }] }, NOW).components.find((c) => c.id === "chain_data")?.state).toBe("degraded");
    expect(statusView(ok, { ok: true, incidents: [{ ...inc, status: "resolved", components: [...inc.components], updates: [] }] }, NOW).overall).toBe("operational");
  });
  it("incidents file: valid, recent only; invalid or markup is never shown half-parsed", async () => {
    setLogWriterForTests(() => undefined);
    const dir = tmp();
    try {
      const f = path.join(dir, "incidents.json");
      writeFileSync(f, JSON.stringify({ incidents: [
        { id: "old", title: "Old", status: "resolved", impact: "minor", startedAt: "2026-10-01T00:00:00Z", resolvedAt: "2026-10-01T01:00:00Z" },
        { id: "recent", title: "Recent", status: "resolved", impact: "minor", startedAt: "2026-11-20T00:00:00Z", resolvedAt: "2026-11-20T01:00:00Z" },
        { id: "open", title: "Open", status: "investigating", impact: "major", components: ["jobs"], startedAt: "2026-11-25T09:00:00Z",
          updates: [{ at: "2026-11-25T09:05:00Z", status: "investigating", text: "Looking into it." }, { at: "2026-11-25T09:30:00Z", status: "identified", text: "Found it." }] },
      ] }));
      const r = await loadIncidents(f, NOW);
      expect(r.ok && r.incidents.map((i) => i.id)).toEqual(["open", "recent"]);
      expect(r.ok && r.incidents[0].updates.map((u) => u.text)).toEqual(["Found it.", "Looking into it."]);
      writeFileSync(f, JSON.stringify({ incidents: [{ id: "x", title: "<script>", status: "investigating", impact: "minor", startedAt: "2026-11-25T09:00:00Z" }] }));
      expect(await loadIncidents(f, NOW)).toEqual({ ok: false });
      expect(await loadIncidents(path.join(dir, "missing.json"), NOW)).toEqual({ ok: false });
      expect(await loadIncidents(undefined, NOW)).toEqual({ ok: true, incidents: [] });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("deployment gate: the status paths (approval-only flag)", () => {
  const MODES: Record<string, Record<string, string>> = {
    pilot: { CLEARLINE_CONTROL_PILOT: "1" }, "customer preview": { CLEARLINE_CUSTOMER_PREVIEW: "1" }, "funding only": { CLEARLINE_FUNDING_ONLY: "1" },
    "basic auth": { PREVIEW_USER: "u", PREVIEW_PASSWORD: "fictional-pw-123" }, "full app": {},
  };
  it("without CLEARLINE_PUBLIC_STATUS=1 every mode answers exactly as before", () => {
    for (const env of Object.values(MODES)) for (const p of PUBLIC_STATUS_PATHS) {
      expect(deploymentGate(p, null, env)).toEqual(deploymentGate(p, null, { ...env, CLEARLINE_PUBLIC_STATUS: "0" }));
    }
    expect(deploymentGate("/api/ready", null, MODES.pilot)).toEqual({ action: "not_found", noStore: true });
  });
  it("with it, only the three status paths pass (bare layout); nothing else changes", () => {
    for (const env of Object.values(MODES)) {
      for (const p of PUBLIC_STATUS_PATHS) expect(deploymentGate(p, null, { ...env, CLEARLINE_PUBLIC_STATUS: "1" })).toEqual({ action: "next", consoleShell: true });
      for (const p of ["/", "/control", "/api/control/org", "/status/x", "/api/healthz", "/api/ready/", "/STATUS", "/funding"]) {
        expect(deploymentGate(p, null, { ...env, CLEARLINE_PUBLIC_STATUS: "1" })).toEqual(deploymentGate(p, null, env));
      }
    }
  });
});
