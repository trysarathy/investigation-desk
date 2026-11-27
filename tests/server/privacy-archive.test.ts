/**
 * v1 phase 5.6: the export container (src/server/privacy/archive.ts) — tar round trip, unsafe names refused, encrypt
 * then sign, and every way an export must refuse to open: another signer, a changed byte, a wrong passphrase.
 * Keys and passphrases are generated per test run (fictional, never stored).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExportRefused, openExport, passphraseFrom, publicKeyFrom, seal, signingKeyFrom, tar, untar, verifyExport } from "../../src/server/privacy/archive";

const keys = () => generateKeyPairSync("ed25519");
const PASS = "fictional export passphrase 0001";

describe("tar", () => {
  it("round-trips entries, including empty and block-sized ones", () => {
    const entries = [
      { name: "manifest.json", data: new TextEncoder().encode("{}") },
      { name: "tables/empty.jsonl", data: new Uint8Array(0) },
      { name: "files/0b6c1d2e-0000-4000-8000-000000000001", data: randomBytes(1024) },
      { name: "files/odd", data: randomBytes(777) },
    ];
    const back = untar(tar(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i++) expect(Buffer.from(back[i].data).equals(Buffer.from(entries[i].data))).toBe(true);
  });

  it("is a standard archive the system tar reads", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "clearline-tar-"));
    writeFileSync(path.join(dir, "x.tar"), tar([{ name: "a/b.txt", data: new TextEncoder().encode("fictional\n") }]));
    expect(execFileSync("tar", ["-tf", path.join(dir, "x.tar")]).toString().trim()).toBe("a/b.txt");
    execFileSync("tar", ["-xf", path.join(dir, "x.tar"), "-C", dir]);
    expect(readFileSync(path.join(dir, "a/b.txt"), "utf8")).toBe("fictional\n");
  });

  it("refuses unsafe or duplicate names, and a corrupted header", () => {
    for (const name of ["../x", "/etc/x", "a/../b", "a/./b", "", "a b", "x".repeat(101)]) expect(() => tar([{ name, data: new Uint8Array(1) }]), name).toThrow();
    expect(() => tar([{ name: "a", data: new Uint8Array(1) }, { name: "a", data: new Uint8Array(1) }])).toThrow(/duplicate/);
    const t = tar([{ name: "a", data: new Uint8Array(3) }]);
    t[0] = "b".charCodeAt(0);
    expect(() => untar(t)).toThrow(/checksum/);
  });
});

describe("seal and open", () => {
  it("opens only with the trusted key and the passphrase; the ciphertext holds no plain content", () => {
    const k = keys();
    const plain = tar([{ name: "manifest.json", data: new TextEncoder().encode('{"marker":"Zephyrine fictional"}') }]);
    const { archive, signature } = seal(plain, { passphrase: PASS, signingKey: k.privateKey, now: new Date("2026-11-25T00:00:00Z") });
    expect(archive.includes(Buffer.from("Zephyrine"))).toBe(false);
    expect(archive.includes(Buffer.from(PASS))).toBe(false);
    expect(verifyExport(archive, signature, k.publicKey)).toBe(true);
    const opened = openExport(archive, signature, { passphrase: PASS, trusted: k.publicKey });
    expect(opened.plain.equals(plain)).toBe(true);
    expect(opened.header.signerPublicKeySha256).toBe(signature.publicKeySha256);

    // another signer (even with its own public key placed in the signature file) is refused
    const other = keys();
    const forged = seal(plain, { passphrase: PASS, signingKey: other.privateKey, now: new Date() });
    expect(() => openExport(forged.archive, forged.signature, { passphrase: PASS, trusted: k.publicKey })).toThrow(ExportRefused);
    // one changed byte anywhere (header, ciphertext or tag)
    for (const at of [10, Math.floor(archive.length / 2), archive.length - 1]) {
      const bad = Buffer.from(archive); bad[at] ^= 1;
      expect(() => openExport(bad, signature, { passphrase: PASS, trusted: k.publicKey }), String(at)).toThrow(/signature/);
    }
    // the right file and signer, the wrong passphrase
    expect(() => openExport(archive, signature, { passphrase: "another fictional passphrase", trusted: k.publicKey })).toThrow(/passphrase/);
  });

  it("reads keys from PEM or base64 DER and refuses weak or wrong inputs without echoing them", () => {
    const k = keys();
    const pem = k.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const der = k.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(signingKeyFrom(pem).asymmetricKeyType).toBe("ed25519");
    expect(signingKeyFrom(der).asymmetricKeyType).toBe("ed25519");
    expect(publicKeyFrom(k.publicKey.export({ format: "pem", type: "spki" }).toString()).asymmetricKeyType).toBe("ed25519");
    expect(publicKeyFrom(k.publicKey.export({ format: "der", type: "spki" }).toString("base64")).asymmetricKeyType).toBe("ed25519");
    expect(() => signingKeyFrom(undefined)).toThrow(ExportRefused);
    try { signingKeyFrom("not-a-key-zzz"); } catch (e) { expect(String(e)).not.toContain("not-a-key-zzz"); }
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => signingKeyFrom(rsa)).toThrow(/Ed25519/);
    expect(() => passphraseFrom("short")).toThrow(ExportRefused);
    expect(passphraseFrom(PASS)).toBe(PASS);
  });
});
