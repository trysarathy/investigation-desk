/**
 * v1 phase 2.2: provider credentials are never stored in the database. A connection stores a REFERENCE: the name of a
 * server environment variable (or of the secret-store entry the deployment exposes as one) in a reserved namespace, so
 * a connection can never be pointed at another server secret (DATABASE_URL, BETTER_AUTH_SECRET, ...). The value is
 * read at the moment of use and passed straight to the request header or the HMAC; it is never logged or returned.
 */
export const API_KEY_REF_RE = /^CLEARLINE_PROVIDER_KEY_[A-Z0-9_]{1,48}$/;
export const WEBHOOK_SECRET_REF_RE = /^CLEARLINE_PROVIDER_WEBHOOK_[A-Z0-9_]{1,48}$/;

export type SecretKind = "api_key" | "webhook_secret";
const RE: Record<SecretKind, RegExp> = { api_key: API_KEY_REF_RE, webhook_secret: WEBHOOK_SECRET_REF_RE };

export const isSecretRef = (kind: SecretKind, ref: string) => RE[kind].test(ref);

/** The secret's value, or null when the reference is invalid or the server has no such secret (or a too-short one). */
export function resolveSecret(kind: SecretKind, ref: string | null | undefined, env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  if (!ref || !isSecretRef(kind, ref)) return null;
  const v = env[ref];
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 16 && s.length <= 4096 && !/[\r\n]/.test(s) ? s : null;
}
