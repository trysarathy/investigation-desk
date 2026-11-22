import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { database } from "./db/client";
import { loginFailures } from "./db/schema";

/** At most this many failed sign-ins per account per window; the account is then refused until the window passes. */
export const MAX_FAILURES = 5;
export const WINDOW_SECONDS = 15 * 60;
const key = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

export async function signInAllowed(email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_SECONDS * 1000);
  const r = await database().select({ n: sql<number>`count(*)::int` }).from(loginFailures).where(and(eq(loginFailures.emailSha256, key(email)), gt(loginFailures.at, since)));
  return (r[0]?.n ?? 0) < MAX_FAILURES;
}

export async function recordSignInResult(email: string, ok: boolean): Promise<void> {
  if (ok) await database().delete(loginFailures).where(eq(loginFailures.emailSha256, key(email)));
  else await database().insert(loginFailures).values({ emailSha256: key(email) });
}
