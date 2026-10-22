// Serves recorded chain responses for the demo hashes, so the demo needs no keys, no network and
// no luck with public rate limits. Requests that weren't recorded go to `fallback` (live) when
// there is one, and fail otherwise, which the engine turns into "Check paused", never a guess.

import type { HttpRequest, Transport } from "../chain/http";
import type { Recording } from "./recordings";

const redact = (url: string) => {
  const u = new URL(url);
  if (u.searchParams.has("apikey")) u.searchParams.set("apikey", "REDACTED");
  return u.toString();
};
const keyOf = (method: string, url: string, body?: string) => `${method} ${url} ${body ?? ""}`;
const RATE_LIMITED = /rate limit|max calls/i;

/**
 * One answer per request. Where recordings disagree (e.g. "current block" was recorded several
 * times), the most recent recording wins, so later transfers never look unconfirmed.
 */
export function demoTransport(recordings: Recording[], fallback?: Transport): Transport {
  const answers = new Map<string, { at: number; res: Recording["exchanges"][number]["response"] }>();
  for (const rec of recordings) {
    const at = Date.parse(rec.recordedAt);
    for (const e of rec.exchanges) {
      if (RATE_LIMITED.test(e.response.body)) continue;
      const k = keyOf(e.request.method, e.request.url, e.request.body);
      const prev = answers.get(k);
      if (!prev || at >= prev.at) answers.set(k, { at, res: e.response });
    }
  }
  return async (req: HttpRequest) => {
    const hit = answers.get(keyOf(req.method, redact(req.url), req.body));
    if (hit) return { status: hit.res.status, headers: hit.res.headers, body: hit.res.body };
    if (fallback) return fallback(req);
    throw new Error("Not recorded for the demo, and live lookups have no keys");
  };
}
