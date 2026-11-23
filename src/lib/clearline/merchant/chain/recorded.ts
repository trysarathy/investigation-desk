/**
 * A recorded HttpTransport for tests and CI: replays exchanges from tests/fixtures/chain-recordings/*.json. No
 * network. Each request takes the first unconsumed exchange whose `match` fits (a `repeat` exchange is never
 * consumed), so "the same request answers differently the second time" (reorgs, 429-then-success) is expressible.
 */
import type { HttpRequest, HttpResponse, HttpTransport } from "./transport";
import { TransportError } from "./transport";

export interface RecordedMatch {
  method?: "GET" | "POST";
  /** URL pathname, exactly (e.g. "/wallet/gettransactioninfobyid"). Omit to match any path (JSON-RPC endpoints). */
  path?: string;
  /** JSON-RPC method in the request body. */
  rpcMethod?: string;
  /** First JSON-RPC param, compared as JSON (e.g. "0x10" for eth_getBlockByNumber). */
  rpcParam0?: unknown;
  /** Substring of the request body. */
  bodyIncludes?: string;
  /** Query parameters that must be present with these values ("*" = present). Use "" to require absence. */
  query?: Record<string, string>;
}
export interface RecordedExchange {
  match: RecordedMatch;
  response?: { status: number; headers?: Record<string, string>; body: unknown };
  /** Simulate a transport failure instead of a response. */
  throws?: "timeout" | "network";
  repeat?: boolean;
  note?: string;
}
export interface RecordedScenario { description: string; exchanges: RecordedExchange[] }
export interface RecordingFile { _note: string; scenarios: Record<string, RecordedScenario> }

export interface RecordedTransport extends HttpTransport { calls: HttpRequest[]; unmatched: HttpRequest[]; remaining(): RecordedExchange[] }

function matches(m: RecordedMatch, req: HttpRequest): boolean {
  if (m.method && m.method !== req.method) return false;
  const u = new URL(req.url);
  if (m.path !== undefined && u.pathname !== m.path) return false;
  if (m.query) for (const [k, v] of Object.entries(m.query)) {
    if (v === "" ? u.searchParams.has(k) : v === "*" ? !u.searchParams.has(k) : u.searchParams.get(k) !== v) return false;
  }
  if (m.bodyIncludes !== undefined && !(req.body ?? "").includes(m.bodyIncludes)) return false;
  if (m.rpcMethod !== undefined || m.rpcParam0 !== undefined) {
    let j: { method?: string; params?: unknown[] };
    try { j = JSON.parse(req.body ?? ""); } catch { return false; }
    if (m.rpcMethod !== undefined && j.method !== m.rpcMethod) return false;
    if (m.rpcParam0 !== undefined && JSON.stringify(j.params?.[0]) !== JSON.stringify(m.rpcParam0)) return false;
  }
  return true;
}

export function recordedTransport(exchanges: readonly RecordedExchange[]): RecordedTransport {
  const pending = exchanges.map((e) => ({ e, used: false }));
  const calls: HttpRequest[] = [];
  const unmatched: HttpRequest[] = [];
  const t = (async (req: HttpRequest): Promise<HttpResponse> => {
    calls.push(req);
    const hit = pending.find((p) => !p.used && matches(p.e.match, req));
    if (!hit) { unmatched.push(req); throw new TransportError("network", "no recorded response for this request"); }
    if (!hit.e.repeat) hit.used = true;
    if (hit.e.throws) throw new TransportError(hit.e.throws, hit.e.throws === "timeout" ? "recorded timeout" : "recorded network error");
    const r = hit.e.response ?? { status: 200, body: {} };
    return { status: r.status, headers: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])), body: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
  }) as RecordedTransport;
  t.calls = calls;
  t.unmatched = unmatched;
  t.remaining = () => pending.filter((p) => !p.used && !p.e.repeat).map((p) => p.e);
  return t;
}
