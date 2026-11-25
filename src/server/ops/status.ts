import "server-only";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { runChecks, type HealthChecks, type LastSeenReader } from "./health";
import { log } from "./log";

/**
 * v1 phase 5.5: the public status page's data. Two sources only:
 *   - the uptime checks (./health.ts): web app (this page rendered), database, background jobs;
 *   - an incidents file the operator edits by hand (CLEARLINE_STATUS_INCIDENTS_FILE, JSON; see
 *     docs/runbooks/INCIDENT_RESPONSE.md). Its text is published as written: it must never name a customer, a person,
 *     an address or an amount. Open incidents and those resolved in the last 14 days are shown.
 * An unreadable or invalid file is never shown half-parsed: the page says incident notes are unavailable.
 */
const STATUS = z.enum(["investigating", "identified", "monitoring", "resolved"]);
const IMPACT = z.enum(["none", "minor", "major"]);
const iso = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "not a date");
const text = (max: number) => z.string().min(1).max(max).refine((s) => !/[<>]/.test(s), "no markup");

export const IncidentsFile = z.object({
  incidents: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    title: text(160),
    status: STATUS,
    impact: IMPACT,
    components: z.array(z.enum(["web", "database", "jobs", "chain_data", "email"])).max(5).default([]),
    startedAt: iso,
    resolvedAt: iso.optional(),
    updates: z.array(z.object({ at: iso, status: STATUS, text: text(1000) })).max(30).default([]),
  })).max(50),
});
export type Incident = z.infer<typeof IncidentsFile>["incidents"][number];

export const COMPONENTS = { web: "Web app", database: "Database", jobs: "Background jobs (scheduled runs)", chain_data: "Chain data", email: "E-mail" } as const;
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

export type Incidents = { ok: true; incidents: Incident[] } | { ok: false };

export async function loadIncidents(file = process.env.CLEARLINE_STATUS_INCIDENTS_FILE, now = new Date()): Promise<Incidents> {
  if (!file) return { ok: true, incidents: [] };
  try {
    const parsed = IncidentsFile.parse(JSON.parse(await readFile(file, "utf8")));
    const shown = parsed.incidents.filter((i) => i.status !== "resolved" || now.getTime() - Date.parse(i.resolvedAt ?? i.startedAt) <= RECENT_MS);
    shown.sort((a, b) => (a.status === "resolved" ? 1 : 0) - (b.status === "resolved" ? 1 : 0) || Date.parse(b.startedAt) - Date.parse(a.startedAt));
    for (const i of shown) i.updates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { ok: true, incidents: shown };
  } catch (e) {
    log.warn("status_incidents_unreadable", { error: e instanceof Error ? e.name : typeof e });
    return { ok: false };
  }
}

export type ComponentState = "operational" | "degraded" | "outage";
export interface StatusView {
  overall: ComponentState;
  components: { id: keyof typeof COMPONENTS; name: string; state: ComponentState }[];
  incidents: Incidents;
  checkedAt: string;
}

const worse = (a: ComponentState, b: ComponentState): ComponentState => (a === "outage" || b === "outage" ? "outage" : a === "degraded" || b === "degraded" ? "degraded" : "operational");
const impactState = (impact: Incident["impact"]): ComponentState => (impact === "major" ? "outage" : impact === "minor" ? "degraded" : "operational");

/** Pure: checks + incidents -> what the page shows. An open incident can only make a component look worse. */
export function statusView(checks: HealthChecks, incidents: Incidents, now: Date): StatusView {
  const base: Record<keyof typeof COMPONENTS, ComponentState> = {
    web: "operational",
    database: checks.database === "ok" ? "operational" : "outage",
    jobs: checks.database !== "ok" ? "outage" : checks.worker === "ok" ? "operational" : "degraded",
    chain_data: "operational",
    email: "operational",
  };
  if (incidents.ok) for (const i of incidents.incidents) if (i.status !== "resolved") for (const c of i.components) base[c] = worse(base[c], impactState(i.impact));
  const components = (Object.keys(COMPONENTS) as (keyof typeof COMPONENTS)[]).map((id) => ({ id, name: COMPONENTS[id], state: base[id] }));
  return { overall: components.reduce<ComponentState>((acc, c) => worse(acc, c.state), "operational"), components, incidents, checkedAt: now.toISOString() };
}

export async function loadStatus(read?: LastSeenReader, now = new Date()): Promise<StatusView> {
  const [checks, incidents] = await Promise.all([runChecks(read), loadIncidents(undefined, now)]);
  return statusView(checks, incidents, now);
}
