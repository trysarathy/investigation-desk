import "server-only";
import { randomBytes } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { isLoopbackHost, loopbackFetcher, policyWithUrls, safeFetcher } from "@/lib/net/safe-fetch";
import type { StoredFile, UploadStorage } from "./index";
import { openUpload, sealUpload, StorageRefused, validAddress } from "./local";
import { EMPTY_SHA256, encodePath, sha256Hex, sign, type SigV4Credentials } from "./sigv4";

/**
 * v1 phase 6: uploads in S3-compatible object storage (DigitalOcean Spaces in the hosting proposal; any S3 API).
 * Objects are "<org id>/<random key>" in one private bucket, addressed path-style. The bytes are sealed exactly as on
 * local disk (sealUpload: AES-256-GCM with CLEARLINE_UPLOAD_KEY, bound to the organisation and key), so the bucket
 * only ever holds ciphertext; the provider's own at-rest encryption is on top, not instead. A PUT is atomic, so there
 * are no partial writes. Errors carry the HTTP status only, never the endpoint, bucket, keys or the response body.
 */
export interface S3Config extends SigV4Credentials {
  /** https://sgp1.digitaloceanspaces.com (http only for 127.0.0.1 / localhost: the local stand-in). */
  endpoint: string;
  bucket: string;
  /** Optional x-amz-server-side-encryption value sent on PUT (for example AES256 on AWS S3). */
  sse?: string;
}

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: (name) => name === "Contents" });

export class S3Storage implements UploadStorage {
  private readonly base: URL;
  constructor(private readonly cfg: S3Config, private readonly key: Buffer | null, private readonly refusal?: string,
    fetcher?: typeof fetch) {
    this.base = new URL(cfg.endpoint);
    // wave 2: through the one outbound client: the endpoint's host only (https, public addresses, no redirects), or the
    // loopback-only client for the local stand-in (s3ConfigFromEnv allows http for 127.0.0.1 and localhost only)
    this.fetcher = fetcher ?? (isLoopbackHost(this.base.hostname) ? loopbackFetcher() : safeFetcher(policyWithUrls("s3-uploads", [], [cfg.endpoint])));
  }
  private readonly fetcher: typeof fetch;

  private async call(method: string, objectPath: string, opts: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string> } = {}) {
    const path = `/${encodePath(this.cfg.bucket)}${objectPath ? `/${encodePath(objectPath)}` : ""}`;
    const s = sign({ method, host: this.base.host, path, query: opts.query, headers: opts.headers, payloadHash: opts.body ? sha256Hex(opts.body) : EMPTY_SHA256 }, this.cfg);
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const { host: _host, ...headers } = s.headers;
    void _host;
    return this.fetcher(url, { method, headers, body: opts.body ? new Uint8Array(opts.body) : undefined, redirect: "error" });
  }

  private where(orgId: string, storageKey: string): string {
    if (!validAddress(orgId, storageKey)) throw new StorageRefused("Invalid storage address.");
    return `${orgId}/${storageKey}`;
  }

  private static failed(what: string, status: number): never {
    throw new StorageRefused(`Object storage ${what} failed (HTTP ${status}).`);
  }

  async put(orgId: string, bytes: Uint8Array) {
    if (this.refusal) throw new StorageRefused(this.refusal);
    const storageKey = randomBytes(16).toString("hex");
    const body = sealUpload(this.key, orgId, storageKey, bytes);
    const headers: Record<string, string> = { "content-type": "application/octet-stream" };
    if (this.cfg.sse) headers["x-amz-server-side-encryption"] = this.cfg.sse;
    const r = await this.call("PUT", this.where(orgId, storageKey), { body, headers });
    if (!r.ok) S3Storage.failed("write", r.status);
    return { storageKey, encrypted: this.key !== null };
  }

  async get(orgId: string, storageKey: string): Promise<Uint8Array> {
    const r = await this.call("GET", this.where(orgId, storageKey));
    if (r.status === 404) throw new StorageRefused("The stored file is missing.");
    if (!r.ok) S3Storage.failed("read", r.status);
    return openUpload(this.key, orgId, storageKey, Buffer.from(await r.arrayBuffer()));
  }

  async delete(orgId: string, storageKey: string): Promise<boolean> {
    const where = this.where(orgId, storageKey);
    const head = await this.call("HEAD", where);
    if (head.status === 404) return false;
    if (!head.ok) S3Storage.failed("check", head.status);
    const r = await this.call("DELETE", where);
    if (!r.ok && r.status !== 404) S3Storage.failed("delete", r.status);
    return true;
  }

  /** Every object whose name is a storage address (ListObjectsV2, paged). Never partial: a PUT is atomic. */
  async list(prefix = ""): Promise<StoredFile[]> {
    const out: StoredFile[] = [];
    let token: string | undefined;
    for (let page = 0; page < 10_000; page++) {
      const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
      if (prefix) query.prefix = prefix;
      if (token) query["continuation-token"] = token;
      const r = await this.call("GET", "", { query });
      if (!r.ok) S3Storage.failed("list", r.status);
      const doc = xml.parse(await r.text())?.ListBucketResult ?? {};
      for (const c of (doc.Contents ?? []) as { Key?: string; LastModified?: string }[]) {
        const [orgId, storageKey, extra] = String(c.Key ?? "").split("/");
        if (extra !== undefined || !validAddress(orgId ?? "", storageKey ?? "")) continue;
        out.push({ orgId, storageKey, partial: false, modifiedAt: new Date(c.LastModified ?? 0) });
      }
      token = String(doc.IsTruncated) === "true" ? String(doc.NextContinuationToken ?? "") || undefined : undefined;
      if (!token) return out;
    }
    return out;
  }

  async deletePartial(): Promise<boolean> {
    return false;
  }

  async deleteOrganisation(orgId: string): Promise<number> {
    if (!validAddress(orgId, "0".repeat(32))) throw new StorageRefused("Invalid storage address.");
    let n = 0;
    for (const f of await this.list(`${orgId}/`)) if (await this.delete(f.orgId, f.storageKey)) n += 1;
    return n;
  }
}

/** Names of the variables the S3 store needs (values are never printed). */
export const S3_ENV = ["CLEARLINE_S3_ENDPOINT", "CLEARLINE_S3_BUCKET", "CLEARLINE_S3_REGION", "CLEARLINE_S3_ACCESS_KEY_ID", "CLEARLINE_S3_SECRET_ACCESS_KEY"] as const;

/** The S3 settings from the environment, or the reason they are unusable (names only, never values). */
export function s3ConfigFromEnv(env: Record<string, string | undefined>): S3Config | { problem: string } {
  const missing = S3_ENV.filter((k) => !env[k]);
  if (missing.length) return { problem: `Uploads are refused: CLEARLINE_UPLOAD_STORE=s3 needs ${missing.join(", ")}.` };
  let url: URL;
  try { url = new URL(env.CLEARLINE_S3_ENDPOINT!); } catch { return { problem: "Uploads are refused: CLEARLINE_S3_ENDPOINT is not a URL." }; }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { problem: "Uploads are refused: CLEARLINE_S3_ENDPOINT must be https (http only for 127.0.0.1 or localhost)." };
  if (url.pathname !== "/" || url.search || url.username || url.password) return { problem: "Uploads are refused: CLEARLINE_S3_ENDPOINT must be an origin only (no path, query or credentials)." };
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.CLEARLINE_S3_BUCKET!)) return { problem: "Uploads are refused: CLEARLINE_S3_BUCKET is not a valid bucket name." };
  return {
    endpoint: url.origin, bucket: env.CLEARLINE_S3_BUCKET!, region: env.CLEARLINE_S3_REGION!,
    accessKeyId: env.CLEARLINE_S3_ACCESS_KEY_ID!, secretAccessKey: env.CLEARLINE_S3_SECRET_ACCESS_KEY!,
    sse: env.CLEARLINE_S3_SSE || undefined,
  };
}
