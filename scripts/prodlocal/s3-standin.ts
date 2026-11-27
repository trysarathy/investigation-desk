/**
 * LOCAL STAND-IN ONLY (prod-local and tests; never deployed): a tiny S3-compatible object store on 127.0.0.1 for the
 * prod-local topology, because no MinIO image is available offline on this machine. It implements exactly what
 * src/server/storage/s3.ts uses (PUT, GET, HEAD, DELETE of an object; ListObjectsV2 with prefix and paging), checks
 * every request's SigV4 signature, body hash and clock skew, and keeps objects as files under one folder. Objects are
 * the app's sealed bytes (AES-256-GCM), so the folder holds ciphertext only. Prints counts, never keys or contents.
 *
 *   npx tsx scripts/prodlocal/s3-standin.ts   (reads CLEARLINE_S3_* and CLEARLINE_S3_STANDIN_DIR, listens on the
 *                                             endpoint's port, 127.0.0.1 only)
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { sha256Hex, sign, type SigV4Credentials } from "../../src/server/storage/sigv4";

export interface StandinOptions { dir: string; port: number; bucket: string; creds: SigV4Credentials }

const SAFE = /^[0-9A-Za-z._-]+$/;
const body = (req: IncomingMessage) => new Promise<Buffer>((ok, no) => { const c: Buffer[] = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); req.on("error", no); });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Whether the request carries a valid signature for these credentials (re-signed from the request's own headers). */
export function verify(req: { method: string; url: string; headers: Record<string, string | string[] | undefined> }, payload: Buffer, creds: SigV4Credentials, now = Date.now()): boolean {
  const auth = String(req.headers.authorization ?? "");
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([a-z0-9;-]+),\s*Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m || m[1] !== creds.accessKeyId || m[3] !== creds.region) return false;
  const date = String(req.headers["x-amz-date"] ?? "");
  const t = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
  if (!Number.isFinite(t) || Math.abs(now - t) > 15 * 60_000 || date.slice(0, 8) !== m[2]) return false;
  const hash = String(req.headers["x-amz-content-sha256"] ?? "");
  if (hash !== sha256Hex(payload)) return false;
  const names = m[4].split(";");
  if (!names.includes("host") || !names.includes("x-amz-date") || !names.includes("x-amz-content-sha256")) return false;
  const headers: Record<string, string> = {};
  for (const n of names) if (n !== "host") headers[n] = String(req.headers[n] ?? "");
  const u = new URL(req.url, "http://standin");
  const query: Record<string, string> = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  const s = sign({ method: req.method, host: String(req.headers.host ?? ""), path: u.pathname, query, headers, payloadHash: hash }, creds, new Date(t));
  return timingSafeEqual(Buffer.from(s.signature), Buffer.from(m[5]));
}

export async function startStandin(o: StandinOptions): Promise<Server> {
  const root = path.resolve(o.dir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = (key: string) => path.join(root, ...key.split("/"));
  async function walk(d: string, prefix: string, out: { key: string; mtime: Date; size: number }[]) {
    let names: string[];
    try { names = await readdir(d); } catch { return; }
    for (const n of names) {
      if (n.endsWith(".part")) continue;
      const p = path.join(d, n), st = await stat(p);
      if (st.isDirectory()) await walk(p, `${prefix}${n}/`, out); else out.push({ key: `${prefix}${n}`, mtime: st.mtime, size: st.size });
    }
  }
  const server = createServer(async (req, res) => {
    try {
      const payload = await body(req);
      if (!verify({ method: req.method ?? "", url: req.url ?? "/", headers: req.headers }, payload, o.creds)) { res.writeHead(403).end(); return; }
      const u = new URL(req.url ?? "/", "http://standin");
      const parts = u.pathname.split("/").slice(1).map(decodeURIComponent);
      if (parts[0] !== o.bucket) { res.writeHead(404).end(); return; }
      const key = parts.slice(1).join("/");
      if (!key) {
        if (req.method !== "GET" || u.searchParams.get("list-type") !== "2") { res.writeHead(400).end(); return; }
        const prefix = u.searchParams.get("prefix") ?? "";
        const max = Math.min(1000, Number(u.searchParams.get("max-keys") ?? 1000));
        const after = u.searchParams.get("continuation-token") ?? "";
        const all: { key: string; mtime: Date; size: number }[] = [];
        await walk(root, "", all);
        const keys = all.filter((f) => f.key.startsWith(prefix) && f.key > after).sort((a, b) => (a.key < b.key ? -1 : 1));
        const page = keys.slice(0, max), more = keys.length > max;
        res.writeHead(200, { "content-type": "application/xml" }).end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${esc(o.bucket)}</Name><KeyCount>${page.length}</KeyCount><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${esc(page[page.length - 1].key)}</NextContinuationToken>` : ""}${page.map((f) => `<Contents><Key>${esc(f.key)}</Key><LastModified>${f.mtime.toISOString()}</LastModified><Size>${f.size}</Size></Contents>`).join("")}</ListBucketResult>`);
        return;
      }
      if (!key.split("/").every((s) => SAFE.test(s) && s !== "." && s !== "..")) { res.writeHead(400).end(); return; }
      const f = file(key);
      if (req.method === "PUT") {
        await mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
        await writeFile(`${f}.part`, payload, { mode: 0o600 });
        await rename(`${f}.part`, f);
        res.writeHead(200).end();
      } else if (req.method === "GET" || req.method === "HEAD") {
        let b: Buffer;
        try { b = await readFile(f); } catch { res.writeHead(404).end(); return; }
        res.writeHead(200, { "content-length": String(b.length), "content-type": "application/octet-stream" }).end(req.method === "GET" ? b : undefined);
      } else if (req.method === "DELETE") {
        await rm(f, { force: true });
        res.writeHead(204).end();
      } else res.writeHead(405).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((ok) => server.listen(o.port, "127.0.0.1", ok));
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const e = process.env;
  const need = ["CLEARLINE_S3_ENDPOINT", "CLEARLINE_S3_BUCKET", "CLEARLINE_S3_REGION", "CLEARLINE_S3_ACCESS_KEY_ID", "CLEARLINE_S3_SECRET_ACCESS_KEY", "CLEARLINE_S3_STANDIN_DIR"].filter((k) => !e[k]);
  if (need.length) { console.error(`s3-standin: set ${need.join(", ")}`); process.exit(2); }
  const url = new URL(e.CLEARLINE_S3_ENDPOINT!);
  if (url.hostname !== "127.0.0.1") { console.error("s3-standin: the endpoint must be http://127.0.0.1:<port> (local stand-in only)"); process.exit(2); }
  startStandin({ dir: e.CLEARLINE_S3_STANDIN_DIR!, port: Number(url.port), bucket: e.CLEARLINE_S3_BUCKET!, creds: { accessKeyId: e.CLEARLINE_S3_ACCESS_KEY_ID!, secretAccessKey: e.CLEARLINE_S3_SECRET_ACCESS_KEY!, region: e.CLEARLINE_S3_REGION! } })
    .then(() => console.log(JSON.stringify({ event: "s3_standin_listening", port: Number(url.port) })));
}
