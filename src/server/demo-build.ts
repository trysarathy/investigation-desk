/**
 * Demo build: conveniences for the local, offline demo (`npm run demo`) exist ONLY in a build made with
 * CLEARLINE_DEMO_BUILD=1 at `next build`. next.config.mjs inlines CLEARLINE_DEMO_BUILD exactly like
 * CLEARLINE_TEST_BUILD (src/server/test-build.ts): in a build without the flag the condition below is the constant
 * `false`, the bundler drops every demo branch, and setting the variable when the server starts changes nothing.
 * scripts/build/check-chain-recording.mjs --marker demo checks a finished build for the demo paths.
 *
 * Outside a Next build (vitest, tsx scripts such as the job worker) there is no demo build. Tests simulate one by
 * setting both build constants, as the test-build tests do.
 *
 * What a demo build allows, and only for an organisation whose data_mode is 'demo' (migration 0031; only the schema
 * owner sets it):
 *   - recorded chain data (CLEARLINE_CHAIN_RECORDING) for that organisation, read at the demo clock;
 *   - the demo reset (POST /api/control/demo/reset and the "Reset demo" button).
 * A demo build refuses a recording for any other organisation, and refuses to start with live chain reads or the
 * ledger pull turned on (both would reach the network).
 *
 * The same condition is written out inline where a branch must be dropped (chain-verify.ts, the reset route).
 */
export function demoBuild(): boolean {
  return process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false;
}

export const DEMO_RECORDING_REFUSED = "Recorded chain data in a demo build is honoured only for a demo organisation (data mode 'demo'); this organisation is not one.";

export class DemoRecordingRefused extends Error {
  readonly code = "DEMO_RECORDING_REFUSED";
  constructor() { super(DEMO_RECORDING_REFUSED); }
}

export const DEMO_NETWORK_REFUSED = "A demo build runs offline: CLEARLINE_CHAIN_LIVE and CLEARLINE_LEDGER_PULL must not be set. Unset them.";

export class DemoNetworkRefused extends Error {
  readonly code = "DEMO_NETWORK_REFUSED";
  constructor() { super(DEMO_NETWORK_REFUSED); }
}

/** Server start (src/instrumentation.ts): a demo build never reaches the network for chain or ledger data. */
export function assertDemoBuildOffline(env: Record<string, string | undefined> = process.env): void {
  if (demoBuild() && (env.CLEARLINE_CHAIN_LIVE === "1" || env.CLEARLINE_LEDGER_PULL === "1")) throw new DemoNetworkRefused();
}
