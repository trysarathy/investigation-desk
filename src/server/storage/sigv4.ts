import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3-compatible object storage (DigitalOcean Spaces, AWS S3, a local stand-in), written
 * with node:crypto only (no SDK dependency). Header-based signing ("Authorization: AWS4-HMAC-SHA256 ..."); the body
 * hash is always sent as x-amz-content-sha256, never UNSIGNED-PAYLOAD. Checked against the published S3 examples in
 * tests/server/s3-storage.test.ts. Never logs or returns the secret.
 */
export interface SigV4Credentials { accessKeyId: string; secretAccessKey: string; region: string; service?: string }

export interface SigV4Request {
  method: string;
  host: string;
  /** The path as sent, already URI-encoded (see encodePath). */
  path: string;
  query?: Record<string, string>;
  /** Header names in any case; host, x-amz-date and x-amz-content-sha256 are added by sign(). */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
}

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding as S3 expects: unreserved characters stay, everything else is %XX (upper case). */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Encode each segment of an object path, keeping the slashes. */
export function encodePath(p: string): string {
  return p.split("/").map(uriEncode).join("/");
}

export function canonicalQuery(q: Record<string, string> = {}): string {
  return Object.keys(q).sort().map((k) => `${uriEncode(k)}=${uriEncode(q[k])}`).join("&");
}

/** "20130524T000000Z" for a Date. */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface Signed { headers: Record<string, string>; canonicalRequest: string; stringToSign: string; signature: string }

/** Sign a request; returns the headers to send (including Authorization). */
export function sign(req: SigV4Request, creds: SigV4Credentials, now: Date = new Date()): Signed {
  const date = amzDate(now);
  const day = date.slice(0, 8);
  const service = creds.service ?? "s3";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  headers.host = req.host;
  headers["x-amz-date"] ??= date;
  headers["x-amz-content-sha256"] = req.payloadHash;
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [req.method.toUpperCase(), req.path || "/", canonicalQuery(req.query), names.map((n) => `${n}:${headers[n]}\n`).join(""), signedHeaders, req.payloadHash].join("\n");
  const scope = `${day}/${creds.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", headers["x-amz-date"], scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, day), creds.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature };
}
