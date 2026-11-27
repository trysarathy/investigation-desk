import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scrubStack, scrubString, scrubValue } from "@/server/ops/scrub";
import { buildLine, log, setLogWriterForTests, type LogLine } from "@/server/ops/log";
import { ErrorTrackerMisconfigured, FileErrorTracker, MemoryErrorTracker, errorTracker, setErrorTrackerForTests, toErrorEvent } from "@/server/ops/errors";
// @ts-expect-error -- plain .mjs script without types
import { findingsIn } from "../../scripts/ops/check-log-safety.mjs";

// Every sample below is fictional and made up for this test.
const EVM = "0x9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const TRON = `T${"Abc9".repeat(8)}Z`;
const TRON_HEX = `41${"ab12".repeat(10)}`;
const SOLANA = "Fict7".repeat(8);
const TON = `EQ${"Ab_-9z".repeat(7)}Abcd`;
const TON_RAW = `0:${"ab".repeat(32)}`;
const TX = `0x${"c0ffee".repeat(10)}abcd`;
const EMAIL = "pat.fictional@example.test";

describe("scrubString: wallet addresses of every supported network", () => {
  it.each([["EVM (Ethereum, Polygon, Arbitrum One, Base)", EVM], ["Tron base58", TRON], ["Tron hex", TRON_HEX], ["Solana", SOLANA], ["TON user-friendly", TON], ["TON raw", TON_RAW]])("%s", (_n, a) => {
    expect(scrubString(`paid from ${a} today`)).toBe("paid from [address] today");
  });
  it("transaction hashes with 0x, but keeps a bare sha256 checksum", () => {
    expect(scrubString(`tx ${TX}`)).toBe("tx [tx]");
    const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(scrubString(`input ${sha}`)).toBe(`input ${sha}`);
  });
});

describe("scrubString: e-mail, IPs and secrets", () => {
  it("e-mail addresses", () => expect(scrubString(`invite ${EMAIL} now`)).toBe("invite [email] now"));
  it("IPv4 and IPv6", () => {
    expect(scrubString("from 203.0.113.7 ok")).toBe("from [ip] ok");
    expect(scrubString("from 2001:db8::1 ok")).toBe("from [ip] ok");
    expect(scrubString("time 12:30:45")).toBe("time 12:30:45");
  });
  it("bearer tokens, JWTs, key=value secrets and connection strings", () => {
    expect(scrubString("Authorization: Bearer fict-token-abcdef123456")).toBe("Authorization: Bearer [token]");
    expect(scrubString("t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaWN0In0.c2lnbmF0dXJlZmljdA end")).toBe("t [jwt] end");
    expect(scrubString("/cb?token=abc123&api_key=zzz&page=2")).toBe("/cb?token=[redacted]&api_key=[redacted]&page=2");
    expect(scrubString("db postgres://u:fictpw@db.example.test:5432/x")).toBe("db [connection-string]");
  });
  it("long text (a file's content) becomes its length", () => expect(scrubString("x".repeat(600))).toBe("[text 600 chars]"));
  it("leaves ids, codes and counts alone", () => {
    expect(scrubString("job 6f1c2a9e-1b2c-4d3e-8f90-123456789abc ENT-1 PG_23505 count 42")).toBe("job 6f1c2a9e-1b2c-4d3e-8f90-123456789abc ENT-1 PG_23505 count 42");
  });
});

describe("scrubValue: by field name", () => {
  it("redacts personal and secret fields, sizes content fields, keeps ids and counts", () => {
    const out = scrubValue({
      orgId: "org-1", userId: `u${"Abc9".repeat(8)}`, count: 3, customerReference: "INV-FICT-77", payerName: "Pat Fictional",
      password: "fict", cookie: "s=1", body: "a,b,c\n1,2,3", file: Buffer.from("fictional"), rows: [1, 2, 3],
      nested: { email: EMAIL, note: "call Pat", ok: true, wallet: EVM }, ip: "203.0.113.7", code: "PG_23505",
    }) as Record<string, unknown>;
    expect(out).toEqual({
      orgId: "org-1", userId: `u${"Abc9".repeat(8)}`, count: 3, customerReference: "[redacted]", payerName: "[redacted]",
      password: "[redacted]", cookie: "[redacted]", body: "[content 11 chars]", file: "[binary 9 bytes]", rows: "[content 3 items]",
      nested: { email: "[redacted]", note: "[redacted]", ok: true, wallet: "[address]" }, ip: "[redacted]", code: "PG_23505",
    });
  });
  it("is bounded: circular, deep and long structures never throw", () => {
    const a: Record<string, unknown> = { n: 1 }; a.self = a;
    expect(scrubValue(a)).toEqual({ n: 1, self: "[circular]" });
    let deep: Record<string, unknown> = { v: 1 }; for (let i = 0; i < 10; i++) deep = { d: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain("[nested]");
    expect((scrubValue(Array.from({ length: 60 }, (_, i) => i)) as unknown[]).at(-1)).toBe("[10 more]");
  });
  it("a stack keeps function and file:line only, with paths cut from src/", () => {
    const frames = scrubStack(`Error: x\n    at run (/home/someone/app/src/server/jobs.ts:10:5)\n    at /home/someone/app/node_modules/pg/lib/client.js:1:2`);
    expect(frames).toEqual([{ function: "run", filename: "src/server/jobs.ts", lineno: 10, colno: 5 }, { filename: "node_modules/pg/lib/client.js", lineno: 1, colno: 2 }]);
  });
});

describe("the logger", () => {
  afterEach(() => { setLogWriterForTests(undefined); setErrorTrackerForTests(undefined); });
  it("writes one scrubbed JSON line with ts, level and event", () => {
    const lines: LogLine[] = [];
    setLogWriterForTests((l) => lines.push(l));
    log.info("upload_done", { orgId: "org-1", rows: 12, address: EVM, detail: `from ${EMAIL}` });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", event: "upload_done", orgId: "org-1", rows: "[content]", address: "[redacted]", detail: "from [email]" });
    expect(JSON.stringify(lines)).not.toContain(EMAIL);
  });
  it("refuses an unsafe event name and cannot be told a different level", () => {
    const l = buildLine("warn", "Bad Event!", { level: "debug", event: "x" });
    expect(l.event).toBe("invalid_event");
    expect(l.level).toBe("warn");
  });
  it("log.error keeps type and code only in the line, and reports the scrubbed error to the tracker", async () => {
    const lines: LogLine[] = [];
    setLogWriterForTests((l) => lines.push(l));
    const t = new MemoryErrorTracker();
    setErrorTrackerForTests(t);
    const e = Object.assign(new Error(`duplicate key for ${EMAIL} at ${TRON}`), { code: "23505" });
    log.error("api_unexpected_error", e, { orgId: "org-1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(lines[0]).toMatchObject({ level: "error", event: "api_unexpected_error", error: { type: "Error", code: "23505" } });
    expect(JSON.stringify(lines[0])).not.toContain("duplicate key");
    expect(t.events).toHaveLength(1);
    expect(t.events[0].exception.values[0].value).toBe("duplicate key for [email] at [address]");
    expect(t.events[0].tags).toEqual({ event: "api_unexpected_error", code: "23505" });
  });
});

describe("error tracking", () => {
  it("events have Sentry's shape and carry no unscrubbed text", () => {
    const ev = toErrorEvent(new Error(`bad row for ${EMAIL}`), { event: "x", extra: { token: "fict", count: 2 } }, { CLEARLINE_DEPLOY_ENV: "local", CLEARLINE_RELEASE: "v1.0.0" });
    expect(ev).toMatchObject({ level: "error", platform: "node", environment: "local", release: "v1.0.0", extra: { token: "[redacted]", count: 2 } });
    expect(ev.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(ev)).not.toContain(EMAIL);
  });
  it("the file sink appends one event per line, readable by the owner only", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xe4-errors-"));
    try {
      const file = path.join(dir, "errors.jsonl");
      const t = new FileErrorTracker(file, {});
      await t.captureException(new Error("one")); await t.captureException("two");
      const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.map((l) => l.exception.values[0].value)).toEqual(["one", "two"]);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("selection: none by default, file with a path, anything else refused", () => {
    expect(errorTracker({})).toBeTruthy();
    expect(errorTracker({ CLEARLINE_ERROR_TRACKER: "file", CLEARLINE_ERROR_LOG_FILE: "/tmp/x.jsonl" })).toBeInstanceOf(FileErrorTracker);
    expect(() => errorTracker({ CLEARLINE_ERROR_TRACKER: "file" })).toThrow(ErrorTrackerMisconfigured);
    expect(() => errorTracker({ CLEARLINE_ERROR_TRACKER: "sentry" })).toThrow(ErrorTrackerMisconfigured);
  });
});

describe("CI check: no console call logs a request body", () => {
  it.each([
    ["console.log(req.body)"], ["console.error('bad', await request.json())"], ["console.log(JSON.stringify({ body }))"],
    ["console.warn(`got ${rawBody}`)"], ["process.stdout.write(formData)"], ["console.log(await r.text())"],
  ])("flags %s", (src) => expect(findingsIn(src)).toHaveLength(1));
  it.each([
    ["console.log('body too large')"], ["console.error(`request body refused`)"], ["console.log(JSON.stringify({ event: 'x', count: n }))"],
    ["console.log(req.body) // log-safety: allow fictional fixture printer"], ["log.info('x', { bodyLength })"],
  ])("allows %s", (src) => expect(findingsIn(src)).toHaveLength(0));
});
