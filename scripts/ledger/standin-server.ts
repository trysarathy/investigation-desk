/**
 * v1 phase 2.3: LOCAL stand-in servers for the Xero and QuickBooks Online OAuth 2.0 and accounting APIs, with fictional
 * organisations and invoices only. Used by the tests (tests/control/ledger-connect.test.ts) and for local runs:
 *
 *   npx tsx scripts/ledger/standin-server.ts            # Xero stand-in on 127.0.0.1:4170, QuickBooks on 4171
 *
 * They implement only what Clearline calls, the way the real services document it [ASSUMPTION: shapes from the public
 * API documentation, not recorded from a live service], plus switches a test needs (revoke everything, answer 429 once,
 * remove a Xero connection). They listen on loopback only, keep everything in memory and never call out. Never shipped:
 * nothing under src/ imports this file.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const rnd = (n = 24) => randomBytes(n).toString("base64url");
const s256 = (v: string) => createHash("sha256").update(v, "ascii").digest("base64url");

interface Code { clientId: string; redirectUri: string; challenge?: string; nonce?: string; used: boolean; tenants: string[] }
interface Access { tenants: string[]; expiresAt: number; refresh: string }
interface Refresh { tenants: string[]; used: boolean; expiresAt: number }

export interface StandinInvoice { id: string; number: string; reference: string; contact: string; currency: string; total: string; due: string; paid: string; status: string; date: string }
export interface StandinOrg { tenantId: string; name: string; baseCurrency: string; demo: boolean; invoices: StandinInvoice[]; payments: { id: string; invoiceId: string; amount: string; date: string }[] }

export interface StandinOptions { port?: number; clientId: string; clientSecret?: string; accessTtlSeconds?: number; refreshTtlSeconds?: number; orgs?: StandinOrg[] }

/** What a test can see and switch. Tokens are never exposed beyond this process. */
export interface Standin {
  url: string;
  close(): Promise<void>;
  /** Every API call: method, path (no query values beyond the path), the idempotency key sent. */
  calls: { method: string; path: string; idempotencyKey?: string }[];
  /** Draft journals written (Xero ManualJournals; QuickBooks journal entries, which Clearline must never write). */
  journals: { tenantId: string; id: string; status: string; lines: number; idempotencyKey: string }[];
  orgs: StandinOrg[];
  /** Answer the next API call with 429 and this Retry-After. */
  rateLimitNext(retryAfterSeconds: number): void;
  /** Revoke every token issued so far (a person disconnected the app inside the ledger). */
  revokeAll(): void;
  /** Answer the next authorisation with access_denied. */
  declineNext(): void;
  /** Xero: tenants the next authorisation covers (default: all). */
  authoriseOnly(tenantIds: string[] | undefined): void;
  /** Number of token-endpoint calls by grant type. */
  grants: Record<string, number>;
}

export const FICTIONAL_XERO_ORGS = (): StandinOrg[] => [
  { tenantId: "a1b2c3d4-0000-4000-8000-00000000a001", name: "Harbour Lantern Trading (fictional demo company)", baseCurrency: "SGD", demo: true,
    invoices: [
      { id: "inv-a-0001", number: "INV-0001", reference: "SG-1001", contact: "Kestrel Bay Pte (fictional)", currency: "SGD", total: "1350.00", due: "0.00", paid: "1350.00", status: "PAID", date: "2026-11-01" },
      { id: "inv-a-0002", number: "INV-0002", reference: "SG-1002", contact: "Marrow Lane Co (fictional)", currency: "SGD", total: "0.10", due: "0.10", paid: "0.00", status: "AUTHORISED", date: "2026-11-02" },
      { id: "inv-a-0003", number: "INV-0003", reference: "", contact: "Tidewell Co (fictional)", currency: "SGD", total: "9007199254740993.27", due: "9007199254740993.27", paid: "0.00", status: "AUTHORISED", date: "2026-11-03" },
      { id: "inv-a-0004", number: "INV-0004", reference: "SG-1004", contact: "Voidstone Co (fictional)", currency: "SGD", total: "20.00", due: "0.00", paid: "0.00", status: "VOIDED", date: "2026-11-03" },
      { id: "inv-a-0005", number: "INV-0005", reference: "SG-1005", contact: "Draftwood Co (fictional)", currency: "SGD", total: "15.00", due: "15.00", paid: "0.00", status: "DRAFT", date: "2026-11-04" },
    ],
    payments: [{ id: "pay-a-0001", invoiceId: "inv-a-0001", amount: "1350.00", date: "2026-11-05" }] },
  { tenantId: "a1b2c3d4-0000-4000-8000-00000000a002", name: "Second Fictional Org (demo)", baseCurrency: "USD", demo: true, invoices: [], payments: [] },
];
export const FICTIONAL_QBO_ORGS = (): StandinOrg[] => [
  { tenantId: "9130350000000001", name: "Sandbox Company (fictional)", baseCurrency: "USD", demo: true,
    invoices: [
      { id: "101", number: "1001", reference: "US-1001", contact: "Copperfield Goods (fictional)", currency: "USD", total: "250.00", due: "0", paid: "", status: "", date: "2026-11-02" },
      { id: "102", number: "1002", reference: "US-1002", contact: "Bramble & Sons (fictional)", currency: "USD", total: "99.99", due: "99.99", paid: "", status: "", date: "2026-11-03" },
    ],
    payments: [{ id: "201", invoiceId: "101", amount: "250.00", date: "2026-11-04" }] },
];

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 1_000_000) throw new Error("too large"); chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString("utf8");
}
function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const listen = (srv: Server, port: number) => new Promise<number>((ok, bad) => { srv.once("error", bad); srv.listen(port, "127.0.0.1", () => ok((srv.address() as { port: number }).port)); });

function base(opts: StandinOptions, provider: "xero" | "qbo") {
  const orgs = opts.orgs ?? (provider === "xero" ? FICTIONAL_XERO_ORGS() : FICTIONAL_QBO_ORGS());
  const codes = new Map<string, Code>(), access = new Map<string, Access>(), refresh = new Map<string, Refresh>();
  const removed = new Set<string>(); // Xero connection ids removed
  const idem = new Map<string, unknown>();
  const st = { rate: 0, decline: false, only: undefined as string[] | undefined };
  const out = { calls: [] as Standin["calls"], journals: [] as Standin["journals"], grants: {} as Record<string, number> };
  const now = () => Date.now();
  const connId = (tenantId: string) => `conn-${tenantId.slice(-4)}`;

  function clientOk(req: IncomingMessage, form: URLSearchParams): boolean {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Basic ")) {
      const [id, secret] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
      return id === opts.clientId && (opts.clientSecret === undefined || secret === opts.clientSecret);
    }
    return opts.clientSecret === undefined && form.get("client_id") === opts.clientId;
  }
  function issue(tenants: string[], nonce?: string) {
    const a = rnd(), r = rnd(), ttl = opts.accessTtlSeconds ?? 1800, rttl = opts.refreshTtlSeconds ?? 60 * 86400;
    access.set(a, { tenants, expiresAt: now() + ttl * 1000, refresh: r });
    refresh.set(r, { tenants, used: false, expiresAt: now() + rttl * 1000 });
    const body: Record<string, unknown> = { access_token: a, refresh_token: r, expires_in: ttl, token_type: "Bearer" };
    if (provider === "qbo") body.x_refresh_token_expires_in = rttl;
    if (provider === "xero" && nonce !== undefined) body.id_token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ nonce, sub: "fictional" })).toString("base64url")}.x`;
    return body;
  }
  async function authorize(req: IncomingMessage, res: ServerResponse, u: URL) {
    const q = u.searchParams, redirect = q.get("redirect_uri") ?? "";
    if (q.get("client_id") !== opts.clientId || q.get("response_type") !== "code" || !/^https?:\/\//.test(redirect)) return send(res, 400, { error: "invalid_request" });
    const back = new URL(redirect);
    if (q.get("state")) back.searchParams.set("state", q.get("state")!);
    if (st.decline) { st.decline = false; back.searchParams.set("error", "access_denied"); return send(res, 302, undefined, { location: back.toString() }); }
    const code = rnd();
    const tenants = provider === "xero" ? (st.only ?? orgs.map((o) => o.tenantId)) : [orgs[0].tenantId];
    for (const t of tenants) removed.delete(connId(t)); // authorising again re-creates a removed connection, as Xero does
    codes.set(code, { clientId: opts.clientId, redirectUri: redirect, challenge: q.get("code_challenge") ?? undefined, nonce: q.get("nonce") ?? undefined, used: false, tenants });
    back.searchParams.set("code", code);
    if (provider === "qbo") back.searchParams.set("realmId", orgs[0].tenantId);
    send(res, 302, undefined, { location: back.toString() });
  }
  async function token(req: IncomingMessage, res: ServerResponse) {
    const form = new URLSearchParams(await bodyOf(req));
    const grant = form.get("grant_type") ?? "";
    out.grants[grant] = (out.grants[grant] ?? 0) + 1;
    if (!clientOk(req, form)) return send(res, 401, { error: "invalid_client" });
    if (grant === "authorization_code") {
      const c = codes.get(form.get("code") ?? "");
      if (!c || c.used || c.redirectUri !== form.get("redirect_uri")) return send(res, 400, { error: "invalid_grant" });
      if (c.challenge && s256(form.get("code_verifier") ?? "") !== c.challenge) return send(res, 400, { error: "invalid_grant" });
      c.used = true;
      return send(res, 200, issue(c.tenants, c.nonce));
    }
    if (grant === "refresh_token") {
      const r = refresh.get(form.get("refresh_token") ?? "");
      if (!r || r.used || r.expiresAt < now()) return send(res, 400, { error: "invalid_grant" });
      r.used = true; // rotation: a refresh token works once
      return send(res, 200, issue(r.tenants));
    }
    send(res, 400, { error: "unsupported_grant_type" });
  }
  function bearer(req: IncomingMessage): Access | undefined {
    const a = access.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    return a && a.expiresAt > now() ? a : undefined;
  }
  return { orgs, codes, access, refresh, removed, idem, st, out, now, connId, authorize, token, bearer,
    revokeAll() { access.clear(); for (const r of refresh.values()) r.used = true; },
    rateLimited(res: ServerResponse) { if (st.rate > 0) { const s = st.rate; st.rate = 0; send(res, 429, { Title: "Rate limit" }, { "retry-after": String(s) }); return true; } return false; },
  };
}

const money2 = (s: string) => Math.round(Number(s) * 100);

export async function startXeroStandin(opts: StandinOptions): Promise<Standin> {
  const b = base(opts, "xero");
  const srv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity/connect/authorize") return await b.authorize(req, res, u);
      if (req.method === "POST" && u.pathname === "/connect/token") return await b.token(req, res);
      const a = b.bearer(req);
      if (u.pathname === "/connections" && req.method === "GET") {
        if (!a) return send(res, 401, { Title: "Unauthorized" });
        return send(res, 200, a.tenants.filter((t) => !b.removed.has(b.connId(t))).map((t) => ({ id: b.connId(t), tenantId: t, tenantType: "ORGANISATION", tenantName: b.orgs.find((o) => o.tenantId === t)?.name })));
      }
      if (u.pathname.startsWith("/connections/") && req.method === "DELETE") {
        if (!a) return send(res, 401, {});
        b.removed.add(decodeURIComponent(u.pathname.slice("/connections/".length)));
        return send(res, 204);
      }
      if (!u.pathname.startsWith("/api.xro/2.0/")) return send(res, 404, {});
      const path = u.pathname.slice("/api.xro/2.0".length);
      const key = req.headers["idempotency-key"] as string | undefined;
      b.out.calls.push({ method: req.method ?? "", path, ...(key ? { idempotencyKey: key } : {}) });
      if (b.rateLimited(res)) return;
      if (!a) return send(res, 401, { Title: "Unauthorized" });
      const tenant = String(req.headers["xero-tenant-id"] ?? "");
      if (!a.tenants.includes(tenant) || b.removed.has(b.connId(tenant))) return send(res, 403, { Title: "Forbidden", Detail: "AuthorizationUnsuccessful" });
      const org = b.orgs.find((o) => o.tenantId === tenant)!;
      const page = Number(u.searchParams.get("page") ?? "1");
      const pageOf = <T>(xs: T[]) => xs.slice((page - 1) * 100, page * 100);
      if (req.method === "GET" && path === "/Organisation") return send(res, 200, { Organisations: [{ Name: org.name, BaseCurrency: org.baseCurrency, IsDemoCompany: org.demo }] });
      if (req.method === "GET" && path === "/Invoices") return send(res, 200, { Invoices: pageOf(org.invoices).map((i) => ({ InvoiceID: i.id, InvoiceNumber: i.number, Reference: i.reference, Type: "ACCREC", Contact: { Name: i.contact }, CurrencyCode: i.currency, Total: i.total, AmountDue: i.due, AmountPaid: i.paid, Status: i.status, DateString: `${i.date}T00:00:00` })) });
      if (req.method === "GET" && path === "/Payments") return send(res, 200, { Payments: pageOf(org.payments).map((p) => { const i = org.invoices.find((x) => x.id === p.invoiceId)!; return { PaymentID: p.id, Amount: Number(p.amount), Date: `/Date(${Date.parse(p.date)}+0000)/`, Status: "AUTHORISED", Invoice: { InvoiceID: i.id, InvoiceNumber: i.number, CurrencyCode: i.currency } }; }) });
      if (req.method === "PUT" && path === "/ManualJournals") {
        if (!key) return send(res, 400, { Message: "Idempotency-Key required by this stand-in" });
        const prior = b.idem.get(`${tenant}|${key}`);
        if (prior) return send(res, 200, prior);
        const body = JSON.parse(await bodyOf(req)) as { ManualJournals: { Status: string; JournalLines: { LineAmount: number }[] }[] };
        const m = body.ManualJournals?.[0];
        if (!m || m.Status !== "DRAFT") return send(res, 400, { Message: "This stand-in accepts DRAFT journals only" });
        if (m.JournalLines.reduce((s, l) => s + money2(String(l.LineAmount)), 0) !== 0) return send(res, 400, { Message: "Journal does not balance" });
        const id = `mj-${rnd(8)}`;
        const answer = { ManualJournals: [{ ...m, ManualJournalID: id, Status: "DRAFT" }] };
        b.idem.set(`${tenant}|${key}`, answer);
        b.out.journals.push({ tenantId: tenant, id, status: "DRAFT", lines: m.JournalLines.length, idempotencyKey: key });
        return send(res, 200, answer);
      }
      send(res, 405, { Message: "Not offered by the stand-in" });
    } catch { send(res, 500, {}); }
  });
  const port = await listen(srv, opts.port ?? 0);
  return standin(srv, `http://127.0.0.1:${port}`, b);
}

export async function startQboStandin(opts: StandinOptions): Promise<Standin> {
  const b = base(opts, "qbo");
  const srv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/connect/oauth2") return await b.authorize(req, res, u);
      if (req.method === "POST" && u.pathname === "/oauth2/v1/tokens/bearer") return await b.token(req, res);
      if (req.method === "POST" && u.pathname === "/oauth2/v1/tokens/revoke") { const t = JSON.parse(await bodyOf(req)).token as string; const r = b.refresh.get(t); if (r) r.used = true; return send(res, 200, {}); }
      const m = /^\/v3\/company\/(\d+)(\/.*)$/.exec(u.pathname);
      if (!m) return send(res, 404, {});
      b.out.calls.push({ method: req.method ?? "", path: m[2] });
      if (b.rateLimited(res)) return;
      const a = b.bearer(req);
      if (!a || !a.tenants.includes(m[1])) return send(res, 401, { Fault: { type: "AUTHENTICATION" } });
      const org = b.orgs.find((o) => o.tenantId === m[1])!;
      if (req.method === "GET" && m[2] === `/companyinfo/${m[1]}`) return send(res, 200, { CompanyInfo: { CompanyName: org.name, HomeCurrency: { value: org.baseCurrency } } });
      if (req.method === "GET" && m[2] === "/query") {
        const q = u.searchParams.get("query") ?? "";
        const start = Number(/startposition (\d+)/.exec(q)?.[1] ?? "1") - 1, max = Number(/maxresults (\d+)/.exec(q)?.[1] ?? "100");
        if (/from Invoice/i.test(q)) return send(res, 200, { QueryResponse: { Invoice: org.invoices.slice(start, start + max).map((i) => ({ Id: i.id, DocNumber: i.number, TotalAmt: Number(i.total), Balance: Number(i.due), CurrencyRef: { value: i.currency }, CustomerRef: { name: i.contact }, TxnDate: i.date })) } });
        if (/from Payment/i.test(q)) return send(res, 200, { QueryResponse: { Payment: org.payments.slice(start, start + max).map((p) => ({ Id: p.id, TotalAmt: Number(p.amount), TxnDate: p.date, CurrencyRef: { value: org.baseCurrency }, Line: [{ Amount: Number(p.amount), LinkedTxn: [{ TxnId: p.invoiceId, TxnType: "Invoice" }] }] })) } });
        return send(res, 400, {});
      }
      if (req.method === "POST" && m[2] === "/journalentry") { b.out.journals.push({ tenantId: m[1], id: "je", status: "POSTED", lines: 0, idempotencyKey: u.searchParams.get("requestid") ?? "" }); return send(res, 200, {}); }
      send(res, 405, {});
    } catch { send(res, 500, {}); }
  });
  const port = await listen(srv, opts.port ?? 0);
  return standin(srv, `http://127.0.0.1:${port}`, b);
}

function standin(srv: Server, url: string, b: ReturnType<typeof base>): Standin {
  return {
    url, calls: b.out.calls, journals: b.out.journals, grants: b.out.grants, orgs: b.orgs,
    close: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }),
    rateLimitNext: (s) => { b.st.rate = s; }, revokeAll: () => b.revokeAll(), declineNext: () => { b.st.decline = true; }, authoriseOnly: (ids) => { b.st.only = ids; },
  };
}

// Local run: both stand-ins with fictional client ids (set the same values in the server's environment).
if (process.argv[1] && /standin-server\.ts$/.test(process.argv[1])) {
  const xero = await startXeroStandin({ port: 4170, clientId: "standin-xero-client" });
  const qbo = await startQboStandin({ port: 4171, clientId: "standin-qbo-client", clientSecret: "standin-qbo-secret" });
  console.log(`Xero stand-in ${xero.url}  QuickBooks stand-in ${qbo.url} (fictional data; Ctrl-C to stop)`);
}
