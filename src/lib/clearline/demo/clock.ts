/**
 * The demo world's fixed clock. The seeded demo data covers the 30 days that end the day before DEMO_TODAY, and
 * every demo-build read that needs "now" for a demo organisation (chain verification, the recorded chain client's
 * evidence time) uses DEMO_NOW instead of the machine clock, so the data never ages: a demo run on any real date
 * shows the same ages, windows and confirmations. Pure constants; nothing here reads a clock.
 *
 * [ASSUMPTION] 2026-12-06 was chosen so the window (2026-11-06 … 2026-12-05) contains the three documented cases
 * (24 Nov – 4 Dec 2026) with their exact dates. demo-files/ holds the files of DEMO_TODAY itself.
 */
export const DEMO_TODAY = "2026-12-06" as const;
/** 10:00 in Singapore on DEMO_TODAY. */
export const DEMO_NOW = "2026-12-06T02:00:00.000Z" as const;
export const DEMO_WINDOW_DAYS = 30;
/** First day of the window (UTC calendar date). */
export const DEMO_FIRST_DAY = "2026-11-06" as const;
/** Last day of the window: the day before DEMO_TODAY. */
export const DEMO_LAST_DAY = "2026-12-05" as const;
export const demoNow = (): Date => new Date(DEMO_NOW);
