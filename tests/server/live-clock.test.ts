/**
 * v1: live demo actions are stamped on the demo calendar, and ONLY in a demo build for a demo organisation. The build
 * constants are simulated at run time the way next.config.mjs inlines them (as in demo-build-gate.test.ts). The
 * database half is tested against PostgreSQL in tests/control/demo-live-clock.test.ts. Demo · fictional data.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runWithLiveClock, stampAt, stampNow } from "@/server/live-clock";
import { DEMO_CLOCK_MARKER, DEMO_CLOCK_SETTING, demoDayOffset, demoLiveTime, demoShiftFor, enterDemoClock, processShiftMs, resetProcessShift } from "@/server/demo-live-clock";
import { DEMO_NOW } from "@/lib/clearline/demo/clock";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; resetProcessShift(); });
const build = (o: { demo?: boolean; next?: boolean }) => {
  process.env.CLEARLINE_NEXT_BUILD = o.next === false ? "" : "1"; process.env.CLEARLINE_TEST_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = o.demo ? "1" : "";
};
const src = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");

describe("the scheme: one constant shift per process, demo day + Singapore time of day, never before DEMO_NOW", () => {
  const DAY = 86_400_000;
  it("a first live action at 15:42 in Singapore: whole days, so the time of day is kept", () => {
    const first = new Date("2026-11-24T07:42:13.000Z"); // 15:42:13 in Singapore
    expect(demoDayOffset(first)).toBe(14);
    const s = demoShiftFor(first);
    expect(s).toBe(14 * DAY);
    expect(demoLiveTime(first, s).toISOString()).toBe("2026-12-08T07:42:13.000Z");
  });
  it("uses the Singapore calendar date, not the UTC one", () => {
    const first = new Date("2026-11-25T03:05:00.000Z"); // 11:05 on 25 Nov in Singapore (also 25 Nov UTC)
    expect(demoLiveTime(first, demoShiftFor(first)).toISOString()).toBe("2026-12-08T03:05:00.000Z");
    const lateUtc = new Date("2026-11-24T18:30:00.000Z"); // 02:30 on 25 Nov in Singapore
    expect(demoDayOffset(lateUtc)).toBe(13);
  });
  it("a first live action before 10:00 in Singapore starts the demo clock at DEMO_NOW, then it runs in real time", () => {
    const first = new Date("2026-11-24T18:30:00.000Z"); // 02:30 in Singapore
    const s = demoShiftFor(first);
    expect(demoLiveTime(first, s).toISOString()).toBe(DEMO_NOW);
    expect(demoLiveTime(new Date(first.getTime() + 90_000), s).toISOString()).toBe("2026-12-08T02:01:30.000Z");
  });
  it("is strictly monotonic within a process: the shift is fixed once, so past midnight it moves on to 2026-12-09", () => {
    let t = Date.parse("2026-11-24T15:50:00.000Z"); // 23:50 in Singapore
    const shift = processShiftMs(() => new Date(t));
    t = Date.parse("2026-11-24T16:20:00.000Z"); // 00:20 next day in Singapore
    expect(processShiftMs(() => new Date(t))).toBe(shift);
    const a = demoLiveTime(new Date("2026-11-24T15:50:00.000Z"), shift), b = demoLiveTime(new Date("2026-11-24T16:20:00.000Z"), shift);
    expect(b.getTime() - a.getTime()).toBe(30 * 60_000);
    expect(b.toISOString()).toBe("2026-12-08T16:20:00.000Z"); // 00:20 on 9 Dec in Singapore
  });
  it("never stamps before DEMO_NOW, even for an instant before the process's first live action", () => {
    const s = demoShiftFor(new Date("2026-11-24T02:00:00.000Z")); // exactly 10:00 in Singapore
    expect(demoLiveTime(new Date("2026-11-24T01:00:00.000Z"), s).toISOString()).toBe(DEMO_NOW);
  });
});

describe("stampNow / stampAt", () => {
  const demoMapper = () => new Date("2030-01-01T00:00:00.000Z");
  it("a real build: the machine clock, even inside a demo-clock scope", () => {
    build({ demo: false });
    const real = new Date("2026-11-24T07:00:00.000Z");
    runWithLiveClock(demoMapper, () => {
      expect(stampAt(real)).toBe(real);
      expect(Math.abs(stampNow().getTime() - Date.now())).toBeLessThan(5_000);
    });
  });
  it("outside a Next build (vitest, the job worker): the machine clock", () => {
    build({ demo: true, next: false });
    runWithLiveClock(demoMapper, () => expect(Math.abs(stampNow().getTime() - Date.now())).toBeLessThan(5_000));
  });
  it("a demo build: the demo calendar only inside the scope tenant.ts opens for a demo organisation", async () => {
    build({ demo: true });
    expect(Math.abs(stampNow().getTime() - Date.now())).toBeLessThan(5_000);
    await runWithLiveClock(demoMapper, async () => {
      await Promise.resolve();
      expect(stampNow().toISOString()).toBe("2030-01-01T00:00:00.000Z");
    });
    expect(Math.abs(stampNow().getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe("enterDemoClock (inside the tenant transaction)", () => {
  const fakeTx = (dataMode: string | undefined) => {
    const executed: unknown[] = [];
    const tx = {
      select: () => ({ from: () => ({ where: async () => (dataMode ? [{ dataMode }] : []) }) }),
      execute: async (q: unknown) => { executed.push(q); return { rows: [] }; },
    };
    return { tx: tx as never, executed };
  };
  it("changes nothing for a live, sample or unknown organisation", async () => {
    for (const mode of ["live", "sample", undefined]) {
      const { tx, executed } = fakeTx(mode);
      expect(await enterDemoClock(tx, "00000000-0000-4000-8000-000000000001")).toBeNull();
      expect(executed).toEqual([]);
    }
  });
  it("for a demo organisation sets the transaction-local database setting and returns the app-side mapping", async () => {
    const { tx, executed } = fakeTx("demo");
    const map = await enterDemoClock(tx, "00000000-0000-4000-8000-000000000002");
    expect(map).not.toBeNull();
    expect(executed).toHaveLength(1);
    expect(JSON.stringify(executed[0])).toContain(DEMO_CLOCK_SETTING);
    expect(map!(new Date()).getTime()).toBeGreaterThanOrEqual(Date.parse(DEMO_NOW));
  });
});

describe("only a demo build can contain it", () => {
  it("tenant.ts imports the demo calendar only inside the inlined demo-build branch, and only for writes with an organisation", () => {
    const t = src("src/server/tenant.ts");
    expect(t).not.toMatch(/^import .*demo-live-clock/m);
    expect(t).toMatch(/if \(process\.env\.CLEARLINE_NEXT_BUILD === "1" \? process\.env\.CLEARLINE_DEMO_BUILD === "1" : false\) \{\n\s+if \(ctx\.orgId && !opts\.read\) \{\n\s+const \{ enterDemoClock \} = await import\("\.\/demo-live-clock"\);/);
    expect(src("src/server/live-clock.ts")).not.toMatch(/(import|require)[^;\n]*(demo-live-clock|clearline\/demo)/);
  });
  it("the demo calendar carries a bundle marker of its own", () => {
    expect(DEMO_CLOCK_MARKER).toBe("clearline-demo-clock[demo-build-only]");
  });
});
