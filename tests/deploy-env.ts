/**
 * v1 #165: every test and CI server says where it runs. A production server (`next start`) refuses to start without
 * CLEARLINE_DEPLOY_ENV (src/server/deploy-guard.ts), so each Playwright webServer and each spawned `next start` sets
 * it: "ci" under CI (the CI variable), "local" otherwise, or the value already given if it is one of those two. A test
 * server never claims to be staging, production or the demo: any other value is refused here.
 */
export function testDeployEnv(env: Record<string, string | undefined> = process.env): "local" | "ci" {
  const v = env.CLEARLINE_DEPLOY_ENV;
  if (v === "local" || v === "ci") return v;
  if (v !== undefined && v !== "") throw new Error(`A test server runs as CLEARLINE_DEPLOY_ENV=local or ci, not ${JSON.stringify(v)}.`);
  return env.CI ? "ci" : "local";
}
