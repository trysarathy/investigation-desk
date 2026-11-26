/**
 * v1 phase 6: uploads in S3-compatible object storage. SigV4 checked against the S3 documentation's published examples
 * (fictional example credentials from the AWS docs), then the store end to end against the local stand-in
 * (scripts/prodlocal/s3-standin.ts), which checks every signature. Fictional bytes only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { RefusingStorage, StorageRefused, uploadStorage } from "@/server/storage";
import { S3Storage, s3ConfigFromEnv } from "@/server/storage/s3";
import { EMPTY_SHA256, sha256Hex, sign } from "@/server/storage/sigv4";
import { startStandin, verify } from "../../scripts/prodlocal/s3-standin";

// The example credentials printed in the AWS S3 SigV4 documentation (not a real key).
const DOC = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
const DOC_DATE = new Date("2013-05-24T00:00:00Z");

describe("SigV4 (S3 documentation examples)", () => {
  it("GET Object with a Range header", () => {
    const s = sign({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { range: "bytes=0-9" }, payloadHash: EMPTY_SHA256 }, DOC, DOC_DATE);
    expect(s.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(s.headers.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
  it("GET Bucket (list objects) with a sorted, encoded query", () => {
    const s = sign({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/", query: { "max-keys": "2", prefix: "J" }, payloadHash: EMPTY_SHA256 }, DOC, DOC_DATE);
    expect(s.signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
  it("PUT Object with a body hash and an encoded key", () => {
    const payload = "Welcome to Amazon S3.";
    const s = sign({ method: "PUT", host: "examplebucket.s3.amazonaws.com", path: "/test%24file.text", headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, payloadHash: sha256Hex(payload) }, DOC, DOC_DATE);
    expect(s.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });
});

describe("S3 settings from the environment", () => {
  const ok = { CLEARLINE_S3_ENDPOINT: "https://sgp1.digitaloceanspaces.com", CLEARLINE_S3_BUCKET: "clearline-uploads-staging", CLEARLINE_S3_REGION: "sgp1", CLEARLINE_S3_ACCESS_KEY_ID: "fictional-id", CLEARLINE_S3_SECRET_ACCESS_KEY: "fictional-secret" };
  it("accepts an https origin and a valid bucket", () => {
    expect(s3ConfigFromEnv(ok)).toMatchObject({ endpoint: "https://sgp1.digitaloceanspaces.com", bucket: "clearline-uploads-staging", region: "sgp1" });
  });
  it("refuses missing settings by NAME, plain http off localhost, a path or credentials in the endpoint, a bad bucket; never echoes a value", () => {
    const p = (e: Record<string, string>) => { const r = s3ConfigFromEnv(e); return "problem" in r ? r.problem : ""; };
    expect(p({ ...ok, CLEARLINE_S3_SECRET_ACCESS_KEY: "" })).toBe("Uploads are refused: CLEARLINE_UPLOAD_STORE=s3 needs CLEARLINE_S3_SECRET_ACCESS_KEY.");
    expect(p({ ...ok, CLEARLINE_S3_ENDPOINT: "http://sgp1.digitaloceanspaces.com" })).toMatch(/must be https/);
    expect(p({ ...ok, CLEARLINE_S3_ENDPOINT: "http://127.0.0.1:4443" })).toBe("");
    expect(p({ ...ok, CLEARLINE_S3_ENDPOINT: "https://user:pw@sgp1.digitaloceanspaces.com" })).toMatch(/origin only/);
    expect(p({ ...ok, CLEARLINE_S3_ENDPOINT: "https://sgp1.digitaloceanspaces.com/bucket" })).toMatch(/origin only/);
    expect(p({ ...ok, CLEARLINE_S3_BUCKET: "Bad_Bucket" })).toMatch(/not a valid bucket/);
    for (const bad of [{ ...ok, CLEARLINE_S3_BUCKET: "" }, { ...ok, CLEARLINE_S3_ENDPOINT: "ftp://x" }, { ...ok, CLEARLINE_S3_BUCKET: "Bad_Bucket" }]) {
      expect(p(bad)).not.toContain("fictional-secret");
      expect(p(bad)).not.toContain("fictional-id");
    }
  });
});

describe("S3 upload store against the signature-checking stand-in", () => {
  const creds = { accessKeyId: "standin-fictional-id", secretAccessKey: randomBytes(24).toString("base64url"), region: "sgp1" };
  const dir = mkdtempSync(path.join(tmpdir(), "clearline-s3-"));
  const bucket = "clearline-uploads-test";
  const cfg = { ...creds, endpoint: "", bucket };
  let server: Server;
  const env = { ...process.env };
  beforeAll(async () => {
    server = await startStandin({ dir, port: 0, bucket, creds }); // any free port
    cfg.endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
  afterEach(() => { process.env = { ...env }; });
  const bytes = new TextEncoder().encode("Order,Amount\nORD-FICTIONAL-9,10.00\n");

  it("stores sealed bytes (never plaintext), reads them back, deletes once, lists by address", async () => {
    const st = new S3Storage(cfg, randomBytes(32));
    const org = randomUUID();
    const a = await st.put(org, bytes), b = await st.put(org, bytes);
    expect(a.encrypted).toBe(true);
    expect(a.storageKey).toMatch(/^[0-9a-f]{32}$/);
    const raw = readFileSync(path.join(dir, org, a.storageKey));
    expect(raw.subarray(0, 4).toString()).toBe("CLU1");
    expect(raw.includes(Buffer.from("ORD-FICTIONAL-9"))).toBe(false);
    expect(await st.get(org, a.storageKey)).toEqual(bytes);
    const listed = await st.list();
    expect(listed.filter((f) => f.orgId === org).map((f) => f.storageKey).sort()).toEqual([a.storageKey, b.storageKey].sort());
    expect(listed.every((f) => !f.partial && f.modifiedAt instanceof Date)).toBe(true);
    expect(await st.delete(org, a.storageKey)).toBe(true);
    expect(await st.delete(org, a.storageKey)).toBe(false);
    await expect(st.get(org, a.storageKey)).rejects.toThrow(/missing/);
    expect(await st.deleteOrganisation(org)).toBe(1);
    expect(readdirSync(dir).includes(org) ? readdirSync(path.join(dir, org)) : []).toEqual([]);
  });
  it("pages through more than one list page", async () => {
    const st = new S3Storage(cfg, randomBytes(32));
    const org = randomUUID();
    for (let i = 0; i < 3; i++) await st.put(org, bytes);
    const paged = new S3Storage(cfg, null, undefined, (url, init) => { const u = new URL(String(url)); if (u.searchParams.get("list-type")) u.searchParams.set("max-keys", "1"); return fetch(u, init); });
    // the signature covers max-keys=1000, so a tampered query is refused by the stand-in (403), proving the check
    await expect(paged.list(`${org}/`)).rejects.toThrow(/HTTP 403/);
    expect((await st.list(`${org}/`)).length).toBe(3);
  });
  it("a file moved to another organisation, a wrong key, a tampered object or a wrong secret never opens", async () => {
    const key = randomBytes(32);
    const st = new S3Storage(cfg, key);
    const org = randomUUID(), other = randomUUID();
    const { storageKey } = await st.put(org, bytes);
    const raw = readFileSync(path.join(dir, org, storageKey));
    (await import("node:fs")).mkdirSync(path.join(dir, other), { recursive: true });
    writeFileSync(path.join(dir, other, storageKey), raw);
    await expect(st.get(other, storageKey)).rejects.toThrow();
    await expect(new S3Storage(cfg, randomBytes(32)).get(org, storageKey)).rejects.toThrow();
    raw[raw.length - 20] ^= 1;
    writeFileSync(path.join(dir, org, storageKey), raw);
    await expect(st.get(org, storageKey)).rejects.toThrow();
    await expect(new S3Storage({ ...cfg, secretAccessKey: "wrong" }, key).put(org, bytes)).rejects.toThrow(/write failed \(HTTP 403\)/);
    await expect(st.get("../etc", storageKey)).rejects.toThrow(StorageRefused);
  });
  it("the stand-in refuses a stale clock, a body that does not match its hash, and a missing signature", () => {
    const req = (now: Date, payload: string, hashOf = payload) => {
      const s = sign({ method: "PUT", host: "127.0.0.1:1", path: "/b/k", payloadHash: sha256Hex(hashOf) }, creds, now);
      return verify({ method: "PUT", url: "/b/k", headers: { ...s.headers, host: "127.0.0.1:1" } }, Buffer.from(payload), creds);
    };
    expect(req(new Date(), "x")).toBe(true);
    expect(req(new Date(Date.now() - 20 * 60_000), "x")).toBe(false);
    expect(req(new Date(), "x", "y")).toBe(false);
    expect(verify({ method: "GET", url: "/b/k", headers: {} }, Buffer.alloc(0), creds)).toBe(false);
  });
  it("uploadStorage(): CLEARLINE_UPLOAD_STORE=s3 uses the bucket; production without the upload key refuses; a typo or missing setting refuses everything", async () => {
    Object.assign(process.env, { CLEARLINE_UPLOAD_STORE: "s3", CLEARLINE_S3_ENDPOINT: cfg.endpoint, CLEARLINE_S3_BUCKET: bucket, CLEARLINE_S3_REGION: creds.region, CLEARLINE_S3_ACCESS_KEY_ID: creds.accessKeyId, CLEARLINE_S3_SECRET_ACCESS_KEY: creds.secretAccessKey, CLEARLINE_UPLOAD_KEY: randomBytes(32).toString("base64") });
    const org = randomUUID();
    const put = await uploadStorage().put(org, bytes);
    expect(put.encrypted).toBe(true);
    expect(readdirSync(path.join(dir, org))).toEqual([put.storageKey]);
    expect(uploadStorage()).toBeInstanceOf(S3Storage);
    delete process.env.CLEARLINE_UPLOAD_KEY;
    (process.env as Record<string, string>).NODE_ENV = "production";
    await expect(uploadStorage().put(org, bytes)).rejects.toThrow(/CLEARLINE_UPLOAD_KEY is not set/);
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.CLEARLINE_UPLOAD_STORE = "S3";
    expect(uploadStorage()).toBeInstanceOf(RefusingStorage);
    await expect(uploadStorage().get(org, put.storageKey)).rejects.toThrow(/must be "local", "s3" or "postgres"/);
    process.env.CLEARLINE_UPLOAD_STORE = "s3";
    delete process.env.CLEARLINE_S3_BUCKET;
    await expect(uploadStorage().list!()).rejects.toThrow(/needs CLEARLINE_S3_BUCKET/);
  });
});
