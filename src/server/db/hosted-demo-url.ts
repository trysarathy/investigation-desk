/**
 * The hosted demo (a Vercel preview of demo/integrated, CLEARLINE_HOSTED_DEMO=1) gets its database from the Neon
 * integration, whose DATABASE_URL is the Neon OWNER login: using it would skip row-level security. So in the hosted
 * demo the runtime connection is always built here, for the non-owner clearline_runtime login on the demo database,
 * from the Neon host (PGHOST_UNPOOLED) and CLEARLINE_DEMO_RUNTIME_PASSWORD. It never falls back to DATABASE_URL.
 * Returns null outside the hosted demo. Never logs the URL or the password.
 */
export function hostedDemoRuntimeUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.CLEARLINE_HOSTED_DEMO !== "1") return null;
  const host = env.PGHOST_UNPOOLED;
  const password = env.CLEARLINE_DEMO_RUNTIME_PASSWORD;
  if (!host || !/^[a-z0-9.-]+$/i.test(host) || !password) {
    throw new Error("hosted demo: PGHOST_UNPOOLED and CLEARLINE_DEMO_RUNTIME_PASSWORD are required (the Neon owner DATABASE_URL is never used)");
  }
  return `postgres://clearline_runtime:${encodeURIComponent(password)}@${host}/clearline_demo?sslmode=require`;
}
