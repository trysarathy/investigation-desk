/**
 * The seed's simulated clock (`npm run demo` only; never imported by the app). While the demo world is seeded day by
 * day, `new Date()` and `Date.now()` in THIS process return the simulated instant of the step, so runs, exceptions,
 * proposals and audit rows carry demo dates (src/lib/clearline/demo/clock.ts), not the machine's. Database defaults
 * (now()) are not affected. `set(null)` returns to the real clock.
 */
const RealDate = Date;
let fake: number | null = null;

class DemoDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor> | []) {
    if (args.length === 0 && fake !== null) super(fake);
    else super(...(args as ConstructorParameters<DateConstructor>));
  }
  static now(): number { return fake ?? RealDate.now(); }
}

export function installDemoClock(): { set: (iso: string | null) => void; restore: () => void } {
  globalThis.Date = DemoDate as DateConstructor;
  return {
    set: (iso) => { fake = iso === null ? null : RealDate.parse(iso); },
    restore: () => { fake = null; globalThis.Date = RealDate; },
  };
}
