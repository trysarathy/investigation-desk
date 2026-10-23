// Route settings for the exception rules: per route, the agreed deadline, the grace before a
// missing leg counts, which legs are expected, and any configured fee rule. A payment's route is
// the first one whose provider, chain and token all match (an empty field matches anything).
// Saved with a version; every change is audit-logged.

import type { Chain } from "../types";
import { ALL_CHAINS } from "../types";
import type { LegName } from "./types";

export type FeeRule =
  | { kind: "none" }
  /** A fixed fee per payment, in the payment's own asset. */
  | { kind: "fixed"; amount: string }
  /** A fee of this many basis points of the instructed amount. */
  | { kind: "percent_bps"; bps: number };

export interface RouteSetting {
  routeId: string;
  name: string;
  match: { provider?: string; chain?: Chain; token?: string };
  /** Minutes from instruction to every expected leg, unless the instruction carries its own due_by. */
  deadlineMinutes: number;
  /** Minutes a missing leg may lag the stage before it before it counts as an exception. */
  graceMinutes: number;
  expectedLegs: LegName[];
  fee: FeeRule;
  /** Marks a setting that came with the prototype, not one the company entered. */
  sample?: boolean;
}

export interface ExceptionSettings {
  version: number;
  updatedAt: string;
  updatedBy: string;
  routes: RouteSetting[];
}

export const DEFAULT_SETTINGS: ExceptionSettings = {
  version: 1,
  updatedAt: "2026-10-23T00:00:00Z",
  updatedBy: "prototype default",
  routes: [
    { routeId: "bvnk-tron-usdt", name: "BVNK · Tron · USDT", match: { provider: "BVNK", chain: "tron", token: "USDT" },
      deadlineMinutes: 120, graceMinutes: 30, expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "none" }, sample: true },
    { routeId: "default", name: "Any other route", match: {},
      deadlineMinutes: 24 * 60, graceMinutes: 60, expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "none" }, sample: true },
  ],
};

const LEGS: LegName[] = ["instruction", "chain", "provider", "bank", "ledger"];

/** Problems that stop routes being saved. Empty means valid. */
export function checkRoutes(routes: unknown): string[] {
  if (!Array.isArray(routes) || !routes.length) return ["Give at least one route."];
  const errs: string[] = [];
  const ids = new Set<string>();
  routes.forEach((r: RouteSetting, i) => {
    const at = `Route ${i + 1}`;
    if (!r || typeof r !== "object") { errs.push(`${at} is not an object.`); return; }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(r.routeId ?? "")) errs.push(`${at}: routeId must be lower-case letters, digits and dashes.`);
    if (ids.has(r.routeId)) errs.push(`${at}: routeId "${r.routeId}" is used twice.`);
    ids.add(r.routeId);
    if (!r.name?.trim()) errs.push(`${at}: needs a name.`);
    if (r.match?.chain && !ALL_CHAINS.includes(r.match.chain)) errs.push(`${at}: unknown chain "${r.match.chain}".`);
    for (const k of ["deadlineMinutes", "graceMinutes"] as const) {
      if (!Number.isInteger(r[k]) || r[k] < 0) errs.push(`${at}: ${k} must be a whole number of minutes.`);
    }
    if (!Array.isArray(r.expectedLegs) || r.expectedLegs.some((l) => !LEGS.includes(l))) errs.push(`${at}: expectedLegs must list legs from ${LEGS.join(", ")}.`);
    const f = r.fee;
    if (!f || !["none", "fixed", "percent_bps"].includes(f.kind)) errs.push(`${at}: fee.kind must be none, fixed or percent_bps.`);
    else if (f.kind === "fixed" && !/^\d+(\.\d+)?$/.test(f.amount ?? "")) errs.push(`${at}: a fixed fee needs an exact decimal amount.`);
    else if (f.kind === "percent_bps" && (!Number.isInteger(f.bps) || f.bps < 0 || f.bps > 10_000)) errs.push(`${at}: bps must be a whole number from 0 to 10000.`);
  });
  if (routes.length && Object.keys((routes[routes.length - 1] as RouteSetting).match ?? {}).some((k) => (routes[routes.length - 1] as RouteSetting).match[k as "chain"])) {
    errs.push("The last route must match anything (empty match), so every payment has a route.");
  }
  return errs;
}

export function routeFor(settings: ExceptionSettings, p: { provider?: string; chain?: string; token?: string }): RouteSetting {
  const hit = settings.routes.find((r) =>
    (!r.match.provider || r.match.provider === p.provider) && (!r.match.chain || r.match.chain === p.chain) && (!r.match.token || r.match.token === p.token));
  return hit ?? settings.routes[settings.routes.length - 1];
}
