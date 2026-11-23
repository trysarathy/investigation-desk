/** rc7 upload storage on local disk: random keys, per-organisation folders, AES-256-GCM at rest, refusals. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { StorageRefused, uploadStorage } from "@/server/storage";
import { LocalDiskStorage, uploadKeyFromEnv } from "@/server/storage/local";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const bytes = new TextEncoder().encode("Order,Amount\nORD-FICTIONAL-1,10.00\n");
const fresh = () => mkdtempSync(path.join(tmpdir(), "clearline-storage-"));

describe("local upload storage", () => {
  it("encrypts with AES-256-GCM under a random key in the organisation's folder, and reads it back", async () => {
    const dir = fresh();
    const org = randomUUID();
    const st = new LocalDiskStorage(dir, randomBytes(32));
    const a = await st.put(org, bytes);
    const b = await st.put(org, bytes);
    expect(a.encrypted).toBe(true);
    expect(a.storageKey).toMatch(/^[0-9a-f]{32}$/);
    expect(a.storageKey).not.toBe(b.storageKey);
    expect(readdirSync(path.join(dir, org)).sort()).toEqual([a.storageKey, b.storageKey].sort());
    const raw = readFileSync(path.join(dir, org, a.storageKey));
    expect(raw.includes(Buffer.from("ORD-FICTIONAL-1"))).toBe(false);
    expect(await st.get(org, a.storageKey)).toEqual(bytes);
    expect(await st.delete(org, a.storageKey)).toBe(true);
    expect(await st.delete(org, a.storageKey)).toBe(false);
  });
  it("detects tampering, a file moved to another organisation, a wrong key and invalid addresses", async () => {
    const dir = fresh();
    const org = randomUUID(), other = randomUUID();
    const key = randomBytes(32);
    const st = new LocalDiskStorage(dir, key);
    const { storageKey } = await st.put(org, bytes);
    const file = path.join(dir, org, storageKey);
    const raw = readFileSync(file);
    raw[raw.length - 20] ^= 1;
    writeFileSync(file, raw);
    await expect(st.get(org, storageKey)).rejects.toThrow();
    const moved = await st.put(org, bytes);
    const target = path.join(dir, other, moved.storageKey);
    (await import("node:fs")).mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(dir, org, moved.storageKey)));
    await expect(st.get(other, moved.storageKey)).rejects.toThrow();
    await expect(new LocalDiskStorage(dir, randomBytes(32)).get(org, moved.storageKey)).rejects.toThrow();
    await expect(new LocalDiskStorage(dir, null).get(org, moved.storageKey)).rejects.toThrow(StorageRefused);
    await expect(st.get("../etc", moved.storageKey)).rejects.toThrow(StorageRefused);
    await expect(st.get(org, "../../passwd")).rejects.toThrow(StorageRefused);
  });
  it("without a key: stored unencrypted in development, refused in production; a malformed key is refused without echoing it", async () => {
    process.env.CLEARLINE_UPLOAD_DIR = fresh();
    delete process.env.CLEARLINE_UPLOAD_KEY;
    (process.env as Record<string, string>).NODE_ENV = "development";
    const org = randomUUID();
    const dev = await uploadStorage().put(org, bytes);
    expect(dev.encrypted).toBe(false);
    expect(await uploadStorage().get(org, dev.storageKey)).toEqual(bytes);
    (process.env as Record<string, string>).NODE_ENV = "production";
    await expect(uploadStorage().put(org, bytes)).rejects.toThrow(/CLEARLINE_UPLOAD_KEY is not set/);
    process.env.CLEARLINE_UPLOAD_KEY = randomBytes(32).toString("base64");
    expect((await uploadStorage().put(org, bytes)).encrypted).toBe(true);
    const bad = "not-a-valid-key-FICTIONAL";
    try { uploadKeyFromEnv(bad); throw new Error("accepted"); } catch (e) {
      expect(e).toBeInstanceOf(StorageRefused);
      expect((e as Error).message).not.toContain(bad);
    }
    expect(() => uploadKeyFromEnv(randomBytes(16).toString("base64"))).toThrow(StorageRefused);
  });
});
