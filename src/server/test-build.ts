/**
 * rc8: recorded chain data (CLEARLINE_CHAIN_RECORDING) is honoured only in TEST builds.
 *
 * `next build` inlines two constants through next.config.mjs `env`: CLEARLINE_NEXT_BUILD is always "1", and
 * CLEARLINE_TEST_BUILD is "1" only when the build itself ran with CLEARLINE_TEST_BUILD=1 (the browser suites and the
 * blind test). In a build without the flag the condition below is the constant `false`: the bundler removes the
 * recording branch of `verifyClientFromEnv` (scripts/build/check-chain-recording.mjs checks the server bundle), and
 * setting either variable when the server starts changes nothing, because neither is read at run time.
 *
 * Outside a Next build (vitest, tsx scripts such as the job worker) only the vitest runner is a test build.
 *
 * The same condition is written out inline in src/server/chain-verify.ts so the bundler can drop that branch.
 */
import { demoBuild } from "./demo-build";

export function chainRecordingAllowed(): boolean {
  return process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_TEST_BUILD === "1" : process.env.VITEST === "true";
}

export const CHAIN_RECORDING_REFUSED = "CLEARLINE_CHAIN_RECORDING is set, but recorded chain data is honoured only in a test build (CLEARLINE_TEST_BUILD=1 at `next build`). Unset it.";

export class ChainRecordingRefused extends Error {
  readonly code = "CHAIN_RECORDING_REFUSED";
  constructor() { super(CHAIN_RECORDING_REFUSED); }
}

/**
 * Server start (src/instrumentation.ts) and the job worker: refuse to run with a recording in a build that is neither a
 * test build nor a demo build (src/server/demo-build.ts). A demo build starts with one, and still refuses it, per
 * call, for every organisation that is not a demo organisation.
 */
export function assertNoChainRecordingOutsideTestBuild(env: Record<string, string | undefined> = process.env): void {
  if (env.CLEARLINE_CHAIN_RECORDING && !chainRecordingAllowed() && !demoBuild()) throw new ChainRecordingRefused();
}
