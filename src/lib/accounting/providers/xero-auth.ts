// Connecting to Xero with OAuth 2.0 (authorisation code flow, standard web app).
//
// Setup (once): create a free app at developer.xero.com, add the redirect URI
// <your Clearline URL>/api/accounting/xero/callback, and set XERO_CLIENT_ID and XERO_CLIENT_SECRET in
// the server's environment (never in the repo). Connect from the Books page (/books) and choose the
// Xero Demo Company. Tokens are kept server-side in the data directory, never sent to the browser.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../../data-dir";
import { fileLockKey, withLock, writeAtomic } from "../../lock";
import type { Fetch } from "./xero";

export const XERO_AUTHORIZE = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS = "https://api.xero.com/connections";
/**
 * Scopes. Apps created on or after 2 March 2026 get Xero's granular scopes only, so the broad
 * `accounting.transactions` is no longer requested. Each endpoint `providers/xero.ts` calls, and its scope:
 *   GET /Invoices (import open invoices)            accounting.invoices (covers read)
 *   PUT /CreditNotes (fee write-off)                accounting.invoices (credit notes sit under invoices)
 *   PUT /CreditNotes/{id}/Allocations               accounting.invoices [ASSUMPTION: a credit-note sub-resource]
 *   PUT /Invoices/{id}/History (note)               accounting.invoices [ASSUMPTION: an invoice sub-resource]
 *   PUT /Payments (payment)                         accounting.payments
 *   PUT /BankTransactions (overpayment received)    accounting.banktransactions
 *   Contact IDs read from invoices                  accounting.contacts.read
 * Credit notes need write on `accounting.invoices`, which includes reading invoices, so no separate
 * `accounting.invoices.read`. `openid profile email` identify the user; `offline_access` gives the
 * refresh token. Older apps still on broad scopes (allowed until September 2027) can set XERO_SCOPES.
 * Sources: devblog.xero.com/upcoming-changes-to-xero-accounting-api-scopes-705c5a9621a0, apideck.com/blog/xero-scopes.
 */
export const DEFAULT_SCOPES =
  "openid profile email offline_access accounting.invoices accounting.payments accounting.banktransactions accounting.contacts.read";

/** The scope string sent to Xero: XERO_SCOPES when set, otherwise DEFAULT_SCOPES. */
export const xeroScopes = () => process.env.XERO_SCOPES || DEFAULT_SCOPES;

export interface XeroTokens { accessToken: string; refreshToken: string; expiresAt: number; tenantId: string; tenantName: string }

const tokenFile = () => path.join(dataDir(), "xero-tokens.json");
const clientId = () => process.env.XERO_CLIENT_ID ?? "";
const clientSecret = () => process.env.XERO_CLIENT_SECRET ?? "";
export const xeroConfigured = () => !!clientId() && !!clientSecret();

export function authorizeUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId(), redirect_uri: redirectUri, scope: xeroScopes(), state });
  return `${XERO_AUTHORIZE}?${q}`;
}

const basic = () => `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`;

async function tokenRequest(form: Record<string, string>, fetchFn: Fetch) {
  const res = await fetchFn(XERO_TOKEN, {
    method: "POST", headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) throw new Error(`Xero token request failed (${res.status}).`); // never echo the body: it may contain secrets
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

/** Exchange the code from the callback, pick the organisation, and keep the tokens server-side. */
export async function completeConnection(code: string, redirectUri: string, fetchFn: Fetch = fetch as unknown as Fetch, now = Date.now()): Promise<XeroTokens> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchFn);
  const res = await fetchFn(XERO_CONNECTIONS, { method: "GET", headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Couldn't list Xero organisations (${res.status}).`);
  const orgs = (await res.json()) as { tenantId: string; tenantName: string; tenantType: string }[];
  const org = orgs.find((o) => o.tenantType === "ORGANISATION");
  if (!org) throw new Error("No Xero organisation was authorised.");
  const tokens: XeroTokens = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: now + t.expires_in * 1000, tenantId: org.tenantId, tenantName: org.tenantName };
  await writeAtomic(tokenFile(), JSON.stringify(tokens));
  return tokens;
}

export async function loadTokens(): Promise<XeroTokens | undefined> {
  try { return JSON.parse(await readFile(tokenFile(), "utf8")) as XeroTokens; } catch { return undefined; }
}

/** A fresh access token, refreshed (and saved) when it has less than a minute left. */
export function accessToken(fetchFn: Fetch = fetch as unknown as Fetch, now = Date.now()): Promise<{ token: string; tenantId: string }> {
  // One refresh at a time: Xero replaces the refresh token on every use, so two at once would lose it.
  return withLock(fileLockKey(tokenFile()), () => refreshIfNeeded(fetchFn, now));
}

async function refreshIfNeeded(fetchFn: Fetch, now: number): Promise<{ token: string; tenantId: string }> {
  const t = await loadTokens();
  if (!t) throw new Error("Xero isn't connected. Connect it on the Books page (/books).");
  if (t.expiresAt - now > 60_000) return { token: t.accessToken, tenantId: t.tenantId };
  const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken }, fetchFn);
  const next: XeroTokens = { ...t, accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: now + r.expires_in * 1000 };
  await writeAtomic(tokenFile(), JSON.stringify(next));
  return { token: next.accessToken, tenantId: next.tenantId };
}
