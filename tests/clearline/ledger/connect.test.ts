/**
 * v1 phase 2.3: the pure parts of the ledger connection: token sealing, PKCE, provider configuration (stand-in, sandbox,
 * off), the rate limiter, the draft-only journal body, the orders CSV and how ledger answers are classified. Nothing
 * here calls a ledger: every fetch is a fake in this file. Every value is fictional.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, pkceChallenge, randomToken, seal, SealBroken, stateHash, TokenKeyMissing, tokenKey } from "@/lib/accounting/connect/seal";
import { authorizeUrl, exchangeCode, idTokenNonce, LedgerCallFailed, LedgerNotConfigured, providerConfig, refreshTokens } from "@/lib/accounting/connect/providers";
import { LedgerRateLimiter, RateLimited, retryAfterSeconds } from "@/lib/accounting/connect/rate-limit";
import {
  assertDraftOnly, LedgerWriteRefused, ORDERS_MAPPING, ordersCsv, readInvoices, readPayments, writeDraftJournal, xeroDraftJournalBody,
  type LedgerFetch, type LedgerInvoice, type LedgerSession,
} from "@/lib/accounting/connect/api";
import { validateMapping } from "@/lib/clearline/mapping";

const KEY = randomBytes(32);
const CTX = { orgId: "00000000-0000-4000-8000-0000000000a1", connectionId: "00000000-0000-4000-8000-0000000000c1", field: "access_token" as const };
const STANDIN = { CLEARLINE_LEDGER_ENV: "standin", XERO_CLIENT_ID: "fictional-client", CLEARLINE_XERO_STANDIN_URL: "http://127.0.0.1:4169", QBO_CLIENT_ID: "q", QBO_CLIENT_SECRET: "s", CLEARLINE_QBO_STANDIN_URL: "http://127.0.0.1:4168" };

type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };
function fake(answers: Answer[] | ((url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Answer)) {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const f: LedgerFetch = async (url, init) => {
    seen.push({ url, ...init });
    const a = typeof answers === "function" ? answers(url, init) : answers.shift() ?? { status: 500 };
    const status = a.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => a.headers?.[n.toLowerCase()] ?? null }, json: async () => a.body, text: async () => JSON.stringify(a.body ?? "") };
  };
  return { f, seen };
}
const session = (provider: "xero" | "qbo", f: LedgerFetch, limiter = new LedgerRateLimiter()): LedgerSession =>
  ({ config: providerConfig(provider, STANDIN), tenantId: provider === "xero" ? "tenant-1" : "9130350000000001", accessToken: async () => "fictional-access", fetchFn: f, limiter });

describe("tokens sealed at rest", () => {
  it("round-trips, and opens only for the same organisation, connection, field and key", () => {
    const sealed = seal("fictional-token-value", CTX, KEY);
    expect(sealed).toMatch(/^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("fictional-token-value");
    expect(open(sealed, CTX, KEY)).toBe("fictional-token-value");
    expect(seal("fictional-token-value", CTX, KEY)).not.toBe(sealed); // a fresh IV every time
    expect(() => open(sealed, { ...CTX, orgId: "00000000-0000-4000-8000-0000000000a2" }, KEY)).toThrow(SealBroken);
    expect(() => open(sealed, { ...CTX, field: "refresh_token" }, KEY)).toThrow(SealBroken);
    expect(() => open(sealed, CTX, randomBytes(32))).toThrow(/another key/);
    const p = sealed.split(".");
    p[4] = Buffer.from("tampered").toString("base64url");
    expect(() => open(p.join("."), CTX, KEY)).toThrow(SealBroken);
  });

  it("refuses without a 32-byte key (fail closed)", () => {
    expect(() => tokenKey({})).toThrow(TokenKeyMissing);
    expect(() => tokenKey({ CLEARLINE_LEDGER_TOKEN_KEY: Buffer.alloc(16).toString("base64") })).toThrow(TokenKeyMissing);
    expect(tokenKey({ CLEARLINE_LEDGER_TOKEN_KEY: KEY.toString("base64") }).equals(KEY)).toBe(true);
  });

  it("PKCE S256 matches RFC 7636's example; states are random and stored as hashes", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const a = randomToken(), b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(stateHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(stateHash(a)).not.toContain(a);
  });
});

describe("provider configuration", () => {
  it("is off unless CLEARLINE_LEDGER_ENV is standin or sandbox; there is no production setting", () => {
    expect(() => providerConfig("xero", {})).toThrow(LedgerNotConfigured);
    expect(() => providerConfig("xero", { ...STANDIN, CLEARLINE_LEDGER_ENV: "production" })).toThrow(LedgerNotConfigured);
    expect(() => providerConfig("qbo", { ...STANDIN, QBO_CLIENT_SECRET: "" })).toThrow(/QBO_CLIENT_SECRET/);
  });

  it("stand-in URLs must be loopback http", () => {
    expect(() => providerConfig("xero", { ...STANDIN, CLEARLINE_XERO_STANDIN_URL: "https://api.xero.com" })).toThrow(/loopback/);
    expect(() => providerConfig("xero", { ...STANDIN, CLEARLINE_XERO_STANDIN_URL: "http://10.0.0.5:4169" })).toThrow(/loopback/);
    expect(providerConfig("xero", STANDIN)).toMatchObject({ env: "standin", tokenUrl: "http://127.0.0.1:4169/connect/token", apiBase: "http://127.0.0.1:4169/api.xro/2.0", pkce: true });
  });

  it("sandbox points at Xero and at the QuickBooks SANDBOX host only", () => {
    const env = { CLEARLINE_LEDGER_ENV: "sandbox", XERO_CLIENT_ID: "x", QBO_CLIENT_ID: "q", QBO_CLIENT_SECRET: "s" };
    expect(providerConfig("xero", env)).toMatchObject({ authorizeUrl: "https://login.xero.com/identity/connect/authorize", apiBase: "https://api.xero.com/api.xro/2.0" });
    expect(providerConfig("qbo", env).apiBase).toBe("https://sandbox-quickbooks.api.intuit.com");
  });

  it("sends PKCE and a nonce to Xero, state only to QuickBooks", () => {
    const x = new URL(authorizeUrl(providerConfig("xero", STANDIN), { redirectUri: "http://127.0.0.1:4160/cb", state: "st", codeChallenge: "ch", nonce: "nn" }));
    expect(Object.fromEntries(x.searchParams)).toMatchObject({ response_type: "code", client_id: "fictional-client", redirect_uri: "http://127.0.0.1:4160/cb", state: "st", code_challenge: "ch", code_challenge_method: "S256", nonce: "nn" });
    const q = new URL(authorizeUrl(providerConfig("qbo", STANDIN), { redirectUri: "http://127.0.0.1:4160/cb", state: "st", codeChallenge: "ch", nonce: "nn" }));
    expect(q.searchParams.get("code_challenge")).toBeNull();
    expect(q.searchParams.get("nonce")).toBeNull();
    expect(q.searchParams.get("state")).toBe("st");
  });
});

describe("token endpoint answers", () => {
  it("invalid_grant means reconnect; other failures never quote the body", async () => {
    const c = providerConfig("xero", STANDIN);
    const r1 = fake([{ status: 400, body: { error: "invalid_grant", secret: "ZQX-TOKEN-ECHO" } }]);
    const e1 = await refreshTokens(c, "r", r1.f).catch((e) => e);
    expect(e1).toBeInstanceOf(LedgerCallFailed);
    expect(e1.kind).toBe("reconnect");
    const e2 = await exchangeCode(c, { code: "c", redirectUri: "u", codeVerifier: "v" }, fake([{ status: 500, body: { error: "server_error", detail: "ZQX-TOKEN-ECHO" } }]).f).catch((e) => e);
    expect(e2.kind).toBe("error");
    expect(String(e2.message)).not.toContain("ZQX");
    // a public PKCE client sends its id and the verifier, no secret
    const r3 = fake([{ body: { access_token: "a", refresh_token: "b", expires_in: 1800 } }]);
    await exchangeCode(c, { code: "c", redirectUri: "u", codeVerifier: "v" }, r3.f);
    expect(new URLSearchParams(r3.seen[0].body)).toEqual(new URLSearchParams({ grant_type: "authorization_code", code: "c", redirect_uri: "u", code_verifier: "v", client_id: "fictional-client" }));
    expect(r3.seen[0].headers.Authorization).toBeUndefined();
  });

  it("reads an id_token's nonce and nothing else", () => {
    const tok = `x.${Buffer.from(JSON.stringify({ nonce: "n-1", email: "someone@fictional.example" })).toString("base64url")}.y`;
    expect(idTokenNonce(tok)).toBe("n-1");
    expect(idTokenNonce("not-a-jwt")).toBeUndefined();
  });
});

describe("rate limits", () => {
  it("stops at the per-minute ceiling, recovers after a minute, and honours a ledger's Retry-After", () => {
    let now = 1_000_000;
    const l = new LedgerRateLimiter({ xero: { perMinute: 3, perDay: 5 }, qbo: { perMinute: 1, perDay: 1 } }, () => now);
    for (let i = 0; i < 3; i++) l.take("xero", "t1");
    expect(() => l.take("xero", "t1")).toThrow(RateLimited);
    l.take("xero", "t2"); // another organisation has its own count
    now += 60_001;
    l.take("xero", "t1"); l.take("xero", "t1");
    expect(() => l.take("xero", "t1")).toThrow(/try again/); // the day's ceiling (5)
    l.backOff("qbo", "r1", 7);
    expect(() => l.take("qbo", "r1")).toThrow(RateLimited);
    now += 7_001;
    l.take("qbo", "r1");
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThan(25);
    expect(retryAfterSeconds("soon")).toBeUndefined();
  });
});

describe("reads", () => {
  it("only GETs, maps Xero invoices and payments exactly, and classifies 401, 403 and 429", async () => {
    const r = fake((url) => url.includes("/Invoices") ? { body: { Invoices: [{ InvoiceID: "i1", InvoiceNumber: "INV-1", CurrencyCode: "SGD", Total: "1350.00", AmountDue: "0", Status: "PAID", DateString: "2026-11-01T00:00:00" }] } }
      : { body: { Payments: [{ PaymentID: "p1", Amount: 1350, Date: "/Date(1793577600000+0000)/", Status: "AUTHORISED", Invoice: { InvoiceID: "i1", InvoiceNumber: "INV-1", CurrencyCode: "SGD" } }] } });
    const s = session("xero", r.f);
    expect(await readInvoices(s)).toEqual([{ ledgerId: "i1", invoiceNumber: "INV-1", currency: "SGD", total: "1350.00", amountDue: "0", status: "paid", issuedOn: "2026-11-01" }]);
    expect(await readPayments(s)).toEqual([{ ledgerId: "p1", invoiceLedgerId: "i1", invoiceNumber: "INV-1", amount: "1350", currency: "SGD", paidOn: "2026-11-02", status: "AUTHORISED" }]);
    expect(r.seen.every((x) => x.method === "GET" && x.body === undefined && x.headers["xero-tenant-id"] === "tenant-1")).toBe(true);
    expect((await readInvoices(session("xero", fake([{ status: 401 }]).f)).catch((e) => e)).kind).toBe("reconnect");
    expect((await readInvoices(session("xero", fake([{ status: 403 }]).f)).catch((e) => e)).kind).toBe("reconnect");
    const lim = new LedgerRateLimiter();
    const e = await readInvoices(session("xero", fake([{ status: 429, headers: { "retry-after": "9" } }]).f, lim)).catch((x) => x);
    expect([e.kind, e.retryAfterSeconds]).toEqual(["rate_limited", 9]);
    expect(() => lim.take("xero", "tenant-1")).toThrow(RateLimited); // blocked until Retry-After, without calling
  });

  it("maps QuickBooks payments to the invoices they are linked to", async () => {
    const r = fake([{ body: { QueryResponse: { Payment: [{ Id: "201", TotalAmt: 250, TxnDate: "2026-11-04", CurrencyRef: { value: "USD" }, Line: [{ Amount: 250, LinkedTxn: [{ TxnId: "101", TxnType: "Invoice" }, { TxnId: "9", TxnType: "CreditMemo" }] }] }] } } }]);
    expect(await readPayments(session("qbo", r.f))).toEqual([{ ledgerId: "201", invoiceLedgerId: "101", invoiceNumber: "", amount: "250", currency: "USD", paidOn: "2026-11-04", status: "recorded" }]);
    expect(r.seen[0].url).toContain("/v3/company/9130350000000001/query?query=");
  });
});

describe("invoices into the orders/invoices model", () => {
  const inv = (n: string, status: LedgerInvoice["status"], total = "1.00"): LedgerInvoice => ({ ledgerId: `id-${n}`, invoiceNumber: n, currency: "SGD", total, amountDue: total, status, issuedOn: "2026-11-01" });
  it("keeps issued invoices (open or void), leaves drafts out, keeps exact totals and neutralises formulas", () => {
    const r = ordersCsv([inv("INV-2", "paid", "9007199254740993.27"), inv("INV-1", "open"), inv("INV-3", "void"), inv("INV-4", "draft"), inv("=CMD()", "open")]);
    expect([r.rows, r.draftsLeftOut]).toEqual([4, 1]);
    expect(new TextDecoder().decode(r.bytes).split("\r\n")).toEqual([
      "Order ID,Invoice Amount,Currency,Status,Ledger ID", "\"'=CMD()\",1.00,SGD,open,id-=CMD()", "INV-1,1.00,SGD,open,id-INV-1", "INV-2,9007199254740993.27,SGD,open,id-INV-2", "INV-3,1.00,SGD,void,id-INV-3", "",
    ]);
    expect(validateMapping(ORDERS_MAPPING, ["Order ID", "Invoice Amount", "Currency", "Status", "Ledger ID"]).ok).toBe(true);
  });
});

describe("draft journals only", () => {
  const j = { narration: "Clearline draft JP-1", date: "2026-11-05", currency: "SGD", lines: [{ accountCode: "610", description: "AR", amount: "-1350.00" }, { accountCode: "090", description: "Clearing", amount: "1350.00" }] };
  it("builds a DRAFT body and refuses any other status before sending", () => {
    const body = xeroDraftJournalBody(j);
    expect(body.ManualJournals[0]).toMatchObject({ Status: "DRAFT", Date: "2026-11-05", JournalLines: [{ LineAmount: -1350, AccountCode: "610" }, { LineAmount: 1350, AccountCode: "090" }] });
    for (const st of ["POSTED", "AUTHORISED", "draft", ""]) expect(() => assertDraftOnly({ ManualJournals: [{ Status: st }] })).toThrow(LedgerWriteRefused);
    expect(() => assertDraftOnly({ ManualJournals: [] })).toThrow(LedgerWriteRefused);
  });

  it("sends one PUT with the idempotency key; a non-draft answer is a failure; QuickBooks is never written", async () => {
    const r = fake([{ body: { ManualJournals: [{ ManualJournalID: "mj-1", Status: "DRAFT" }] } }, { body: { ManualJournals: [{ ManualJournalID: "mj-2", Status: "POSTED" }] } }]);
    expect(await writeDraftJournal(session("xero", r.f), j, "cl-jd-1")).toEqual({ externalId: "mj-1", status: "DRAFT" });
    expect([r.seen[0].method, r.seen[0].headers["Idempotency-Key"], JSON.parse(r.seen[0].body!).ManualJournals[0].Status]).toEqual(["PUT", "cl-jd-1", "DRAFT"]);
    await expect(writeDraftJournal(session("xero", r.f), j, "cl-jd-2")).rejects.toThrow(/not record the journal as a draft/);
    const q = fake([]);
    await expect(writeDraftJournal(session("qbo", q.f), j, "cl-jd-3")).rejects.toMatchObject({ code: "NO_DRAFTS" });
    expect(q.seen).toHaveLength(0);
    await expect(writeDraftJournal(session("xero", q.f), { ...j, lines: [{ accountCode: "1", description: "x", amount: "90071992547409.93" }, { accountCode: "2", description: "y", amount: "-90071992547409.93" }] }, "k"))
      .rejects.toMatchObject({ code: "AMOUNT_PRECISION" });
    expect(q.seen).toHaveLength(0);
  });
});
