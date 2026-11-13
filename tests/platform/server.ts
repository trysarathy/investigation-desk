/**
 * Starts the production build (`next start`, needs a prior `npx next build`) on 127.0.0.1:3284 with a
 * given deployment environment, and talks to it with raw HTTP (no URL normalisation), so the tests see
 * exactly what a client on the network would.
 */
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PORT = 3284;
export const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, "../..");
/** Every variable the deployment gates and the config validation read: cleared, then set per mode. */
const MODE_KEYS = ["CLEARLINE_CUSTOMER_PREVIEW", "CLEARLINE_FUNDING_ONLY", "PREVIEW_USER", "PREVIEW_PASSWORD", "DEMO_MODE", "QBO_ENV", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "QBO_ACCESS_TOKEN", "QBO_REALM_ID"];

export const PREVIEW_USER = "demo";
export const PREVIEW_PASSWORD = "platform-rc3-fixture"; // a fixture for a local server, not a credential
export const BASIC = "Basic " + Buffer.from(`${PREVIEW_USER}:${PREVIEW_PASSWORD}`).toString("base64");

export type Mode = "full" | "preview" | "funding" | "basic";
export const MODE_ENV: Record<Mode, Record<string, string>> = {
  full: {},
  preview: { CLEARLINE_CUSTOMER_PREVIEW: "1" },
  funding: { CLEARLINE_FUNDING_ONLY: "1" },
  basic: { PREVIEW_USER, PREVIEW_PASSWORD },
};

function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !MODE_KEYS.includes(k)) env[k] = v;
  return { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ...extra } as NodeJS.ProcessEnv;
}

export type Server = { pid: number; output: () => string; stop: () => Promise<void> };

export async function startServer(extraEnv: Record<string, string>): Promise<Server> {
  const child: ChildProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, env: baseEnv(extraEnv) });
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  };
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}:\n${out}`);
    try {
      await raw("GET", "/favicon.ico");
      return { pid: child.pid!, output: () => out, stop };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await stop();
  throw new Error(`next start did not answer on ${PORT}:\n${out}`);
}

/** Runs `next start` and waits for it to exit (for configurations that must fail fast). */
export async function startExpectingExit(extraEnv: Record<string, string>, timeoutMs = 30_000): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, env: baseEnv(extraEnv) });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  const code = await new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
  clearTimeout(timer);
  return { code, output: out };
}

export type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: string };

/** One HTTP request with the path sent exactly as given (no client-side normalisation of %2e or ..). */
export function raw(method: string, rawPath: string, headers: Record<string, string> = {}, body?: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const framing = body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) };
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: rawPath, headers: { connection: "close", ...framing, ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("timeout")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const rssMB = (pid: number) => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))![1]) / 1024;

/**
 * Streams `totalBytes` as a chunked body (no Content-Length) over a raw socket and samples the server's
 * RSS every 5 ms until the server answers and closes, or the body is fully sent. The same measurement QA
 * used for L3. A raw socket reads the response while still writing, so a server that answers and closes
 * early is seen as its answer, not as a client-side EPIPE.
 */
export function chunkedUpload(pid: number, rawPath: string, totalBytes: number, headers: Record<string, string> = {}): Promise<{ status: number | string; sentMB: number; rssBeforeMB: number; rssPeakMB: number; peakDeltaMB: number; body: string; responseHeaders: Record<string, string> }> {
  return new Promise((resolve) => {
    const before = rssMB(pid);
    let peak = before;
    const sampler = setInterval(() => { try { peak = Math.max(peak, rssMB(pid)); } catch { /* exited */ } }, 5);
    const all = { "content-type": "application/json", authorization: "Bearer cl_test_demo", ...headers, "transfer-encoding": "chunked", host: `127.0.0.1:${PORT}` };
    const head = `POST ${rawPath} HTTP/1.1\r\n` + Object.entries(all).map(([k, v]) => `${k}: ${v}\r\n`).join("") + "\r\n";
    const payload = Buffer.alloc(64 * 1024, 0x20);
    const frame = Buffer.concat([Buffer.from(payload.length.toString(16) + "\r\n"), payload, Buffer.from("\r\n")]);
    let sent = 0;
    let received = Buffer.alloc(0);
    let finished = false;
    const sock = net.connect(PORT, "127.0.0.1");
    const parse = () => {
      const text = received.toString("utf8");
      const split = text.indexOf("\r\n\r\n");
      if (split < 0) return { status: received.length ? "unparsed response" : "no response", headers: {}, body: "" };
      const [statusLine, ...lines] = text.slice(0, split).split("\r\n");
      const h = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]));
      let body = text.slice(split + 4);
      if (/chunked/i.test(h["transfer-encoding"] ?? "")) {
        let out = "";
        for (let rest = body; ;) {
          const nl = rest.indexOf("\r\n");
          const n = parseInt(rest.slice(0, nl), 16);
          if (!n) break;
          out += rest.slice(nl + 2, nl + 2 + n);
          rest = rest.slice(nl + 2 + n + 2);
        }
        body = out;
      }
      return { status: Number(statusLine.split(" ")[1]), headers: h, body };
    };
    const done = () => {
      if (finished) return;
      finished = true;
      // Keep sampling briefly: anything the server buffers shows up right after the response.
      setTimeout(() => {
        clearInterval(sampler);
        sock.destroy();
        const r = parse();
        resolve({ status: r.status, sentMB: +(sent / 1048576).toFixed(2), rssBeforeMB: +before.toFixed(1), rssPeakMB: +peak.toFixed(1), peakDeltaMB: +(peak - before).toFixed(1), body: r.body, responseHeaders: r.headers });
      }, 500);
    };
    sock.on("data", (d) => { received = Buffer.concat([received, d]); });
    sock.on("end", done);
    sock.on("close", done);
    sock.on("error", () => done());
    const pump = () => {
      while (sent < totalBytes && !finished && !sock.destroyed) {
        sent += payload.length;
        if (!sock.write(frame)) return void sock.once("drain", pump);
      }
      if (!finished && !sock.destroyed) sock.write("0\r\n\r\n");
    };
    sock.on("connect", () => { sock.write(head); pump(); });
  });
}

export const SECURITY_HEADERS = ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"] as const;

/** The script-src directive of a Content-Security-Policy header value. */
export const scriptSrc = (csp: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) ?? "";
