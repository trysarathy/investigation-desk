// Replays recorded chain API exchanges so live-data tests run offline and without API keys.

import type { HttpRequest, Transport } from "../../../src/lib/chain/http";

export interface Exchange {
  request: { method: string; url: string; body?: string };
  response: { status: number; headers: Record<string, string>; body: string };
}

export interface Recording {
  name: string;
  hash: string;
  explorer: string;
  recordedAt: string;
  exchanges: Exchange[];
}

const SECRET_PARAMS = ["apikey"];

export function redactUrl(url: string): string {
  const u = new URL(url);
  for (const p of SECRET_PARAMS) if (u.searchParams.has(p)) u.searchParams.set(p, "REDACTED");
  return u.toString();
}

const keyOf = (method: string, url: string, body?: string) => `${method} ${url} ${body ?? ""}`;

/** Serves each recorded response in order; an unrecorded request fails the test loudly. */
export function replayTransport(rec: Recording): Transport & { unused: () => number } {
  const queues = new Map<string, Exchange[]>();
  for (const e of rec.exchanges) {
    const k = keyOf(e.request.method, e.request.url, e.request.body);
    queues.set(k, [...(queues.get(k) ?? []), e]);
  }
  const t = (async (req: HttpRequest) => {
    const k = keyOf(req.method, redactUrl(req.url), req.body);
    const q = queues.get(k);
    if (!q || q.length === 0) throw new Error(`Not in recording ${rec.name}: ${k}`);
    const e = q.length > 1 ? q.shift()! : q[0];
    return { status: e.response.status, headers: e.response.headers, body: e.response.body };
  }) as Transport & { unused: () => number };
  t.unused = () => [...queues.values()].reduce((n, q) => n + Math.max(0, q.length - 1), 0);
  return t;
}
