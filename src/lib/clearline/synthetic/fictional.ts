/**
 * Fictional chain identifiers. They look like real TRON / Ethereum values but are built so that they can never be
 * real: every TRON address fails its base58check checksum, and every Ethereum address is mixed-case with a WRONG
 * EIP-55 checksum. Real addresses always pass these checks, so a scan can tell a fictional value from a real one.
 * The only real values in the synthetic data are the three public token contracts below.
 */
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import type { NetworkId } from "../merchant/types";
import type { Rng } from "./prng";

export const SYNTHETIC_LABEL = "Synthetic · fictional data" as const;

/** The only real values allowed in synthetic output: public token contracts. */
export const USDT_TRON_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const USDC_ETH_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const USDT_ETH_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
export const ALLOWED_REAL_CONTRACTS: readonly string[] = [USDT_TRON_CONTRACT, USDC_ETH_CONTRACT, USDT_ETH_CONTRACT];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const HEX = "0123456789abcdef";
const toHex = (b: Uint8Array): string => Array.from(b, (x) => HEX[x >> 4] + HEX[x & 15]).join("");

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

export function base58Decode(text: string): Uint8Array | null {
  let n = 0n;
  for (const ch of text) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of text) { if (ch !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

const check4 = (payload: Uint8Array): Uint8Array => sha256(sha256(payload)).slice(0, 4);

/** True when a TRON-style address carries a valid base58check checksum (as every real TRON address does). */
export function tronChecksumValid(address: string): boolean {
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return false;
  const sum = check4(raw.slice(0, 21));
  return sum.every((b, i) => b === raw[21 + i]);
}

/** EIP-55 mixed-case checksum of a 40-hex-digit body. */
export function eip55(hex40: string): string {
  const lower = hex40.toLowerCase();
  const h = toHex(keccak_256(new TextEncoder().encode(lower)));
  return [...lower].map((c, i) => (/[a-f]/.test(c) && parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}

/** True when a 0x address is in valid EIP-55 form (a real checksummed address always is). */
export function eip55Valid(address: string): boolean {
  const body = address.slice(2);
  return /^[0-9a-fA-F]{40}$/.test(body) && eip55(body) === body;
}

/** A fictional TRON address: 0x41 + 20 random bytes, with a deliberately wrong 4-byte checksum. */
export function fictionalTronAddress(rng: Rng): string {
  const raw = new Uint8Array(25);
  raw[0] = 0x41;
  raw.set(rng.bytes(20), 1);
  const good = check4(raw.slice(0, 21));
  const bad = rng.bytes(4);
  if (bad.every((b, i) => b === good[i])) bad[0] ^= 0xff;
  raw.set(bad, 21);
  return base58Encode(raw);
}

/** A fictional Ethereum address: mixed case, with exactly one letter's case flipped from its EIP-55 form. */
export function fictionalEthAddress(rng: Rng): string {
  for (;;) {
    const body = eip55(toHex(rng.bytes(20)));
    const letters = [...body].map((c, i) => (/[a-fA-F]/.test(c) ? i : -1)).filter((i) => i >= 0);
    if (letters.length < 4) continue;
    const at = letters[rng.int(0, letters.length - 1)];
    const c = body[at];
    const flipped = body.slice(0, at) + (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) + body.slice(at + 1);
    // Must stay mixed case (a single-case address carries no checksum at all).
    if (flipped === flipped.toLowerCase() || flipped === flipped.toUpperCase()) continue;
    return `0x${flipped}`;
  }
}

export function fictionalAddress(network: NetworkId, rng: Rng): string {
  return network === "tron" ? fictionalTronAddress(rng) : fictionalEthAddress(rng);
}

/** A fictional transaction hash: TRON 64 hex digits, EVM chains 0x + 64 hex digits. */
export function fictionalTxHash(network: NetworkId, rng: Rng): string {
  const h = toHex(rng.bytes(32));
  return network === "tron" ? h : `0x${h}`;
}

/** Emails in synthetic data use reserved, non-deliverable domains only. */
export const FICTIONAL_EMAIL_DOMAIN = "example.test";
