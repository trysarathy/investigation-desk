import type { Chain, NormalisedInput } from "./types";

const HASH = /^(0x)?[0-9a-fA-F]{64}$/;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CUSTOMER_REF = /^C-\d+$/i;

/**
 * Spec 6.1: detect the input type by format. A customer reference is anything
 * that looks like one of our refs; it is looked up in File A by the caller.
 */
export function normaliseInput(raw: string): NormalisedInput {
  const s = raw.trim();
  if (HASH.test(s)) return { raw, kind: "hash", value: s.replace(/^0x/i, "").toLowerCase() };
  if (TRON_ADDRESS.test(s)) return { raw, kind: "tron_address", value: s };
  if (EVM_ADDRESS.test(s)) return { raw, kind: "evm_address", value: s.toLowerCase() };
  if (CUSTOMER_REF.test(s)) return { raw, kind: "customer_ref", value: s.toUpperCase() };
  return { raw, kind: "unrecognised", value: s };
}

export function normaliseHash(hash: string): string {
  return hash.trim().replace(/^0x/i, "").toLowerCase();
}

/** Tron base58 addresses are case-sensitive; EVM hex addresses are not. */
export function sameAddress(a: string, b: string): boolean {
  if (a.startsWith("0x") || b.startsWith("0x")) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function isEvm(chain: Chain): boolean {
  return chain !== "tron";
}
