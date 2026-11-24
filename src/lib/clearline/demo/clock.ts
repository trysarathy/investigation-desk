/**
 * The demo world's fixed clock. The seeded demo data covers the 30 days that end the day before DEMO_TODAY, and
 * every demo-build read that needs "now" for a demo organisation (chain verification, the recorded chain client's
 * evidence time) uses DEMO_NOW instead of the machine clock, so the data never ages: a demo run on any real date
 * shows the same windows and confirmations. The seed itself runs on a simulated clock that follows the demo days
 * (scripts/demo/clock.ts), so runs, exceptions and proposals carry demo dates. Pure constants; nothing here reads a
 * clock.
 *
 * [ASSUMPTION] Tuesday 2026-12-08 was chosen so that (a) the window, Sunday 2026-11-08 … Monday 2026-12-07, contains
 * the three documented cases (24 Nov – 4 Dec 2026) on their own dates, and (b) the demo day is a bank business day:
 * its statement (demo-files/) carries the settlement of Monday's batch.
 */
export const DEMO_TODAY = "2026-12-08" as const;
/** 10:00 in Singapore on DEMO_TODAY. */
export const DEMO_NOW = "2026-12-08T02:00:00.000Z" as const;
export const DEMO_WINDOW_DAYS = 30;
/** First day of the window (UTC calendar date). */
export const DEMO_FIRST_DAY = "2026-11-08" as const;
/** Last day of the window: the day before DEMO_TODAY. */
export const DEMO_LAST_DAY = "2026-12-07" as const;
export const demoNow = (): Date => new Date(DEMO_NOW);
