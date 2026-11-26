/**
 * Hosted on Vercel with the Neon integration (CLEARLINE_DB_FROM_NEON=1): the integration's DATABASE_URL is the Neon
 * OWNER login, which would skip row-level security. So the app's connections are always built here, for the
 * non-owner Clearline logins, from the Neon host (PGHOST_UNPOOLED) and that login's own password
 * (CLEARLINE_RUNTIME_PASSWORD, CLEARLINE_PROVISIONING_PASSWORD). There is no fallback to DATABASE_URL.
 * Returns null when the flag is off. Never logs a URL or a password.
 */
export type NeonLogin = "runtime" | "provisioning" | "jobs";

export function neonLoginUrl(login: NeonLogin, env: Record<string, string | undefined> = process.env): string | null {
  if (env.CLEARLINE_DB_FROM_NEON !== "1") return null;
  const host = env.PGHOST_UNPOOLED;
  const password = env[`CLEARLINE_${login.toUpperCase()}_PASSWORD`];
  const db = env.CLEARLINE_DB_NAME ?? "clearline";
  if (!host || !/^[a-z0-9.-]+$/i.test(host) || !password || !/^[a-z][a-z0-9_]{2,40}$/.test(db)) {
    throw new Error(`hosted database: PGHOST_UNPOOLED and CLEARLINE_${login.toUpperCase()}_PASSWORD are required (the Neon owner DATABASE_URL is never used)`);
  }
  return `postgres://clearline_${login}:${encodeURIComponent(password)}@${host}${env.CLEARLINE_DB_PORT ? `:${Number(env.CLEARLINE_DB_PORT)}` : ""}/${db}?sslmode=${env.CLEARLINE_DB_SSLMODE === "disable" ? "disable" : "verify-full"}`;
}
