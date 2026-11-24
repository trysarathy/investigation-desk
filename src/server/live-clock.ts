import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The instant a live action is stamped with (approvals, uploads, runs, notes, audit rows).
 *
 * Everywhere except one case this is simply `new Date()`, the machine clock. The one case: a DEMO build
 * (src/server/demo-build.ts) acting for a DEMO organisation (data mode 'demo'), inside a tenant transaction that
 * src/server/tenant.ts opened with the demo calendar (src/server/demo-live-clock.ts). There, live actions read on the
 * demo calendar, after the seeded month, instead of the machine's date.
 *
 * The condition below is the inlined build constant, written out like the other demo-build branches: in any build
 * without CLEARLINE_DEMO_BUILD=1 it is the constant `false`, the bundler drops the branch, and `stampNow()` is exactly
 * `new Date()` whatever the request or the database holds. Outside a Next build (vitest, the job worker) there is no
 * demo build either. tests/server/live-clock.test.ts checks both.
 */
let scope: AsyncLocalStorage<(real: Date) => Date> | undefined;

/** The live-action stamp for an instant the machine clock gave (`real`): unchanged except as described above. */
export function stampAt(real: Date): Date {
  if (process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false) {
    const toDemo = scope?.getStore();
    if (toDemo) return toDemo(real);
  }
  return real;
}

/** `new Date()`, except as described above. */
export function stampNow(): Date {
  return stampAt(new Date());
}

/** Run `fn` with `toDemo` mapping live-action stamps (demo build only; anywhere else `fn` runs unchanged). */
export function runWithLiveClock<T>(toDemo: (real: Date) => Date, fn: () => T): T {
  if (process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false) {
    scope ??= new AsyncLocalStorage<(real: Date) => Date>();
    return scope.run(toDemo, fn);
  }
  return fn();
}
