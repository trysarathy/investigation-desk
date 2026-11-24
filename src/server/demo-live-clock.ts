import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "./db/client";
import { organizations } from "./db/schema";
import { DEMO_NOW, DEMO_TODAY } from "@/lib/clearline/demo/clock";

/**
 * Demo build only: the calendar live demo actions are stamped on. Loaded by src/server/tenant.ts only INSIDE the
 * inlined demo-build branch, so no other build contains it (scripts/build/check-chain-recording.mjs --marker clock).
 *
 * The problem: the demo world is seeded on the demo calendar (the 30 days before DEMO_TODAY, 2026-12-08), but what a
 * presenter does live (an approval, an upload, a run, a note) was stamped with the machine clock, so on any real date
 * before the demo month it sorted BEFORE the seeded data.
 *
 * The scheme (honest and monotonic within a server process):
 *   demo time = real time + D whole days, never earlier than DEMO_NOW (10:00 in Singapore on the demo day),
 *   where D = DEMO_TODAY minus the real calendar date in the demo merchant's zone (Asia/Singapore, UTC+8, no DST),
 *   fixed the first time the server stamps a live demo action.
 * So a live action reads as "the demo day, at the real wall-clock time of day in Singapore": an approval at 15:42
 * Singapore time is stamped 2026-12-08 15:42 +08:00. Because D is fixed per process, time only moves forward: a demo
 * that runs past midnight continues into 2026-12-09 rather than jumping back. Before 10:00 Singapore time the stamp is
 * DEMO_NOW itself, so a live action never sorts before the seed's last step (09:30 on the demo day).
 * Restarting the server on a later real day picks a new D; reset the demo (`npm run demo:reset`) before a new day's
 * session so the record starts again from the seeded state.
 *
 * Two halves, both applied only for a demo organisation:
 *   - the app: src/server/live-clock.ts `stampNow()` / `stampAt(real)` return `demoLiveTime(real)` inside the
 *     transaction;
 *   - the database: columns filled by a now() default. `set_config('clearline.demo_offset_days', D, true)` is
 *     transaction-local; the function clearline_demo_now() that `npm run demo` installs in the DEMO database only
 *     (scripts/demo/live-clock-db.ts) reads it, checks that the transaction's organisation (app.org_id) is a demo
 *     organisation, and applies the same formula; otherwise it is now(). Real databases never have the function and
 *     never change: no migration is involved.
 */
export const DEMO_CLOCK_MARKER = "clearline-demo-clock[demo-build-only]";
export const DEMO_CLOCK_SETTING = "clearline.demo_offset_days";
/** Asia/Singapore, the demo merchant's zone (src/lib/clearline/demo/world.ts DEMO_MERCHANT); fixed, no DST. */
export const DEMO_ZONE_OFFSET_MINUTES = 480;
const DAY = 86_400_000;

/** Whole days from the real calendar date in the demo zone to DEMO_TODAY. */
export function demoDayOffset(real: Date): number {
  const localDay = Math.floor((real.getTime() + DEMO_ZONE_OFFSET_MINUTES * 60_000) / DAY);
  const demoDay = Date.parse(`${DEMO_TODAY}T00:00:00.000Z`) / DAY;
  return demoDay - localDay;
}

/** The demo-calendar instant for a real instant, given the process's day offset. */
export function demoLiveTime(real: Date, offsetDays: number): Date {
  return new Date(Math.max(real.getTime() + offsetDays * DAY, Date.parse(DEMO_NOW)));
}

let processOffset: number | undefined;
/** The day offset of this server process: fixed the first time it is asked for (see the scheme above). */
export function processDayOffset(now: () => Date = () => new Date()): number {
  return (processOffset ??= demoDayOffset(now()));
}
/** Tests only: forget the process's offset. */
export function resetProcessDayOffset(): void { processOffset = undefined; }

export class DemoClockRefused extends Error {
  readonly marker = DEMO_CLOCK_MARKER;
}

/**
 * Inside a tenant transaction: when (and only when) the organisation is a demo organisation, turn on the demo calendar
 * for this transaction (database setting) and return the app-side clock; otherwise return null and change nothing.
 */
export async function enterDemoClock(tx: Tx, orgId: string): Promise<((real: Date) => Date) | null> {
  const [o] = await tx.select({ dataMode: organizations.dataMode }).from(organizations).where(eq(organizations.id, orgId));
  if (o?.dataMode !== "demo") return null;
  const offset = processDayOffset();
  if (!Number.isInteger(offset) || Math.abs(offset) > 3660) throw new DemoClockRefused(`The demo calendar is more than ten years from today's date (${offset} days); ${DEMO_CLOCK_MARKER}`);
  await tx.execute(sql`select set_config(${DEMO_CLOCK_SETTING}, ${String(offset)}, true)`);
  return (real) => demoLiveTime(real, offset);
}
