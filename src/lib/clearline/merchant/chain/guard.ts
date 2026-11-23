/** The live-chain gate, shared by adapters/chain.ts (re-exported there unchanged) and the real readers' factory. */
export type Env = Record<string, string | undefined>;
export const processEnv = (): Env => (globalThis as { process?: { env: Env } }).process?.env ?? {};

/** True under a test runner or CI, where live chain reads are always refused. */
export const isTestOrCi = (env: Env): boolean => !!(env.CI || env.VITEST || env.NODE_ENV === "test" || env.JEST_WORKER_ID);

/** Live mode needs CLEARLINE_CHAIN_LIVE=1 and is refused outright under a test runner or CI. */
export function assertLiveChainAllowed(env: Env = processEnv()): void {
  if (env.CLEARLINE_CHAIN_LIVE !== "1") throw new Error("Live chain mode is off (set CLEARLINE_CHAIN_LIVE=1 outside tests to enable live chain reads).");
  if (isTestOrCi(env)) throw new Error("Live chain mode is refused in tests and CI: use RecordedChainClient.");
}
