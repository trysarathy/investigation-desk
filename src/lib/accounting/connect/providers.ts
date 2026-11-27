// v1 phase 2.3: where each ledger's OAuth 2.0 and API endpoints are, and the OAuth calls themselves.
//
// Nothing here is reachable until CLEARLINE_LEDGER_ENV is set:
//   standin  the local stand-in servers (fictional data; tests and local runs). Their base URLs must be loopback.
//   sandbox  Xero (its Demo Company: Xero has no separate sandbox host) and the QuickBooks Online SANDBOX host.
// Any other value, or none, and connecting is refused. There is no "production" value on purpose: switching to a
// live ledger is a founder decision (docs/LEDGER_CONNECT.md).
//
// Authorization code flow. PKCE (S256) is sent to Xero; Intuit is sent state only [ASSUMPTION: Intuit's OAuth 2.0
// documentation does not describe PKCE for web apps]. State is single-use, hashed at rest and bound to the browser
// that started the flow. When an id_token comes back (Xero, "openid" scope) its nonce must equal the one sent; nothing
// else in it is trusted or used (it is not used to identify anyone).
//
// Errors never quote a response body (it may hold tokens or ledger data): only the HTTP status and, for the token
// endpoint, the OAuth "error" code.

import type { Fetch } from "../providers/xero";

export type LedgerProvider = "xero" | "qbo";
export type LedgerEnv = "standin" | "sandbox";
export const LEDGER_ENV_VAR = "CLEARLINE_LEDGER_ENV";

export interface ProviderConfig {
  provider: LedgerProvider;
  env: LedgerEnv;
  authorizeUrl: string;
  tokenUrl: string;
  /** Xero: the tenants (organisations) an authorisation covers. QuickBooks names its one company (realmId) in the callback. */
  connectionsUrl?: string;
  /** Xero: DELETE /connections/{id} to disconnect. QuickBooks: the revoke endpoint. */
  revokeUrl?: string;
  apiBase: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  pkce: boolean;
  nonce: boolean;
}

export class LedgerNotConfigured extends Error {}

const XERO_REAL = { authorizeUrl: "https://login.xero.com/identity/connect/authorize", tokenUrl: "https://identity.xero.com/connect/token",
  connectionsUrl: "https://api.xero.com/connections", apiBase: "https://api.xero.com/api.xro/2.0" };
const QBO_REAL = { authorizeUrl: "https://appcenter.intuit.com/connect/oauth2", tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke", apiBase: "https://sandbox-quickbooks.api.intuit.com" };

/**
 * Scopes [ASSUMPTION: from each ledger's published scope lists; not checked against a registered app here]. Xero apps
 * created after its 2026 scope change may need the granular scopes; XERO_SCOPES overrides.
 */
export const XERO_DEFAULT_SCOPES = "openid offline_access accounting.settings.read accounting.contacts.read accounting.transactions";
export const QBO_DEFAULT_SCOPES = "com.intuit.quickbooks.accounting";

export function ledgerEnv(env: Record<string, string | undefined> = process.env): LedgerEnv | undefined {
  const v = env[LEDGER_ENV_VAR];
  return v === "standin" || v === "sandbox" ? v : undefined;
}

function loopback(url: string | undefined, name: string): string {
  if (!url) throw new LedgerNotConfigured(`${name} is not set (the stand-in server's base URL).`);
  let u: URL;
  try { u = new URL(url); } catch { throw new LedgerNotConfigured(`${name} is not a URL.`); }
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new LedgerNotConfigured(`${name} must be a loopback http URL: the stand-in is local only.`);
  return url.replace(/\/+$/, "");
}

/** The configuration of one ledger, or LedgerNotConfigured saying exactly which setting is missing. */
export function providerConfig(provider: LedgerProvider, env: Record<string, string | undefined> = process.env): ProviderConfig {
  const mode = ledgerEnv(env);
  if (!mode) throw new LedgerNotConfigured(`Ledger connections are off (${LEDGER_ENV_VAR} is not "standin" or "sandbox").`);
  if (provider === "xero") {
    const clientId = env.XERO_CLIENT_ID;
    if (!clientId) throw new LedgerNotConfigured("XERO_CLIENT_ID is not set.");
    const base = mode === "standin" ? loopback(env.CLEARLINE_XERO_STANDIN_URL, "CLEARLINE_XERO_STANDIN_URL") : undefined;
    const urls = base ? { authorizeUrl: `${base}/identity/connect/authorize`, tokenUrl: `${base}/connect/token`, connectionsUrl: `${base}/connections`, apiBase: `${base}/api.xro/2.0` } : XERO_REAL;
    return { provider, env: mode, ...urls, revokeUrl: urls.connectionsUrl, clientId, clientSecret: env.XERO_CLIENT_SECRET || undefined, scopes: env.XERO_SCOPES || XERO_DEFAULT_SCOPES, pkce: true, nonce: true };
  }
  const clientId = env.QBO_CLIENT_ID, clientSecret = env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new LedgerNotConfigured("QBO_CLIENT_ID and QBO_CLIENT_SECRET are not set.");
  const base = mode === "standin" ? loopback(env.CLEARLINE_QBO_STANDIN_URL, "CLEARLINE_QBO_STANDIN_URL") : undefined;
  const urls = base ? { authorizeUrl: `${base}/connect/oauth2`, tokenUrl: `${base}/oauth2/v1/tokens/bearer`, revokeUrl: `${base}/oauth2/v1/tokens/revoke`, apiBase: base } : QBO_REAL;
  return { provider, env: mode, ...urls, clientId, clientSecret, scopes: env.QBO_SCOPES || QBO_DEFAULT_SCOPES, pkce: false, nonce: false };
}

export function authorizeUrl(c: ProviderConfig, p: { redirectUri: string; state: string; codeChallenge?: string; nonce?: string }): string {
  const q = new URLSearchParams({ response_type: "code", client_id: c.clientId, redirect_uri: p.redirectUri, scope: c.scopes, state: p.state });
  if (c.pkce && p.codeChallenge) { q.set("code_challenge", p.codeChallenge); q.set("code_challenge_method", "S256"); }
  if (c.nonce && p.nonce) q.set("nonce", p.nonce);
  return `${c.authorizeUrl}?${q}`;
}

/** Why a ledger call failed, without its body. `reconnect` means the person must connect again. */
export class LedgerCallFailed extends Error {
  constructor(readonly kind: "reconnect" | "rate_limited" | "error", readonly status: number, message: string, readonly retryAfterSeconds?: number) { super(message); }
}

export interface TokenSet { accessToken: string; refreshToken: string; expiresInSeconds: number; refreshExpiresInSeconds?: number; idToken?: string; scope?: string }

async function tokenCall(c: ProviderConfig, form: Record<string, string>, fetchFn: Fetch): Promise<TokenSet> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const body = new URLSearchParams(form);
  if (c.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
  else body.set("client_id", c.clientId);
  const res = await fetchFn(c.tokenUrl, { method: "POST", headers, body: body.toString() });
  if (!res.ok) {
    let code = "";
    try { const j = (await res.json()) as { error?: unknown }; code = typeof j.error === "string" ? j.error.replace(/[^a-z_]/g, "").slice(0, 40) : ""; } catch { /* no JSON: status only */ }
    // invalid_grant: the code or the refresh token is expired, used or revoked. A person must connect again.
    if (res.status === 400 && code === "invalid_grant") throw new LedgerCallFailed("reconnect", 400, "The ledger refused the authorisation (expired or revoked). Connect it again.");
    if (res.status === 429) throw new LedgerCallFailed("rate_limited", 429, "The ledger's sign-in service is rate limiting; try again shortly.");
    throw new LedgerCallFailed("error", res.status, `The ledger's token endpoint answered ${res.status}${code ? ` (${code})` : ""}.`);
  }
  const j = (await res.json()) as Record<string, unknown>;
  if (typeof j.access_token !== "string" || typeof j.refresh_token !== "string" || typeof j.expires_in !== "number") throw new LedgerCallFailed("error", res.status, "The ledger's token endpoint returned an incomplete token.");
  return {
    accessToken: j.access_token, refreshToken: j.refresh_token, expiresInSeconds: j.expires_in,
    refreshExpiresInSeconds: typeof j.x_refresh_token_expires_in === "number" ? j.x_refresh_token_expires_in : undefined,
    idToken: typeof j.id_token === "string" ? j.id_token : undefined, scope: typeof j.scope === "string" ? j.scope : undefined,
  };
}

export const exchangeCode = (c: ProviderConfig, p: { code: string; redirectUri: string; codeVerifier?: string }, fetchFn: Fetch) =>
  tokenCall(c, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, ...(c.pkce && p.codeVerifier ? { code_verifier: p.codeVerifier } : {}) }, fetchFn);

export const refreshTokens = (c: ProviderConfig, refreshToken: string, fetchFn: Fetch) => tokenCall(c, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchFn);

/** The nonce claim of an id_token, read without trusting anything else in it (the signature is not checked: see the header). */
export function idTokenNonce(idToken: string): string | undefined {
  const p = idToken.split(".");
  if (p.length !== 3) return undefined;
  try { const claims = JSON.parse(Buffer.from(p[1], "base64url").toString("utf8")) as { nonce?: unknown }; return typeof claims.nonce === "string" ? claims.nonce : undefined; } catch { return undefined; }
}

export interface LedgerTenant { tenantId: string; tenantName: string; connectionId?: string }

/** Xero: the organisations this authorisation covers (ORGANISATION tenants only). */
export async function xeroTenants(c: ProviderConfig, accessToken: string, fetchFn: Fetch): Promise<LedgerTenant[]> {
  const res = await fetchFn(c.connectionsUrl!, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new LedgerCallFailed("reconnect", res.status, "Xero refused the new authorisation. Connect it again.");
  if (!res.ok) throw new LedgerCallFailed("error", res.status, `Xero's connections list answered ${res.status}.`);
  const list = (await res.json()) as { id?: unknown; tenantId?: unknown; tenantName?: unknown; tenantType?: unknown }[];
  if (!Array.isArray(list)) throw new LedgerCallFailed("error", res.status, "Xero's connections list was not a list.");
  return list.filter((o) => o.tenantType === "ORGANISATION" && typeof o.tenantId === "string")
    .map((o) => ({ tenantId: String(o.tenantId), tenantName: String(o.tenantName ?? "").slice(0, 200), connectionId: typeof o.id === "string" ? o.id : undefined }));
}

/** Tell the ledger to forget this authorisation (best effort: Clearline forgets the tokens either way). */
export async function revoke(c: ProviderConfig, p: { accessToken: string; refreshToken: string; xeroConnectionId?: string }, fetchFn: Fetch): Promise<boolean> {
  try {
    if (c.provider === "xero") {
      if (!p.xeroConnectionId) return false;
      const r = await fetchFn(`${c.connectionsUrl}/${encodeURIComponent(p.xeroConnectionId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${p.accessToken}` } });
      return r.ok;
    }
    const r = await fetchFn(c.revokeUrl!, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ token: p.refreshToken }) });
    return r.ok;
  } catch { return false; }
}
