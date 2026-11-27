import "server-only";
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, scryptSync, sign, verify, type KeyObject } from "node:crypto";

/**
 * v1 phase 5.6: the container of a merchant export — a tar archive, encrypted, then signed. No dependency beyond
 * node:crypto; a merchant can open it with standard tools (docs/privacy/RECORDS_OF_PROCESSING.md, "Export").
 *
 *  - Plain content: a POSIX ustar archive (manifest.json first).
 *  - Encryption: AES-256-GCM, key = scrypt(passphrase, random 16-byte salt, N=2^15, r=8, p=1). The passphrase comes
 *    from CLEARLINE_EXPORT_PASSPHRASE (at least 16 characters) and reaches the merchant out of band; it is never
 *    stored, printed or written into the archive.
 *    File: "CLX1" | uint32 BE header length | header JSON | ciphertext | 16-byte tag. The magic, length and header are
 *    the additional authenticated data, so the header cannot be changed either.
 *  - Signature: Ed25519 over the whole encrypted file, in a detached `<file>.sig.json`. The signing key comes from
 *    CLEARLINE_EXPORT_SIGNING_KEY (PKCS#8, PEM or base64 DER). A verifier must hold Clearline's public key from a
 *    trusted channel: the public key inside the signature file is informational and is never trusted on its own.
 */

// ---------------------------------------------------------------------------------------------- tar (ustar)

export interface TarEntry { name: string; data: Uint8Array }
const BLOCK = 512;
const SAFE_NAME = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._/-]{1,100}$/;

function octal(n: number, width: number): string { return n.toString(8).padStart(width - 1, "0") + "\0"; }

function header(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, "ascii");
  h.write(octal(0o644, 8), 100, "ascii"); h.write(octal(0, 8), 108, "ascii"); h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii"); h.write(octal(mtime, 12), 136, "ascii");
  h.write("        ", 148, "ascii"); h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii"); h.write("00", 263, "ascii");
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

/** A ustar archive of the entries, in order. Names: ASCII letters, digits, ., _, -, / (no "..", at most 100 bytes). */
export function tar(entries: TarEntry[], mtime = 0): Buffer {
  const parts: Buffer[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!SAFE_NAME.test(e.name)) throw new Error("tar: unsafe entry name");
    if (seen.has(e.name)) throw new Error("tar: duplicate entry name");
    seen.add(e.name);
    parts.push(header(e.name, e.data.byteLength, mtime), Buffer.from(e.data));
    const pad = (BLOCK - (e.data.byteLength % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}

/** Read an archive written by tar(): every regular file, checksums checked, unsafe names refused. */
export function untar(buf: Uint8Array): TarEntry[] {
  const b = Buffer.from(buf);
  const out: TarEntry[] = [];
  for (let at = 0; at + BLOCK <= b.length;) {
    const h = b.subarray(at, at + BLOCK);
    if (h.every((x) => x === 0)) break;
    const field = (o: number, n: number) => h.subarray(o, o + n).toString("ascii").replace(/\0.*$/s, "").trim();
    const stored = parseInt(field(148, 8), 8);
    let sum = 0; for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== stored) throw new Error("tar: bad header checksum");
    const name = field(0, 100), size = parseInt(field(124, 12), 8), type = field(156, 1);
    if (!SAFE_NAME.test(name) || !Number.isSafeInteger(size) || size < 0) throw new Error("tar: unsafe entry");
    if (at + BLOCK + size > b.length) throw new Error("tar: truncated");
    if (type === "0" || type === "") out.push({ name, data: new Uint8Array(b.subarray(at + BLOCK, at + BLOCK + size)) });
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- keys

export class ExportRefused extends Error {}

/** CLEARLINE_EXPORT_PASSPHRASE: at least 16 characters. Never echoed. */
export function passphraseFrom(value: string | undefined): string {
  if (!value || value.length < 16) throw new ExportRefused("Set CLEARLINE_EXPORT_PASSPHRASE (at least 16 characters) to encrypt or open an export.");
  return value;
}

/** CLEARLINE_EXPORT_SIGNING_KEY: an Ed25519 private key, PKCS#8 PEM or base64 DER. Never echoed. */
export function signingKeyFrom(value: string | undefined): KeyObject {
  if (!value) throw new ExportRefused("Set CLEARLINE_EXPORT_SIGNING_KEY (an Ed25519 private key, PKCS#8 PEM or base64 DER) to sign an export.");
  let key: KeyObject;
  try {
    key = value.includes("-----BEGIN") ? createPrivateKey(value) : createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
  } catch { throw new ExportRefused("CLEARLINE_EXPORT_SIGNING_KEY is not a readable private key."); }
  if (key.asymmetricKeyType !== "ed25519") throw new ExportRefused("CLEARLINE_EXPORT_SIGNING_KEY must be an Ed25519 key.");
  return key;
}

/** A trusted public key: SPKI PEM or base64 DER. */
export function publicKeyFrom(value: string): KeyObject {
  let key: KeyObject;
  try {
    key = value.includes("-----BEGIN") ? createPublicKey(value) : createPublicKey({ key: Buffer.from(value.trim(), "base64"), format: "der", type: "spki" });
  } catch { throw new ExportRefused("The public key is not readable."); }
  if (key.asymmetricKeyType !== "ed25519") throw new ExportRefused("The public key must be an Ed25519 key.");
  return key;
}

const spki = (k: KeyObject) => (k.type === "private" ? createPublicKey(k) : k).export({ format: "der", type: "spki" });
export const publicKeySha256 = (k: KeyObject) => createHash("sha256").update(spki(k)).digest("hex");

// ---------------------------------------------------------------------------------------------- seal / open

const MAGIC = Buffer.from("CLX1");
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const deriveKey = (passphrase: string, salt: Buffer) => scryptSync(passphrase.normalize("NFC"), salt, 32, SCRYPT);

export interface ExportHeader {
  format: "clearline-export/1"; cipher: "aes-256-gcm"; kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string }; iv: string;
  createdAt: string; signerPublicKeySha256: string;
}
export interface ExportSignature {
  format: "clearline-export-signature/1"; alg: "ed25519"; archiveSha256: string; signature: string;
  /** Informational only: verify against a public key obtained from a trusted channel. */
  publicKey: string; publicKeySha256: string;
}

/** Encrypt the plain archive with the passphrase, then sign the encrypted file. */
export function seal(plain: Uint8Array, o: { passphrase: string; signingKey: KeyObject; now: Date }): { archive: Buffer; signature: ExportSignature } {
  const salt = randomBytes(16), iv = randomBytes(12);
  const head: ExportHeader = { format: "clearline-export/1", cipher: "aes-256-gcm", kdf: { name: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64") },
    iv: iv.toString("base64"), createdAt: o.now.toISOString(), signerPublicKeySha256: publicKeySha256(o.signingKey) };
  const h = Buffer.from(JSON.stringify(head), "utf8");
  const len = Buffer.alloc(4); len.writeUInt32BE(h.length);
  const prefix = Buffer.concat([MAGIC, len, h]);
  const c = createCipheriv("aes-256-gcm", deriveKey(o.passphrase, salt), iv);
  c.setAAD(prefix);
  const archive = Buffer.concat([prefix, c.update(Buffer.from(plain)), c.final(), c.getAuthTag()]);
  const pub = spki(o.signingKey);
  return { archive, signature: {
    format: "clearline-export-signature/1", alg: "ed25519", archiveSha256: createHash("sha256").update(archive).digest("hex"),
    signature: sign(null, archive, o.signingKey).toString("base64"), publicKey: pub.toString("base64"), publicKeySha256: createHash("sha256").update(pub).digest("hex"),
  } };
}

/** True only when the signature over this exact file verifies with the TRUSTED public key. */
export function verifyExport(archive: Uint8Array, sig: ExportSignature, trusted: KeyObject): boolean {
  if (sig?.format !== "clearline-export-signature/1" || sig.alg !== "ed25519" || typeof sig.signature !== "string") return false;
  try { return verify(null, Buffer.from(archive), trusted, Buffer.from(sig.signature, "base64")); } catch { return false; }
}

/** Verify the signature with the trusted key, then decrypt. Refuses (never returns partial content) on any failure. */
export function openExport(archive: Uint8Array, sig: ExportSignature, o: { passphrase: string; trusted: KeyObject }): { header: ExportHeader; plain: Buffer } {
  if (!verifyExport(archive, sig, o.trusted)) throw new ExportRefused("The signature does not verify with the trusted public key: the file is not Clearline's or was changed.");
  const b = Buffer.from(archive);
  if (b.length < 8 || !b.subarray(0, 4).equals(MAGIC)) throw new ExportRefused("Not a Clearline export.");
  const n = b.readUInt32BE(4);
  if (8 + n + 16 > b.length) throw new ExportRefused("Not a Clearline export.");
  const head = JSON.parse(b.subarray(8, 8 + n).toString("utf8")) as ExportHeader;
  if (head.format !== "clearline-export/1" || head.cipher !== "aes-256-gcm" || head.kdf?.name !== "scrypt") throw new ExportRefused("Unknown export format.");
  if (head.kdf.N !== SCRYPT.N || head.kdf.r !== SCRYPT.r || head.kdf.p !== SCRYPT.p) throw new ExportRefused("Unknown export parameters.");
  const d = createDecipheriv("aes-256-gcm", deriveKey(o.passphrase, Buffer.from(head.kdf.salt, "base64")), Buffer.from(head.iv, "base64"));
  d.setAAD(b.subarray(0, 8 + n));
  d.setAuthTag(b.subarray(b.length - 16));
  try { return { header: head, plain: Buffer.concat([d.update(b.subarray(8 + n, b.length - 16)), d.final()]) }; } catch {
    throw new ExportRefused("The export does not open with this passphrase.");
  }
}
