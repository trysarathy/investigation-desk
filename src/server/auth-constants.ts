/** Shared, dependency-free constants for sign-in security (imported by auth.ts, the auth plugin and the route). */

/**
 * The header carrying the client address that src/server/auth-route.ts derived from TRUSTED configuration
 * (src/server/client-ip.ts). The route deletes any copy the client sent before setting it, so Better Auth's own
 * per-address rate limiter and the session's recorded address never come from a client-chosen header.
 */
export const TRUSTED_IP_HEADER = "x-clearline-trusted-client-ip";

/** Endpoints whose successful call proves a second factor. */
export const SECOND_FACTOR_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/clearline/passkey/sign-in"]);

/** A step-up (fresh re-authentication) is good for this long. */
export const STEP_UP_SECONDS = 10 * 60;

/**
 * Whether a session re-authenticated recently enough for a sensitive action. A user with MFA must have proved a
 * second factor (at sign-in or by a step-up); a user without MFA counts the sign-in itself or a password step-up.
 */
export function freshlyAuthenticated(s: { mfaEnrolled: boolean; createdAt: Date; mfaVerifiedAt: Date | null; reauthenticatedAt: Date | null }, now = Date.now()): boolean {
  const times = s.mfaEnrolled ? [s.mfaVerifiedAt, s.reauthenticatedAt] : [s.createdAt, s.reauthenticatedAt];
  const last = Math.max(0, ...times.filter((t): t is Date => !!t).map((t) => t.getTime()));
  return last > 0 && now - last <= STEP_UP_SECONDS * 1000;
}
