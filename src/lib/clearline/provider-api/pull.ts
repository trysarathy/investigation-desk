/**
 * v1 phase 2.2: a generic REST pull from a payment provider's API (read-only GETs). One connection's configuration
 * says where the records are (base URL + path), how pages follow each other (a cursor in the body, or page numbers),
 * where the list of records sits in each page and how the API key is sent. The key itself is passed in by the caller
 * (resolved from a server secret by reference) and is never part of an error, a log line or the returned data.
 *
 * Robustness: requests are spaced (a minimum interval per connection), a 429 or 5xx or network failure is retried with
 * exponential backoff and full jitter (Retry-After is honoured up to a cap), every request has a timeout, and the pull
 * stops at a page, record, byte and time budget. Records are kept EXACTLY as the provider sent them: numbers keep
 * their source text (the ingest JSON reader), so an amount is never rounded on its way in.
 */
import { z } from "zod";
import { IngestError, LIMITS } from "@/lib/clearline/ingest";
import { JsonNumber, parseJson, type JsonValue } from "@/lib/clearline/ingest/json";
import { isAllowlistHost, safeGet, SafeHttpError, type SafeHttpOptions, type SafeResponse } from "./safe-http";

const PATH_RE = /^[A-Za-z0-9_-]{1,64}(?:\.[A-Za-z0-9_-]{1,64}){0,7}$/;
const PARAM_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;
/** Headers a configuration may never set as the key header (they would change routing or framing). */
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "cookie", "proxy-authorization", "upgrade", "te", "expect"]);

export const PullConfig = z.object({
  /** https://host[:port]/optional/prefix — the host must be on allowedHosts. */
  baseUrl: z.string().url().max(500),
  allowedHosts: z.array(z.string().min(1).max(253)).min(1).max(5),
  /** The records endpoint, appended to the base URL. */
  path: z.string().regex(/^\/[A-Za-z0-9/_.~-]{0,300}$/).refine((p) => !p.includes(".."), "no '..' in the path"),
  /** Fixed query parameters (e.g. a status filter). Never the API key. */
  query: z.record(z.string().regex(PARAM_RE), z.string().max(200)).default({}),
  /** Dot path of the array of records in each page ("data", "result.items"). */
  recordsPath: z.string().regex(PATH_RE),
  pagination: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cursor"), cursorParam: z.string().regex(PARAM_RE), nextCursorPath: z.string().regex(PATH_RE), pageSizeParam: z.string().regex(PARAM_RE).optional() }).strict(),
    z.object({ kind: z.literal("page"), pageParam: z.string().regex(PARAM_RE), pageSizeParam: z.string().regex(PARAM_RE), firstPage: z.number().int().min(0).max(1).default(1) }).strict(),
  ]),
  pageSize: z.number().int().min(1).max(1000).default(100),
  auth: z.discriminatedUnion("scheme", [
    z.object({ scheme: z.literal("bearer") }).strict(),
    z.object({ scheme: z.literal("header"), header: z.string().regex(HEADER_RE).refine((h) => !FORBIDDEN_HEADERS.has(h.toLowerCase()), "this header cannot carry the key") }).strict(),
  ]),
  /** Minimum spacing between two requests of this connection. */
  minIntervalMs: z.number().int().min(0).max(60_000).default(250),
  maxRetries: z.number().int().min(0).max(8).default(4),
  maxPages: z.number().int().min(1).max(1000).default(200),
}).strict().superRefine((c, ctx) => {
  let u: URL | undefined;
  try { u = new URL(c.baseUrl); } catch { /* reported by .url() */ }
  for (const h of c.allowedHosts) if (!isAllowlistHost(h)) ctx.addIssue({ code: "custom", path: ["allowedHosts"], message: "Each allowed host is an exact lower-case host name (no IP address, no wildcard)." });
  if (u) {
    if (u.protocol !== "https:") ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "The provider API is called over https only." });
    if (u.username || u.password || u.search || u.hash) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "The base URL has no credentials, query or fragment." });
    if (!c.allowedHosts.includes(u.hostname.toLowerCase())) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "The base URL's host must be on the allowed hosts." });
  }
  const pageParams = c.pagination.kind === "cursor" ? [c.pagination.cursorParam, c.pagination.pageSizeParam] : [c.pagination.pageParam, c.pagination.pageSizeParam];
  for (const p of pageParams) if (p && p in c.query) ctx.addIssue({ code: "custom", path: ["query"], message: "A fixed query parameter cannot also be a paging parameter." });
});
export type PullConfig = z.output<typeof PullConfig>;

export type PullErrorCode =
  | "unauthorised" | "rate_limited" | "provider_error" | "client_error" | "bad_page" | "too_many_pages" | "too_many_records" | "too_large" | "deadline"
  | "cursor_loop" | `http_${SafeHttpError["code"]}`;

export class PullError extends Error {
  constructor(readonly code: PullErrorCode, readonly pagesRead: number) {
    super(`provider pull failed (${code})`);
    this.name = "PullError";
  }
}

export interface PullDeps {
  /** HTTP options other than the allowlist (tests: resolver, testLoopback). */
  http?: Omit<SafeHttpOptions, "allowedHosts">;
  get?: (url: string, headers: Record<string, string>, o: SafeHttpOptions) => Promise<SafeResponse>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Whole-pull time budget. */
  deadlineMs?: number;
  maxRecords?: number;
  maxTotalBytes?: number;
}

export interface PullResult {
  /** The records exactly as received, in order. */
  records: JsonValue[];
  pages: number;
  requests: number;
  retries: number;
  /** The cursor to resume from next time (cursor paging), or null at the end / for page paging. */
  nextCursor: string | null;
  bytes: number;
}

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 30_000;
export const RETRY_AFTER_CAP_MS = 60_000;

/** Full jitter: a uniform wait in [0, min(cap, base·2^attempt)). */
export const backoffMs = (attempt: number, random: () => number) => Math.floor(random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));

/** Retry-After as seconds or an HTTP date, capped; undefined when absent or unreadable. */
export function retryAfterMs(v: string | undefined, now: number): number | undefined {
  if (!v) return undefined;
  if (/^\d{1,6}$/.test(v.trim())) return Math.min(Number(v.trim()) * 1000, RETRY_AFTER_CAP_MS);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.min(Math.max(at - now, 0), RETRY_AFTER_CAP_MS) : undefined;
}

const at = (v: JsonValue, path: string): JsonValue | undefined => {
  let cur: JsonValue | undefined = v;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur) || cur instanceof JsonNumber) return undefined;
    cur = (cur as Record<string, JsonValue>)[k];
  }
  return cur;
};

/** Exact JSON text for a value read by the ingest reader (numbers keep their source text). */
export function stringifyExact(v: JsonValue): string {
  if (v === null) return "null";
  if (v instanceof JsonNumber) return v.text;
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringifyExact).join(",")}]`;
  return `{${Object.keys(v).map((k) => `${JSON.stringify(k)}:${stringifyExact((v as Record<string, JsonValue>)[k])}`).join(",")}}`;
}

/** The records as one JSON array file: what the upload pipeline stores, maps and validates. */
export const recordsFile = (records: JsonValue[]) => new TextEncoder().encode(`[${records.map(stringifyExact).join(",\n")}]\n`);

function pageUrl(c: PullConfig, cursor: string | null, page: number): string {
  const u = new URL(c.baseUrl.replace(/\/+$/, "") + c.path);
  for (const [k, v] of Object.entries(c.query)) u.searchParams.set(k, v);
  if (c.pagination.kind === "cursor") {
    if (c.pagination.pageSizeParam) u.searchParams.set(c.pagination.pageSizeParam, String(c.pageSize));
    if (cursor !== null) u.searchParams.set(c.pagination.cursorParam, cursor);
  } else {
    u.searchParams.set(c.pagination.pageParam, String(page));
    u.searchParams.set(c.pagination.pageSizeParam, String(c.pageSize));
  }
  return u.toString();
}

/**
 * Read every page from `startCursor` (cursor paging; null = from the beginning) to the end. Throws PullError with a
 * code only. `apiKey` goes into one request header and nowhere else.
 */
export async function pullRecords(config: PullConfig, apiKey: string, startCursor: string | null, deps: PullDeps = {}): Promise<PullResult> {
  const c = PullConfig.parse(config);
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new PullError("unauthorised", 0);
  const get = deps.get ?? ((url, headers, o) => safeGet({ url, headers }, o));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.deadlineMs ?? 5 * 60_000);
  const maxRecords = deps.maxRecords ?? LIMITS.maxDataRows;
  const maxTotalBytes = deps.maxTotalBytes ?? LIMITS.maxFileBytes;
  const http: SafeHttpOptions = { ...deps.http, allowedHosts: c.allowedHosts };
  const authHeaders = c.auth.scheme === "bearer" ? { authorization: `Bearer ${apiKey}` } : { [c.auth.header.toLowerCase()]: apiKey };

  const records: JsonValue[] = [];
  let pages = 0, requests = 0, retries = 0, bytes = 0, lastRequestAt = -Infinity;
  let cursor = startCursor;
  let page = c.pagination.kind === "page" ? c.pagination.firstPage : 0;
  const seenCursors = new Set<string>();

  for (;;) {
    if (pages >= c.maxPages) throw new PullError("too_many_pages", pages);
    const url = pageUrl(c, cursor, page);
    let res: SafeResponse | undefined;
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + c.minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      if (now() > deadline) throw new PullError("deadline", pages);
      lastRequestAt = now();
      requests++;
      let retryable = false, hint: number | undefined;
      try {
        res = await get(url, authHeaders, http);
        if (res.status === 429 || res.status >= 500) { retryable = true; hint = retryAfterMs(res.headers["retry-after"], now()); }
      } catch (e) {
        if (!(e instanceof SafeHttpError)) throw new PullError("http_network_error", pages);
        // only transient transport failures are retried; a refused address, host or redirect never is
        if (e.code !== "timeout" && e.code !== "network_error") throw new PullError(`http_${e.code}`, pages);
        retryable = true;
      }
      if (!retryable) break;
      if (attempt >= c.maxRetries) {
        throw new PullError(res?.status === 429 ? "rate_limited" : res ? "provider_error" : "http_network_error", pages);
      }
      retries++;
      const ms = Math.max(hint ?? 0, backoffMs(attempt, random));
      if (now() + ms > deadline) throw new PullError("deadline", pages);
      await sleep(ms);
    }
    if (!res) throw new PullError("http_network_error", pages);
    if (res.status === 401 || res.status === 403) throw new PullError("unauthorised", pages);
    if (res.status < 200 || res.status >= 300) throw new PullError("client_error", pages);
    bytes += res.body.byteLength;
    if (bytes > maxTotalBytes) throw new PullError("too_large", pages);
    let body: JsonValue;
    try { body = parseJson(new TextDecoder("utf-8", { fatal: true }).decode(res.body)); } catch (e) {
      if (e instanceof IngestError || e instanceof TypeError) throw new PullError("bad_page", pages);
      throw e;
    }
    const list = at(body, c.recordsPath);
    if (!Array.isArray(list) || list.some((r) => r === null || typeof r !== "object" || Array.isArray(r) || r instanceof JsonNumber)) throw new PullError("bad_page", pages);
    pages++;
    records.push(...list);
    if (records.length > maxRecords) throw new PullError("too_many_records", pages);

    if (c.pagination.kind === "cursor") {
      const next = at(body, c.pagination.nextCursorPath);
      if (next === undefined || next === null || next === "" || list.length === 0) return { records, pages, requests, retries, nextCursor: cursor, bytes };
      if (typeof next !== "string" || next.length > 500) throw new PullError("bad_page", pages);
      if (seenCursors.has(next) || next === startCursor) throw new PullError("cursor_loop", pages);
      seenCursors.add(next);
      cursor = next;
    } else {
      if (list.length < c.pageSize) return { records, pages, requests, retries, nextCursor: null, bytes };
      page++;
    }
  }
}
