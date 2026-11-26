import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  draftsSupported, LedgerWriteRefused, ORDERS_MAPPING, ordersCsv, readInvoices, readOrganisation, readPayments, writeDraftJournal,
  type DraftJournalRequest, type LedgerFetch, type LedgerSession,
} from "@/lib/accounting/connect/api";
import {
  authorizeUrl, exchangeCode, idTokenNonce, LedgerCallFailed, LedgerNotConfigured, ledgerEnv, providerConfig, refreshTokens, revoke, xeroTenants,
  type LedgerProvider, type LedgerTenant, type ProviderConfig, type TokenSet,
} from "@/lib/accounting/connect/providers";
import { RateLimited, type LedgerRateLimiter } from "@/lib/accounting/connect/rate-limit";
import { LEDGER_CONNECT_POLICY } from "@/lib/net/outbound-hosts";
import { isLoopbackHost, loopbackFetch, safeFetch } from "@/lib/net/safe-fetch";
import { open, pkceChallenge, randomToken, sameText, seal, SealBroken, stateHash, TokenKeyMissing, tokenKey } from "@/lib/accounting/connect/seal";
import { LedgerPullRefused } from "@/lib/accounting/ledger-pull";
import { plainAmount } from "@/lib/clearline/exports/journal-drafts";
import { MERCHANT_ACCOUNTS } from "@/lib/clearline/merchant/journal";
import { postingRulesCatalogue } from "@/lib/clearline/merchant/posting-rules";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { serverAudit } from "./control";
import { RequestRefused } from "./errors";
import { dataModeOf } from "./mapping-templates";
import { AccessDenied, membershipsFor, requireUnscoped, resolveTenant, withTenant, type TenantContext } from "./tenant";
import { createUpload, setUploadMapping, validateUpload } from "./uploads";
import type { UploadStorage } from "./storage";
import { isAppRole } from "./authz";

/**
 * v1 phase 2.3: connecting an organisation's ledger (Xero, QuickBooks Online) and what Clearline does through it.
 *
 *  - Connect (Admin): OAuth 2.0 authorisation code flow, PKCE for Xero, a single-use state bound to the member who
 *    started it AND to their browser (a Lax cookie), a nonce checked against Xero's id_token. Tokens are sealed
 *    (AES-256-GCM, CLEARLINE_LEDGER_TOKEN_KEY) before they reach the database. Xero: the member chooses the
 *    organisation when the authorisation covers several.
 *  - Use: the access token is refreshed (under a row lock, so a rotating refresh token is never lost) before it has
 *    less than two minutes left. A refused refresh (invalid_grant), a passed refresh-token expiry, a 401, or Xero's 403
 *    for a removed connection turns the connection to "needs_reconnect" and the page offers Reconnect.
 *  - Read (Finance, Payment Operations): sales invoices become an orders/invoices UPLOAD (stored, mapped, validated) that
 *    a person confirms like any file; nothing reaches matching without that confirmation. Payments are counted (a
 *    ledger's payment is a claim) and never stored.
 *  - Write (Finance): ONE kind of write, a DRAFT manual journal, and only when postingRulesSigned(org) is true (a
 *    signature table that does not exist means false). One idempotency key per journal and ledger organisation.
 *  - Every call is rate limited per ledger organisation; every connect, refresh failure, read, draft and refusal is
 *    audited with ids and counts only, never a token, an amount or a name from the ledger.
 */

export const LEDGER_CALLBACK_PATH = "/api/control/merchant/ledger/callback";
export const LEDGER_BROWSER_COOKIE = "clearline_ledger_oauth";
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 120_000;
const STALE_SEND_MS = 120_000;

export interface LedgerDeps { fetchFn?: LedgerFetch; now?: () => number; limiter?: LedgerRateLimiter; storage?: UploadStorage; env?: Record<string, string | undefined> }
// wave 2: through the one outbound client: the ledger hosts (LEDGER_CONNECT_POLICY), or the loopback-only client for a
// stand-in (providerConfig allows loopback http URLs only in "standin" mode)
const ledgerFetch = (env: Record<string, string | undefined> | undefined): LedgerFetch => (url, init) => {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* refused below as BAD_URL */ }
  return (isLoopbackHost(host) && ledgerEnv(env ?? process.env) === "standin" ? loopbackFetch(url, init) : safeFetch(url, init, LEDGER_CONNECT_POLICY)) as ReturnType<LedgerFetch>;
};
const fetchOf = (d: LedgerDeps): LedgerFetch => d.fetchFn ?? ledgerFetch(d.env);
const nowOf = (d: LedgerDeps) => (d.now ?? Date.now)();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  // wave 2 (w1-19): a ledger connection serves the whole organisation, so connecting, choosing, reconnecting or
  // disconnecting it needs an Admin whose access is not limited to some entities
  if (p === "ledger_connect") requireUnscoped(ctx);
}
const tenantTx = <T>(ctx: { userId: string; orgId: string }, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const tenantRead = <T>(ctx: { userId: string; orgId: string }, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });

export const ProviderInput = z.enum(["xero", "qbo"]);
const Uuid = z.string().uuid();

function config(provider: LedgerProvider, deps: LedgerDeps): ProviderConfig {
  try {
    const c = providerConfig(provider, deps.env);
    tokenKey(deps.env);
    return c;
  } catch (e) {
    if (e instanceof LedgerNotConfigured || e instanceof TokenKeyMissing) throw new RequestRefused(409, "LEDGER_NOT_CONFIGURED", e.message);
    throw e;
  }
}
const key = (deps: LedgerDeps) => tokenKey(deps.env);

export function ledgerRedirectUri(env: Record<string, string | undefined> = process.env): string {
  const origin = env.CLEARLINE_ORIGIN;
  if (!origin) throw new RequestRefused(409, "LEDGER_NOT_CONFIGURED", "CLEARLINE_ORIGIN is not set.");
  return `${origin.replace(/\/+$/, "")}${LEDGER_CALLBACK_PATH}`;
}

/** Maps a ledger failure to a refusal the page can show, turning the connection to needs_reconnect when it must. */
async function ledgerFailure(ctx: { userId: string; orgId: string }, connectionId: string | undefined, e: unknown): Promise<never> {
  if (e instanceof RateLimited) throw new RequestRefused(429, "LEDGER_RATE_LIMITED", e.message);
  if (e instanceof LedgerWriteRefused) throw new RequestRefused(409, `LEDGER_${e.code}`, e.message);
  if (e instanceof LedgerPullRefused) throw new RequestRefused(502, `LEDGER_${e.code}`, e.message);
  if (e instanceof SealBroken) {
    if (connectionId) await markReconnect(ctx, connectionId, "Clearline could not open the stored authorisation (the key changed?). Connect again.");
    throw new RequestRefused(409, "LEDGER_RECONNECT", "Connect the ledger again: the stored authorisation can no longer be opened.");
  }
  if (e instanceof LedgerCallFailed) {
    if (e.kind === "reconnect") {
      if (connectionId) await markReconnect(ctx, connectionId, e.message);
      throw new RequestRefused(409, "LEDGER_RECONNECT", e.message);
    }
    if (e.kind === "rate_limited") throw new RequestRefused(429, "LEDGER_RATE_LIMITED", e.retryAfterSeconds ? `${e.message} (${e.retryAfterSeconds} s)` : e.message);
    throw new RequestRefused(502, "LEDGER_ERROR", e.message);
  }
  throw e;
}

async function markReconnect(ctx: { userId: string; orgId: string }, connectionId: string, reason: string) {
  await tenantTx(ctx, async (tx) => {
    const [row] = await tx.update(t.ledgerConnections).set({ status: "needs_reconnect", reconnectReason: reason.slice(0, 300), accessTokenSealed: null, refreshTokenSealed: null, pendingTokensSealed: null })
      .where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, connectionId), ne(t.ledgerConnections.status, "disconnected"))).returning({ provider: t.ledgerConnections.provider });
    if (row) await serverAudit(tx, ctx as TenantContext, "ledger_reconnect_needed", "ledger_connection", connectionId, `The ${row.provider} connection needs to be connected again.`, { provider: row.provider });
  });
}

// ---------------------------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------------------------

/** The state sent to the ledger: which organisation and member it selects (never proof) and 32 random bytes (the proof). */
const stateFor = (orgId: string, userId: string) => `${orgId}.${Buffer.from(userId, "utf8").toString("base64url")}.${randomToken()}`;
function parseState(state: string): { orgId: string; userId: string } | undefined {
  const p = state.split(".");
  if (p.length !== 3 || !Uuid.safeParse(p[0]).success || !/^[A-Za-z0-9_-]{43}$/.test(p[2])) return undefined;
  const userId = Buffer.from(p[1], "base64url").toString("utf8");
  return userId && userId.length <= 200 ? { orgId: p[0], userId } : undefined;
}

/** Start connecting (or reconnecting) a ledger. Returns where to send the browser and the browser-binding cookie value. */
export async function startLedgerConnect(ctx: TenantContext, input: { provider: string }, deps: LedgerDeps = {}) {
  require(ctx, "ledger_connect");
  const provider = ProviderInput.parse(input.provider);
  const c = config(provider, deps);
  const redirectUri = ledgerRedirectUri(deps.env);
  const state = stateFor(ctx.orgId, ctx.userId), browser = randomToken(), verifier = c.pkce ? randomToken() : undefined, nonce = c.nonce ? randomToken() : undefined;
  const id = randomUUID(), now = nowOf(deps);
  await tenantTx(ctx, async (tx) => {
    const { dataMode } = await dataModeOf(tx, ctx.orgId);
    if (dataMode !== "live") throw new RequestRefused(409, "SAMPLE_ORGANISATION", "This organisation holds sample data; connect a ledger to your live organisation.");
    await tx.insert(t.ledgerOauthStates).values({
      orgId: ctx.orgId, id, stateHash: stateHash(state), browserHash: sha256(browser), provider, redirectUri, nonce: nonce ?? null,
      pkceVerifierSealed: verifier ? seal(verifier, { orgId: ctx.orgId, connectionId: id, field: "pkce_verifier" }, key(deps)) : null,
      createdBy: ctx.userId, createdAt: new Date(now), expiresAt: new Date(now + STATE_TTL_MS),
    });
    await serverAudit(tx, ctx, "ledger_connect_started", "ledger_oauth_state", id, `Started connecting ${provider} (${c.env}).`, { provider, env: c.env });
  });
  return { authorizeUrl: authorizeUrl(c, { redirectUri, state, codeChallenge: verifier ? pkceChallenge(verifier) : undefined, nonce }), browserBinding: browser, provider, env: c.env };
}

interface PendingTokens { accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number | null }
const sealTokens = (orgId: string, connectionId: string, tok: PendingTokens, k: Buffer) => ({
  accessTokenSealed: seal(tok.accessToken, { orgId, connectionId, field: "access_token" }, k),
  refreshTokenSealed: seal(tok.refreshToken, { orgId, connectionId, field: "refresh_token" }, k),
  accessExpiresAt: new Date(tok.accessExpiresAt), refreshExpiresAt: tok.refreshExpiresAt ? new Date(tok.refreshExpiresAt) : null,
});
/**
 * Xero does not say when a refresh token expires [ASSUMPTION: its documentation gives 60 days unused]; QuickBooks does
 * (x_refresh_token_expires_in). Past that time the connection asks for Reconnect instead of trying.
 */
const XERO_REFRESH_SECONDS = 60 * 86_400;
const pendingOf = (ts: TokenSet, now: number, provider: LedgerProvider): PendingTokens => {
  const refreshSeconds = ts.refreshExpiresInSeconds ?? (provider === "xero" ? XERO_REFRESH_SECONDS : undefined);
  return { accessToken: ts.accessToken, refreshToken: ts.refreshToken, accessExpiresAt: now + ts.expiresInSeconds * 1000, refreshExpiresAt: refreshSeconds ? now + refreshSeconds * 1000 : null };
};

/** The organisation a ledger connection will act on: base currency and (sandbox) the demo-company check. */
async function orgCheck(c: ProviderConfig, tenantId: string, accessToken: string, deps: LedgerDeps) {
  const o = await readOrganisation({ config: c, tenantId, accessToken: async () => accessToken, fetchFn: fetchOf(deps), limiter: deps.limiter });
  if (c.env === "sandbox" && !o.isDemoCompany) return { ok: false as const, reason: "Only a Xero Demo Company or a QuickBooks sandbox company can be connected here." };
  return { ok: true as const, baseCurrency: /^[A-Z]{3}$/.test(o.baseCurrency) ? o.baseCurrency : null };
}

export const CallbackInput = z.object({ state: z.string().min(1).max(400), code: z.string().min(1).max(4000).optional(), realmId: z.string().max(64).optional(), error: z.string().max(200).optional() });

/**
 * The ledger sent the browser back. The state selects the organisation and member; the proof is the state's hash on a
 * row that member created, unexpired and unused, and the browser cookie set when they started. The session cookie is
 * not required here (it is SameSite=Strict, so a redirect from the ledger never carries it).
 */
export async function completeLedgerConnect(input: z.input<typeof CallbackInput>, browserBinding: string | undefined, deps: LedgerDeps = {}) {
  const v = CallbackInput.parse(input);
  const sel = parseState(v.state);
  if (!sel || !browserBinding) throw new RequestRefused(400, "LEDGER_STATE_INVALID", "This connection link is not valid here. Start again from the Ledger page.");
  const membership = (await membershipsFor({ userId: sel.userId, name: "", email: "" })).find((m) => m.orgId === sel.orgId);
  if (!membership || !isAppRole(membership.role)) throw new RequestRefused(400, "LEDGER_STATE_INVALID", "This connection link is not valid here. Start again from the Ledger page.");
  // wave 2: the context carries the membership's entity scope (wave 1, w1-19), resolved like every other request's
  const ctx: TenantContext = await resolveTenant({ userId: sel.userId, name: "", email: "" }, membership.slug);
  require(ctx, "ledger_connect");
  const now = nowOf(deps);
  // Consume the state first, in its own transaction: whatever happens next, it is never used again.
  const st = await tenantTx(ctx, async (tx) => {
    const [row] = await tx.select().from(t.ledgerOauthStates).where(and(eq(t.ledgerOauthStates.orgId, ctx.orgId), eq(t.ledgerOauthStates.stateHash, stateHash(v.state)))).for("update");
    if (!row || row.consumedAt || row.createdBy !== ctx.userId) return { ok: false as const, why: "used or unknown" };
    await tx.update(t.ledgerOauthStates).set({ consumedAt: new Date(now) }).where(and(eq(t.ledgerOauthStates.orgId, ctx.orgId), eq(t.ledgerOauthStates.id, row.id)));
    if (row.expiresAt.getTime() < now) return { ok: false as const, why: "expired" };
    if (!sameText(row.browserHash, sha256(browserBinding))) return { ok: false as const, why: "another browser" };
    return { ok: true as const, row };
  });
  if (!st.ok) {
    await tenantTx(ctx, (tx) => serverAudit(tx, ctx, "ledger_connect_refused", null, null, `A ledger connection was refused: the link was ${st.why}.`, { reason: st.why }));
    throw new RequestRefused(400, "LEDGER_STATE_INVALID", "This connection link is not valid here (used, expired or from another browser). Start again from the Ledger page.");
  }
  const row = st.row;
  const provider = ProviderInput.parse(row.provider);
  const c = config(provider, deps);
  if (v.error || !v.code) {
    await tenantTx(ctx, (tx) => serverAudit(tx, ctx, "ledger_connect_refused", "ledger_oauth_state", row.id, `The ${provider} authorisation was declined or failed.`, { provider }));
    throw new RequestRefused(409, "LEDGER_DECLINED", "The ledger did not authorise the connection. Nothing was connected.");
  }
  try {
    const verifier = row.pkceVerifierSealed ? open(row.pkceVerifierSealed, { orgId: ctx.orgId, connectionId: row.id, field: "pkce_verifier" }, key(deps)) : undefined;
    const tok = await exchangeCode(c, { code: v.code, redirectUri: row.redirectUri, codeVerifier: verifier }, fetchOf(deps));
    if (row.nonce && tok.idToken && idTokenNonce(tok.idToken) !== row.nonce) {
      await tenantTx(ctx, (tx) => serverAudit(tx, ctx, "ledger_connect_refused", "ledger_oauth_state", row.id, `The ${provider} sign-in answer did not carry the expected nonce.`, { provider, reason: "nonce" }));
      throw new RequestRefused(400, "LEDGER_NONCE_MISMATCH", "The ledger's answer did not match this connection attempt. Nothing was connected.");
    }
    let tenants: LedgerTenant[];
    if (provider === "xero") tenants = await xeroTenants(c, tok.accessToken, fetchOf(deps));
    else {
      if (!v.realmId || !/^\d{1,32}$/.test(v.realmId)) throw new RequestRefused(400, "LEDGER_NO_COMPANY", "QuickBooks did not name a company. Nothing was connected.");
      tenants = [{ tenantId: v.realmId, tenantName: "" }];
    }
    if (!tenants.length) throw new RequestRefused(409, "LEDGER_NO_COMPANY", "No ledger organisation was authorised. Nothing was connected.");
    return await saveConnection(ctx, c, pendingOf(tok, now, provider), tenants, deps);
  } catch (e) { return ledgerFailure(ctx, undefined, e); }
}

async function saveConnection(ctx: TenantContext, c: ProviderConfig, tok: PendingTokens, tenants: LedgerTenant[], deps: LedgerDeps) {
  const k = key(deps), now = nowOf(deps);
  // An existing live connection keeps its ledger organisation: reconnecting must authorise that same organisation.
  const existing = await tenantRead(ctx, async (tx) => (await tx.select().from(t.ledgerConnections)
    .where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.provider, c.provider), ne(t.ledgerConnections.status, "disconnected"))))[0]);
  const id = existing?.id ?? randomUUID();
  const keep = existing?.tenantId ? tenants.find((x) => x.tenantId === existing.tenantId) : undefined;
  const single = !existing?.tenantId && tenants.length === 1 ? tenants[0] : undefined;
  const chosen = keep ?? single;
  let status: "active" | "choose_tenant" | "needs_reconnect";
  let reason: string | null = null, baseCurrency: string | null = existing?.baseCurrency ?? null;
  if (existing?.tenantId && !keep) { status = "needs_reconnect"; reason = "The ledger organisation this connection uses was not authorised. Reconnect and choose it, or disconnect and connect again."; }
  else if (chosen) {
    const o = await orgCheck(c, chosen.tenantId, tok.accessToken, deps);
    if (o.ok) { status = "active"; baseCurrency = o.baseCurrency; } else { status = "needs_reconnect"; reason = o.reason; }
  } else status = "choose_tenant";
  const sealed = status === "active" ? sealTokens(ctx.orgId, id, tok, k) : { accessTokenSealed: null, refreshTokenSealed: null, accessExpiresAt: null, refreshExpiresAt: null };
  const pending = status === "choose_tenant" ? seal(JSON.stringify(tok), { orgId: ctx.orgId, connectionId: id, field: "pending_tokens" }, k) : null;
  const choices = status === "choose_tenant" ? tenants.map((x) => ({ tenantId: x.tenantId, tenantName: x.tenantName, connectionId: x.connectionId ?? null })) : null;
  const tenantName = chosen?.tenantName || existing?.tenantName || null;
  const values = {
    status, ...sealed, pendingTokensSealed: pending, tenantChoices: choices, reconnectReason: reason, baseCurrency, scopes: c.scopes,
    tenantId: status === "active" ? chosen!.tenantId : existing?.tenantId ?? null, tenantName,
    xeroConnectionId: chosen?.connectionId ?? existing?.xeroConnectionId ?? null,
    connectedAt: status === "active" ? new Date(now) : existing?.connectedAt ?? null, lastRefreshedAt: null,
  };
  await tenantTx(ctx, async (tx) => {
    if (existing) await tx.update(t.ledgerConnections).set(values).where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, id)));
    else await tx.insert(t.ledgerConnections).values({ orgId: ctx.orgId, id, provider: c.provider, ledgerEnv: c.env, createdBy: ctx.userId, ...values });
    await serverAudit(tx, ctx, status === "active" ? "ledger_connected" : status === "choose_tenant" ? "ledger_connect_choose" : "ledger_reconnect_needed", "ledger_connection", id,
      status === "active" ? `Connected ${c.provider} (${c.env}).` : status === "choose_tenant" ? `${c.provider} authorised ${tenants.length} organisations; one must be chosen.` : `The ${c.provider} connection was not completed.`,
      { provider: c.provider, env: c.env, status, organisations: tenants.length, reconnect: !!existing });
  });
  return { connectionId: id, status, provider: c.provider };
}

/** Xero, several organisations authorised: the Admin picks one. The connection never changes organisation afterwards. */
export const ChooseTenantInput = z.object({ connectionId: Uuid, tenantId: z.string().min(1).max(64) }).strict();
export async function chooseLedgerTenant(ctx: TenantContext, input: z.input<typeof ChooseTenantInput>, deps: LedgerDeps = {}) {
  require(ctx, "ledger_connect");
  const v = ChooseTenantInput.parse(input);
  const row = await connectionRow(ctx, v.connectionId);
  if (row.status !== "choose_tenant" || !row.pendingTokensSealed) throw new RequestRefused(409, "LEDGER_NOT_CHOOSING", "This connection is not waiting for an organisation to be chosen.");
  const choice = ((row.tenantChoices as { tenantId: string; tenantName: string; connectionId: string | null }[] | null) ?? []).find((x) => x.tenantId === v.tenantId);
  if (!choice) throw new RequestRefused(422, "LEDGER_TENANT_UNKNOWN", "That organisation was not authorised in this connection.");
  const c = config(ProviderInput.parse(row.provider), deps);
  try {
    let tok = JSON.parse(open(row.pendingTokensSealed, { orgId: ctx.orgId, connectionId: row.id, field: "pending_tokens" }, key(deps))) as PendingTokens;
    if (tok.accessExpiresAt - nowOf(deps) < REFRESH_MARGIN_MS) tok = pendingOf(await refreshTokens(c, tok.refreshToken, fetchOf(deps)), nowOf(deps), c.provider);
    const o = await orgCheck(c, choice.tenantId, tok.accessToken, deps);
    await tenantTx(ctx, async (tx) => {
      if (!o.ok) {
        await tx.update(t.ledgerConnections).set({ status: "needs_reconnect", reconnectReason: o.reason, pendingTokensSealed: null }).where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, row.id)));
        await serverAudit(tx, ctx, "ledger_reconnect_needed", "ledger_connection", row.id, `The chosen ${row.provider} organisation cannot be connected here.`, { provider: row.provider });
        return;
      }
      await tx.update(t.ledgerConnections).set({
        status: "active", tenantId: choice.tenantId, tenantName: choice.tenantName, xeroConnectionId: choice.connectionId, baseCurrency: o.baseCurrency,
        ...sealTokens(ctx.orgId, row.id, tok, key(deps)), pendingTokensSealed: null, tenantChoices: null, connectedAt: new Date(nowOf(deps)), reconnectReason: null,
      }).where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, row.id)));
      await serverAudit(tx, ctx, "ledger_connected", "ledger_connection", row.id, `Connected ${row.provider} (${row.ledgerEnv}) after choosing the organisation.`, { provider: row.provider, env: row.ledgerEnv });
    });
    if (!o.ok) throw new RequestRefused(409, "LEDGER_NOT_DEMO_COMPANY", o.reason);
    return { connectionId: row.id, status: "active" as const };
  } catch (e) { return ledgerFailure(ctx, row.id, e); }
}

export const ConnectionInput = z.object({ connectionId: Uuid }).strict();
/** Disconnect: Clearline forgets the tokens (and asks the ledger to revoke them, best effort). Drafts already written stay recorded. */
export async function disconnectLedger(ctx: TenantContext, input: z.input<typeof ConnectionInput>, deps: LedgerDeps = {}) {
  require(ctx, "ledger_connect");
  const v = ConnectionInput.parse(input);
  const row = await connectionRow(ctx, v.connectionId);
  if (row.status === "disconnected") return { connectionId: row.id, status: "disconnected" as const, revoked: false };
  let revoked = false;
  if (row.accessTokenSealed && row.refreshTokenSealed) {
    try {
      const c = providerConfig(ProviderInput.parse(row.provider), deps.env);
      revoked = await revoke(c, { accessToken: open(row.accessTokenSealed, { orgId: ctx.orgId, connectionId: row.id, field: "access_token" }, key(deps)),
        refreshToken: open(row.refreshTokenSealed, { orgId: ctx.orgId, connectionId: row.id, field: "refresh_token" }, key(deps)), xeroConnectionId: row.xeroConnectionId ?? undefined }, fetchOf(deps));
    } catch { revoked = false; }
  }
  await tenantTx(ctx, async (tx) => {
    await tx.update(t.ledgerConnections).set({ status: "disconnected", accessTokenSealed: null, refreshTokenSealed: null, pendingTokensSealed: null, disconnectedAt: new Date(nowOf(deps)) })
      .where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, row.id)));
    await serverAudit(tx, ctx, "ledger_disconnected", "ledger_connection", row.id, `Disconnected ${row.provider}; tokens deleted${revoked ? " and revoked at the ledger" : ""}.`, { provider: row.provider, revoked });
  });
  return { connectionId: row.id, status: "disconnected" as const, revoked };
}

async function connectionRow(ctx: { userId: string; orgId: string }, connectionId: string) {
  const [row] = await tenantRead(ctx, (tx) => tx.select().from(t.ledgerConnections).where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, connectionId))));
  if (!row) throw new AccessDenied(404, "Not found.");
  return row;
}

/** This organisation's ledger connections, for the Ledger page: never a token, sealed or not. */
export async function listLedgerConnections(ctx: TenantContext) {
  require(ctx, "read");
  const rows = await tenantRead(ctx, (tx) => tx.select().from(t.ledgerConnections).where(eq(t.ledgerConnections.orgId, ctx.orgId)).orderBy(t.ledgerConnections.createdAt));
  return rows.map((r) => ({
    id: r.id, provider: r.provider as LedgerProvider, env: r.ledgerEnv, status: r.status, tenantName: r.tenantName, baseCurrency: r.baseCurrency,
    tenantChoices: r.status === "choose_tenant" ? ((r.tenantChoices as { tenantId: string; tenantName: string }[] | null) ?? []).map((x) => ({ tenantId: x.tenantId, tenantName: x.tenantName })) : [],
    accessExpiresAt: r.accessExpiresAt?.toISOString() ?? null, refreshExpiresAt: r.refreshExpiresAt?.toISOString() ?? null, reconnectReason: r.reconnectReason,
    connectedAt: r.connectedAt?.toISOString() ?? null, lastRefreshedAt: r.lastRefreshedAt?.toISOString() ?? null, disconnectedAt: r.disconnectedAt?.toISOString() ?? null,
    draftsSupported: draftsSupported(r.provider as LedgerProvider),
  }));
}

// ---------------------------------------------------------------------------------------------
// Using a connection: refresh before expiry, detect revoked access
// ---------------------------------------------------------------------------------------------

/** An active connection's session, refreshing the access token first when it has under two minutes left. */
export async function ledgerSession(ctx: { userId: string; orgId: string }, connectionId: string, deps: LedgerDeps = {}): Promise<LedgerSession & { row: typeof t.ledgerConnections.$inferSelect }> {
  let row = await connectionRow(ctx, connectionId);
  if (row.status !== "active") throw new RequestRefused(409, row.status === "disconnected" ? "LEDGER_DISCONNECTED" : "LEDGER_RECONNECT",
    row.status === "disconnected" ? "This ledger connection was disconnected. Connect again." : row.status === "choose_tenant" ? "Choose the ledger organisation first." : "Connect the ledger again.");
  const c = config(ProviderInput.parse(row.provider), deps);
  const now = nowOf(deps);
  if (row.refreshExpiresAt && row.refreshExpiresAt.getTime() <= now) {
    await markReconnect(ctx, row.id, "The ledger authorisation expired. Connect again.");
    throw new RequestRefused(409, "LEDGER_RECONNECT", "The ledger authorisation expired. Connect the ledger again.");
  }
  try {
    if (row.accessExpiresAt!.getTime() - now < REFRESH_MARGIN_MS) row = await refreshUnderLock(ctx, row.id, c, deps);
    const access = open(row.accessTokenSealed!, { orgId: ctx.orgId, connectionId: row.id, field: "access_token" }, key(deps));
    return { config: c, tenantId: row.tenantId!, accessToken: async () => access, fetchFn: fetchOf(deps), limiter: deps.limiter, row };
  } catch (e) { return ledgerFailure(ctx, row.id, e); }
}

/** One refresh at a time per connection (the row lock): the ledger rotates the refresh token on every use. */
async function refreshUnderLock(ctx: { userId: string; orgId: string }, connectionId: string, c: ProviderConfig, deps: LedgerDeps) {
  const k = key(deps);
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx.select().from(t.ledgerConnections).where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, connectionId))).for("update");
    if (!row || row.status !== "active") throw new LedgerCallFailed("reconnect", 0, "Connect the ledger again.");
    if (row.accessExpiresAt!.getTime() - nowOf(deps) >= REFRESH_MARGIN_MS) return row; // another request refreshed it meanwhile
    const refresh = open(row.refreshTokenSealed!, { orgId: ctx.orgId, connectionId: row.id, field: "refresh_token" }, k);
    const tok = pendingOf(await refreshTokens(c, refresh, fetchOf(deps)), nowOf(deps), c.provider);
    const [next] = await tx.update(t.ledgerConnections).set({ ...sealTokens(ctx.orgId, row.id, tok, k), refreshExpiresAt: tok.refreshExpiresAt ? new Date(tok.refreshExpiresAt) : row.refreshExpiresAt, lastRefreshedAt: new Date(nowOf(deps)) })
      .where(and(eq(t.ledgerConnections.orgId, ctx.orgId), eq(t.ledgerConnections.id, row.id))).returning();
    await serverAudit(tx, ctx as TenantContext, "ledger_token_refreshed", "ledger_connection", row.id, `Refreshed the ${row.provider} access token.`, { provider: row.provider });
    return next;
  });
}

// ---------------------------------------------------------------------------------------------
// Read: invoices into the orders/invoices pipeline; payments counted
// ---------------------------------------------------------------------------------------------

export const ReadInput = z.object({ connectionId: Uuid, entityId: z.string().min(1).max(64) }).strict();

/**
 * Read the ledger's sales invoices into a new orders/invoices upload for this entity (stored, mapped, validated) that a
 * person must confirm before anything reaches matching. Payments are read and counted only.
 */
export async function readLedgerIntoUpload(ctx: TenantContext, input: z.input<typeof ReadInput>, idempotencyKey: string, deps: LedgerDeps = {}) {
  require(ctx, "merchant_upload");
  const v = ReadInput.parse(input);
  const mode = await tenantRead(ctx, (tx) => dataModeOf(tx, ctx.orgId));
  if (mode.dataMode !== "live") throw new RequestRefused(409, "SAMPLE_ORGANISATION", "This organisation holds sample data; ledger invoices go to your live organisation.");
  const s = await ledgerSession(ctx, v.connectionId, deps);
  let invoices, payments;
  try { invoices = await readInvoices(s); payments = await readPayments(s); } catch (e) { return ledgerFailure(ctx, v.connectionId, e); }
  const csv = ordersCsv(invoices);
  if (!csv.rows) throw new RequestRefused(409, "LEDGER_EMPTY", "The ledger returned no issued sales invoices.");
  const day = new Date(nowOf(deps)).toISOString().slice(0, 10);
  const label = `${s.config.provider === "xero" ? "Xero" : "QuickBooks"}${s.config.env === "standin" ? " stand-in" : " sandbox"}`;
  const k = idempotencyKey.slice(0, 100);
  const up = await createUpload(ctx, { entityId: v.entityId, fileType: "orders_invoices", fileName: `${label} invoices ${day}.csv`, bytes: csv.bytes }, `${k}:store`, deps.storage);
  await setUploadMapping(ctx, up.upload.id, { mapping: ORDERS_MAPPING }, `${k}:map`, deps.storage);
  const validated = await validateUpload(ctx, up.upload.id, `${k}:validate`, deps.storage);
  await tenantTx(ctx, (tx) => serverAudit(tx, ctx, "ledger_read", "ledger_connection", v.connectionId,
    `Read ${invoices.length} invoice(s) and ${payments.length} payment(s) from ${s.config.provider}; ${csv.rows} issued invoice(s) into upload ${up.upload.id} for confirmation.`,
    { provider: s.config.provider, invoices: invoices.length, payments: payments.length, rows: csv.rows, draftsLeftOut: csv.draftsLeftOut, uploadId: up.upload.id, entityId: v.entityId }));
  return { status: 201, body: { connectionId: v.connectionId, invoices: invoices.length, issuedInvoices: csv.rows, draftsLeftOut: csv.draftsLeftOut, payments: payments.length, upload: validated.body } };
}

// ---------------------------------------------------------------------------------------------
// Posting-rules signature guard (fail closed)
// ---------------------------------------------------------------------------------------------

/**
 * The signed posting-rules version of this organisation, or null. Reads `posting_rules_signatures` (built in Phase 4)
 * when it exists: a row of this organisation with `revoked_at` null, latest `signed_at` first, its `version`. A
 * missing table, a missing column, no permission or any other error means NOT signed (inside a savepoint, so the
 * caller's transaction carries on).
 */
export async function signedPostingRulesVersion(tx: Tx, orgId: string): Promise<string | null> {
  try {
    return await tx.transaction(async (sp) => {
      const exists = await sp.execute(sql`select to_regclass('public.posting_rules_signatures') is not null as ok`);
      if (!exists.rows[0]?.ok) return null;
      const r = await sp.execute(sql`select version::text as v from public.posting_rules_signatures where org_id = ${orgId} and revoked_at is null order by signed_at desc limit 1`);
      const v = r.rows[0]?.v;
      // wave 2: d2's contract — only a signature of the CURRENT catalogue version counts (an older version is not signed)
      return typeof v === "string" && v === postingRulesCatalogue().version ? v : null;
    });
  } catch { return null; }
}

/** True only when this organisation's posting rules are signed: d2's postingRulesSigned (current version only). */
export { postingRulesSigned } from "./posting-rules";

// ---------------------------------------------------------------------------------------------
// Account mapping and draft journals
// ---------------------------------------------------------------------------------------------

const ACCOUNT_KEYS = Object.keys(MERCHANT_ACCOUNTS) as [keyof typeof MERCHANT_ACCOUNTS, ...(keyof typeof MERCHANT_ACCOUNTS)[]];
export const AccountMapInput = z.object({ connectionId: Uuid, accounts: z.partialRecord(z.enum(ACCOUNT_KEYS), z.string().regex(/^[A-Za-z0-9._-]{1,30}$/)) }).strict();

/** Finance maps Clearline's accounts to the ledger's account codes (per connection). */
export async function setLedgerAccountMap(ctx: TenantContext, input: z.input<typeof AccountMapInput>) {
  require(ctx, "accounting_prepare");
  const v = AccountMapInput.parse(input);
  const row = await connectionRow(ctx, v.connectionId);
  if (row.status === "disconnected") throw new RequestRefused(409, "LEDGER_DISCONNECTED", "This ledger connection was disconnected.");
  const entries = Object.entries(v.accounts);
  if (!entries.length) throw new RequestRefused(422, "ACCOUNT_MAP_EMPTY", "Map at least one account.");
  await tenantTx(ctx, async (tx) => {
    for (const [acct, code] of entries) {
      await tx.insert(t.ledgerAccountMaps).values({ orgId: ctx.orgId, connectionId: row.id, clearlineAccount: acct, ledgerAccountCode: code, setBy: ctx.userId })
        .onConflictDoUpdate({ target: [t.ledgerAccountMaps.orgId, t.ledgerAccountMaps.connectionId, t.ledgerAccountMaps.clearlineAccount], set: { ledgerAccountCode: code, setBy: ctx.userId, setAt: new Date() } });
    }
    await serverAudit(tx, ctx, "ledger_accounts_mapped", "ledger_connection", row.id, `Mapped ${entries.length} account(s) to the ${row.provider} chart of accounts.`, { accounts: entries.map(([a]) => a) });
  });
  return { connectionId: row.id, mapped: entries.length };
}

export const DraftInput = z.object({ connectionId: Uuid, proposalId: z.string().min(1).max(200) }).strict();
const DRAFTABLE = ["proposed", "approved"];

/**
 * Write one journal proposal to the ledger as a DRAFT manual journal. Refused unless the posting rules are signed, the
 * journal is proposed or approved (never exported by file, rejected or superseded), balanced, in the ledger's base
 * currency and every account is mapped. Idempotent: the same journal to the same ledger organisation is written once.
 */
export async function draftJournalToLedger(ctx: TenantContext, input: z.input<typeof DraftInput>, deps: LedgerDeps = {}) {
  require(ctx, "accounting_prepare");
  const v = DraftInput.parse(input);
  const conn = await connectionRow(ctx, v.connectionId);
  if (!draftsSupported(conn.provider as LedgerProvider)) throw new RequestRefused(409, "LEDGER_NO_DRAFTS", "QuickBooks Online has no draft journals; Clearline never writes a journal there. Use the draft journal file instead.");
  if (conn.status !== "active" || !conn.tenantId) throw new RequestRefused(409, conn.status === "disconnected" ? "LEDGER_DISCONNECTED" : "LEDGER_RECONNECT", "Connect the ledger (and choose its organisation) first.");
  const now = nowOf(deps);
  const prep = await tenantTx(ctx, async (tx) => {
    const refuse = async (code: string, message: string) => {
      await serverAudit(tx, ctx, "ledger_journal_draft_refused", "merchant_journal_proposal", v.proposalId, `Draft journal refused: ${code}.`, { code, connectionId: conn.id });
      return { refused: { code, message } } as const;
    };
    const version = await signedPostingRulesVersion(tx, ctx.orgId);
    if (!version) return refuse("POSTING_RULES_UNSIGNED", "The posting rules are not signed for this organisation; nothing is written to the ledger until they are.");
    const [p] = await tx.select().from(t.merchantJournalProposals).where(and(eq(t.merchantJournalProposals.orgId, ctx.orgId), eq(t.merchantJournalProposals.id, v.proposalId)));
    if (!p) throw new AccessDenied(404, "Not found.");
    if (!DRAFTABLE.includes(p.status)) return refuse("JOURNAL_NOT_DRAFTABLE", `This journal is ${p.status}; only a proposed or approved journal is drafted (an exported one may already be in the ledger).`);
    if (!conn.baseCurrency || p.currency !== conn.baseCurrency) return refuse("LEDGER_CURRENCY", `The journal is in ${p.currency}; the ledger's base currency is ${conn.baseCurrency ?? "unknown"}. Nothing is converted.`);
    const lines = p.lines as { side: string; account: string; amountMinor: string }[];
    let sum = 0n;
    for (const l of lines) sum += (l.side === "debit" ? 1n : l.side === "credit" ? -1n : 0n) * BigInt(l.amountMinor);
    if (!lines.length || sum !== 0n || lines.some((l) => l.side !== "debit" && l.side !== "credit")) return refuse("JOURNAL_UNBALANCED", "The journal does not balance; nothing is written.");
    const maps = await tx.select().from(t.ledgerAccountMaps).where(and(eq(t.ledgerAccountMaps.orgId, ctx.orgId), eq(t.ledgerAccountMaps.connectionId, conn.id)));
    const code = new Map(maps.map((m) => [m.clearlineAccount, m.ledgerAccountCode]));
    const unmapped = [...new Set(lines.map((l) => l.account).filter((a) => !code.has(a)))];
    if (unmapped.length) return refuse("ACCOUNT_UNMAPPED", `Map these accounts to the ledger first: ${unmapped.join(", ")}.`);
    const ev = p.evidenceRefs as { entryDate?: string | null; memo?: string };
    const date = ev.entryDate && /^\d{4}-\d{2}-\d{2}$/.test(ev.entryDate) ? ev.entryDate : new Date(now).toISOString().slice(0, 10);
    const request: DraftJournalRequest = {
      narration: `Clearline draft ${p.id} (${p.pattern}); posting rules ${version}`, date, currency: p.currency,
      lines: lines.map((l) => ({ accountCode: code.get(l.account)!, description: `${MERCHANT_ACCOUNTS[l.account as keyof typeof MERCHANT_ACCOUNTS] ?? l.account} (${p.pattern})`,
        amount: plainAmount((l.side === "debit" ? 1n : -1n) * BigInt(l.amountMinor), p.currency) })),
    };
    const requestSha = sha256(JSON.stringify({ tenant: conn.tenantId, request }));
    const idem = `cl-jd-${sha256(`${ctx.orgId}|${conn.id}|${p.id}|${requestSha}`).slice(0, 40)}`;
    const [prior] = await tx.select().from(t.ledgerJournalDrafts).where(and(eq(t.ledgerJournalDrafts.orgId, ctx.orgId), eq(t.ledgerJournalDrafts.ledgerTenantId, conn.tenantId!), eq(t.ledgerJournalDrafts.proposalId, p.id))).for("update");
    if (prior && prior.connectionId !== conn.id) return refuse("JOURNAL_ALREADY_DRAFTED", "This journal was already written to this ledger organisation through an earlier connection.");
    if (prior) {
      if (prior.requestSha256 !== requestSha) return refuse("JOURNAL_CHANGED", "This journal was already sent to this ledger with different content; review it in the ledger.");
      if (prior.status === "drafted") return { replay: prior } as const;
      if (prior.status === "sending" && now - prior.updatedAt.getTime() < STALE_SEND_MS) throw new RequestRefused(409, "LEDGER_DRAFT_IN_PROGRESS", "This journal is being sent to the ledger now.");
      await tx.update(t.ledgerJournalDrafts).set({ status: "sending", attempts: prior.attempts + 1, failure: null }).where(and(eq(t.ledgerJournalDrafts.orgId, ctx.orgId), eq(t.ledgerJournalDrafts.id, prior.id)));
      return { send: { id: prior.id, request, idem, version } } as const;
    }
    const [row] = await tx.insert(t.ledgerJournalDrafts).values({ orgId: ctx.orgId, connectionId: conn.id, ledgerTenantId: conn.tenantId!, entityId: p.entityId, proposalId: p.id, idempotencyKey: idem, requestSha256: requestSha, postingRulesVersion: version, status: "sending", createdBy: ctx.userId })
      .returning({ id: t.ledgerJournalDrafts.id });
    return { send: { id: row.id, request, idem, version } } as const;
  });
  if ("refused" in prep && prep.refused) throw new RequestRefused(409, prep.refused.code, prep.refused.message);
  if ("replay" in prep && prep.replay) return { status: 200, body: { draftId: prep.replay.id, externalId: prep.replay.externalId, status: "drafted", replayed: true } };
  const send = (prep as { send: { id: string; request: DraftJournalRequest; idem: string; version: string } }).send;
  const finish = (status: "drafted" | "failed", externalId: string | null, failure: string | null) => tenantTx(ctx, async (tx) => {
    await tx.update(t.ledgerJournalDrafts).set({ status, externalId, failure }).where(and(eq(t.ledgerJournalDrafts.orgId, ctx.orgId), eq(t.ledgerJournalDrafts.id, send.id)));
    await serverAudit(tx, ctx, status === "drafted" ? "ledger_journal_drafted" : "ledger_journal_draft_failed", "merchant_journal_proposal", v.proposalId,
      status === "drafted" ? `Journal written to ${conn.provider} as a DRAFT (posting rules ${send.version}).` : `Writing the draft journal to ${conn.provider} failed; nothing was drafted.`,
      { connectionId: conn.id, draftId: send.id, idempotencyKey: send.idem, externalId, postingRulesVersion: send.version });
  });
  try {
    const s = await ledgerSession(ctx, conn.id, deps);
    const r = await writeDraftJournal(s, send.request, send.idem);
    await finish("drafted", r.externalId, null);
    return { status: 201, body: { draftId: send.id, externalId: r.externalId, status: "drafted", replayed: false } };
  } catch (e) {
    await finish("failed", null, (e instanceof Error ? e.message : "failed").slice(0, 300));
    return ledgerFailure(ctx, conn.id, e);
  }
}

/** The drafts written through this organisation's connections (ids and statuses). */
export async function listLedgerDrafts(ctx: TenantContext) {
  require(ctx, "read");
  const rows = await tenantRead(ctx, (tx) => tx.select().from(t.ledgerJournalDrafts).where(eq(t.ledgerJournalDrafts.orgId, ctx.orgId)).orderBy(t.ledgerJournalDrafts.createdAt));
  return rows.map((r) => ({ id: r.id, connectionId: r.connectionId, proposalId: r.proposalId, entityId: r.entityId, status: r.status, externalId: r.externalId, postingRulesVersion: r.postingRulesVersion, attempts: r.attempts, createdAt: r.createdAt.toISOString() }));
}

/** The account codes mapped for one connection (Clearline account → ledger code). */
export async function ledgerAccountMap(ctx: TenantContext, connectionId: string): Promise<Record<string, string>> {
  require(ctx, "read");
  const rows = await tenantRead(ctx, (tx) => tx.select().from(t.ledgerAccountMaps).where(and(eq(t.ledgerAccountMaps.orgId, ctx.orgId), eq(t.ledgerAccountMaps.connectionId, Uuid.parse(connectionId)))));
  return Object.fromEntries(rows.map((r) => [r.clearlineAccount, r.ledgerAccountCode]));
}
