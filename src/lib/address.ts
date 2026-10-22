// Canonical address form per chain (spec "Data-quality guards"): EVM is lowercase hex with 0x;
// Tron is base58check, and the 41-prefixed hex form some APIs return is converted first.
// Server-side only (node:crypto); the client bundle never imports the engine.

import { createHash } from "node:crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TRON_HEX = /^(0x)?41[0-9a-fA-F]{40}$/;
const EVM_HEX = /^(0x)?[0-9a-fA-F]{40}$/;
const TRON_BASE58 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

function base58Encode(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function base58Decode(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const i = BASE58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const lead = s.match(/^1*/)![0].length;
  return Buffer.concat([Buffer.alloc(lead), Buffer.from(hex, "hex")]);
}

/** 41-prefixed Tron hex (with or without 0x) to base58check. */
export function tronHexToBase58(hex: string): string {
  const payload = Buffer.from(hex.replace(/^0x/i, ""), "hex");
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

/** Base58 Tron address to 41-prefixed hex, or the input unchanged if it isn't one. */
export function tronToHex(address: string): string {
  if (!TRON_BASE58.test(address)) return address;
  try {
    return base58Decode(address).subarray(0, 21).toString("hex");
  } catch {
    return address;
  }
}

export function canonicalAddress(address: string): string {
  const a = address.trim();
  if (TRON_HEX.test(a)) return tronHexToBase58(a);
  if (EVM_HEX.test(a)) return `0x${a.replace(/^0x/i, "").toLowerCase()}`;
  return a; // Tron base58 is case-sensitive; anything else compares as given.
}

export function sameAddress(a: string, b: string): boolean {
  return canonicalAddress(a) === canonicalAddress(b);
}
