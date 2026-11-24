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
 * The scheme: demo time = real time + S, one constant shift S per server process, fixed at the first live demo
 * action the process stamps:
 *   - normally S is whole days: DEMO_TODAY minus the real calendar date in the demo merchant's zone (Asia/Singapore,
 *     UTC+8, no DST). A live action then reads "the demo day, at the real wall-clock time of day in Singapore": an
 *     approval at 15:42 Singapore time is stamped 2026-12-08 15:42 +08:00;
 *   - if that would put the first live action before DEMO_NOW (10:00 in Singapore on the demo day; the seed's last
 *     step is 09:30), S instead puts it at exactly DEMO_NOW, and the demo clock runs in real time from there.
 * Because S is constant, stamps are strictly monotonic within a process and keep real durations: a demo that runs
 * past midnight continues into 2026-12-09 rather than jumping back. A restart fixes a new S at its first live action
 * (a restart before 10:00 Singapore time starts again at 10:00); reset the demo (`npm run demo:reset`) before each
 * session so the record starts from the seeded state. A stamp is never earlier than DEMO_NOW.
 *
 * Two halves, both applied only for a demo organisation:
 *   - the app: src/server/live-clock.ts `stampNow()` / `stampAt(real)` return `real + S` inside the transaction;
 *   - the database: columns filled by a now() default. `set_config('clearline.demo_shift_ms', S, true)` is
 *     transaction-local; the function clearline_demo_now() that `npm run demo` installs in the DEMO database only
 *     (scripts/demo/live-clock-db.ts) reads it, checks that the transaction's organisation (app.org_id) is a demo
 *     organisation, and returns greatest(now() + S, DEMO_NOW); otherwise it is now(). Real databases never have the
 *     function and never change: no migration is involved.
 */
export const DEMO_CLOCK_MARKER = "clearline-demo-clock[demo-build-only]";
export const DEMO_CLOCK_SETTING = "clearline.demo_shift_ms";
/** Asia/Singapore, the demo merchant's zone (src/lib/clearline/demo/world.ts DEMO_MERCHANT); fixed, no DST. */
export const DEMO_ZONE_OFFSET_MINUTES = 480;
const DAY = 86_400_000;
/** The database function refuses (falls back to now()) beyond this; the app refuses to start the clock beyond it. */
export const MAX_SHIFT_MS = 3660 * DAY;

/** Whole days from the real calendar date in the demo zone to DEMO_TODAY. */
export function demoDayOffset(real: Date): number {
  const localDay = Math.floor((real.getTime() + DEMO_ZONE_OFFSET_MINUTES * 60_000) / DAY);
  const demoDay = Date.parse(`${DEMO_TODAY}T00:00:00.000Z`) / DAY;
  return demoDay - localDay;
}

/** The shift for a process whose first live demo action happens at `first` (see the scheme above). */
export function demoShiftFor(first: Date): number {
  const days = demoDayOffset(first) * DAY;
  return first.getTime() + days >= Date.parse(DEMO_NOW) ? days : Date.parse(DEMO_NOW) - first.getTime();
}

/** The demo-calendar instant for a real instant, given the process's shift. */
export function demoLiveTime(real: Date, shiftMs: number): Date {
  return new Date(Math.max(real.getTime() + shiftMs, Date.parse(DEMO_NOW)));
}

let processShift: number | undefined;
/** The shift of this server process: fixed the first time it is asked for. */
export function processShiftMs(now: () => Date = () => new Date()): number {
  return (processShift ??= demoShiftFor(now()));
}
/** Tests only: forget the process's shift. */
export function resetProcessShift(): void { processShift = undefined; }

export class DemoClockRefused extends Error {
  readonly marker = DEMO_CLOCK_MARKER;
}

/**
 * Inside a tenant transaction: when (and only when) the organisation is a demo organisation, turn on the demo calendar
 * for this transaction (database setting) and return the app-side mapping; otherwise return null and change nothing.
 */
export async function enterDemoClock(tx: Tx, orgId: string): Promise<((real: Date) => Date) | null> {
  const [o] = await tx.select({ dataMode: organizations.dataMode }).from(organizations).where(eq(organizations.id, orgId));
  if (o?.dataMode !== "demo") return null;
  const shift = processShiftMs();
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > MAX_SHIFT_MS) throw new DemoClockRefused(`The demo calendar is more than ten years from today's date; ${DEMO_CLOCK_MARKER}`);
  await tx.execute(sql`select set_config(${DEMO_CLOCK_SETTING}, ${String(shift)}, true)`);
  return (real) => demoLiveTime(real, shift);
}
