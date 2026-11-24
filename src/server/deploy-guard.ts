/**
 * v1: a demo build or a test build never serves a staging or production deployment.
 *
 * CLEARLINE_DEMO_BUILD and CLEARLINE_TEST_BUILD are fixed at `next build` (next.config.mjs inlines them, like
 * src/server/demo-build.ts and src/server/test-build.ts read them). CLEARLINE_DEPLOY_ENV is read when the server
 * starts and says where this server runs: local, ci, demo, staging or production (unset means local). When the server
 * runs with NODE_ENV=production in staging or production, a build made with either flag refuses to start
 * (src/instrumentation.ts), whatever else the environment says. The production build gate
 * (`npm run build:prod-check`) proves the plain build has neither; this check stops a wrong artefact from starting.
 * A misspelt CLEARLINE_DEPLOY_ENV also refuses, so a typo can never switch the check off.
 */
export const DEPLOY_ENVS = ["local", "ci", "demo", "staging", "production"] as const;

export class DeployBuildRefused extends Error {
  readonly code = "DEPLOY_BUILD_REFUSED";
}

/** What this build was made as (the inlined constants; outside a Next build neither). */
export function buildFlags(): { demo: boolean; test: boolean } {
  const next = process.env.CLEARLINE_NEXT_BUILD === "1";
  return { demo: next && process.env.CLEARLINE_DEMO_BUILD === "1", test: next && process.env.CLEARLINE_TEST_BUILD === "1" };
}

/** The reason this server must not start, or null. `env` is the run-time environment. */
export function deployBuildProblem(env: Record<string, string | undefined>, flags = buildFlags()): string | null {
  const deploy = env.CLEARLINE_DEPLOY_ENV;
  if (deploy !== undefined && deploy !== "" && !(DEPLOY_ENVS as readonly string[]).includes(deploy)) {
    return `CLEARLINE_DEPLOY_ENV is ${JSON.stringify(deploy)}; use one of ${DEPLOY_ENVS.join(", ")} (or unset it for local).`;
  }
  if (env.NODE_ENV !== "production" || (deploy !== "staging" && deploy !== "production")) return null;
  const made = [flags.demo ? "CLEARLINE_DEMO_BUILD=1" : null, flags.test ? "CLEARLINE_TEST_BUILD=1" : null].filter(Boolean);
  if (made.length === 0) return null;
  return `This build was made with ${made.join(" and ")}; it never serves CLEARLINE_DEPLOY_ENV=${deploy}. Deploy a plain \`next build\` checked by \`npm run build:prod-check\`.`;
}

/** Server start (src/instrumentation.ts). */
export function assertDeployableBuild(env: Record<string, string | undefined> = process.env, flags = buildFlags()): void {
  const p = deployBuildProblem(env, flags);
  if (p) throw new DeployBuildRefused(p);
}
