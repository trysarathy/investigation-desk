/**
 * Base58Check for TRON addresses (version byte 0x41). Checksum = first 4 bytes of sha256(sha256(payload)), using
 * node:crypto. Pure functions; no network.
 */
import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("invalid base58 character");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

export function base58checkEncode(payload: Uint8Array): string {
  const check = sha256(sha256(payload)).slice(0, 4);
  const all = new Uint8Array(payload.length + 4);
  all.set(payload); all.set(check, payload.length);
  return base58Encode(all);
}

export function base58checkDecode(s: string): Uint8Array {
  const all = base58Decode(s);
  if (all.length < 5) throw new Error("base58check: too short");
  const payload = all.slice(0, -4);
  const check = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) if (check[i] !== all[all.length - 4 + i]) throw new Error("base58check: bad checksum");
  return payload;
}

/** 20-byte hex (optionally 0x- or 41-prefixed, or a 32-byte topic) → TRON base58check address. */
export function tronHexToBase58(hex: string): string {
  let h = hex.toLowerCase().replace(/^0x/, "");
  if (h.length === 64) h = h.slice(24); // ABI-padded topic
  if (h.length === 42 && h.startsWith("41")) h = h.slice(2);
  if (h.length !== 40) throw new Error("TRON address must be 20 bytes");
  return base58checkEncode(hexToBytes("41" + h));
}

/** TRON base58check address → 20-byte lowercase hex (no 41 prefix). Throws on a bad checksum or version byte. */
export function tronBase58ToHex20(addr: string): string {
  const p = base58checkDecode(addr);
  if (p.length !== 21 || p[0] !== 0x41) throw new Error("not a TRON mainnet address (version 0x41)");
  return bytesToHex(p.slice(1));
}

export function isTronAddress(addr: string): boolean {
  try { tronBase58ToHex20(addr); return true; } catch { return false; }
}
