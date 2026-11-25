/**
 * A LOCAL stand-in for a fictional payment provider's REST API (no external network). Serves a list of records with
 * cursor paging (/v1/payments?cursor=&limit=) or page paging (/v1/payouts?page=&per_page=), checks a bearer key,
 * and can be told to rate-limit (429 + Retry-After) or fail (503) the next requests. Records are raw JSON text so
 * amounts keep every digit. Every value is fictional.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { safeGet, type SafeHttpOptions } from "@/lib/clearline/provider-api";

export const STANDIN_HOST = "api.standin-provider.test";
export const STANDIN_KEY = "fictional-standin-api-key-0001";

export interface StandIn {
  port: number;
  baseUrl: string;
  /** Raw JSON object text per record (exact numbers). */
  records: string[];
  /** Next requests answered 429 (with Retry-After: 1) / 503 before serving normally. */
  rateLimitNext: number;
  failNext: number;
  requests: { path: string; auth: string | undefined }[];
  close(): Promise<void>;
}

export async function startStandIn(records: string[] = []): Promise<StandIn> {
  const s: StandIn = { port: 0, baseUrl: "", records, rateLimitNext: 0, failNext: 0, requests: [], close: async () => undefined };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    s.requests.push({ path: `${u.pathname}${u.search}`, auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${STANDIN_KEY}`) { res.writeHead(401); res.end('{"error":"unauthorised"}'); return; }
    if (s.rateLimitNext > 0) { s.rateLimitNext--; res.writeHead(429, { "retry-after": "1" }); res.end(); return; }
    if (s.failNext > 0) { s.failNext--; res.writeHead(503); res.end(); return; }
    const send = (body: string) => { res.writeHead(200, { "content-type": "application/json" }); res.end(body); };
    if (u.pathname === "/v1/payments") {
      const limit = Number(u.searchParams.get("limit") ?? "2");
      const start = u.searchParams.has("cursor") ? Number(u.searchParams.get("cursor")!.replace(/^c_/, "")) : 0;
      const page = s.records.slice(start, start + limit);
      const next = start + limit < s.records.length ? `"c_${start + limit}"` : "null";
      return send(`{"object":"list","data":[${page.join(",")}],"next_cursor":${next}}`);
    }
    if (u.pathname === "/v1/payouts") {
      const per = Number(u.searchParams.get("per_page") ?? "2"), p = Number(u.searchParams.get("page") ?? "1");
      return send(`{"result":{"items":[${s.records.slice((p - 1) * per, p * per).join(",")}]}}`);
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  s.port = (server.address() as AddressInfo).port;
  s.baseUrl = `http://${STANDIN_HOST}:${s.port}`;
  s.close = async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); };
  return s;
}

/** DNS for the stand-in: its fictional host name resolves to loopback (allowed only with the test-only option). */
export const standinHttp = { testLoopback: true, resolver: async (h: string) => { if (h !== STANDIN_HOST) throw new Error("ENOTFOUND"); return [{ address: "127.0.0.1", family: 4 }]; } };

/**
 * The pull's HTTP for tests: the REAL SSRF-safe client (allowlist, guarded DNS, redirects, limits), with the stand-in's
 * name resolved to loopback and the https URL a connection must use sent as plain http to the local stand-in (it has
 * no certificate). A connection's configuration itself is always https (PullConfig refuses anything else).
 */
export const standinGet = (url: string, headers: Record<string, string>, o: SafeHttpOptions) =>
  safeGet({ url: url.replace(/^https:/, "http:"), headers }, { ...standinHttp, ...o });

/** A connection configuration for the stand-in (https, as every connection). */
export function standinConfig(s: StandIn, kind: "cursor" | "page" = "cursor") {
  return {
    baseUrl: `https://${STANDIN_HOST}:${s.port}`, allowedHosts: [STANDIN_HOST], path: kind === "cursor" ? "/v1/payments" : "/v1/payouts",
    recordsPath: kind === "cursor" ? "data" : "result.items",
    pagination: kind === "cursor" ? { kind: "cursor" as const, cursorParam: "cursor", nextCursorPath: "next_cursor", pageSizeParam: "limit" } : { kind: "page" as const, pageParam: "page", pageSizeParam: "per_page", firstPage: 1 },
    pageSize: 2, auth: { scheme: "bearer" as const }, minIntervalMs: 0, maxRetries: 3,
  };
}
