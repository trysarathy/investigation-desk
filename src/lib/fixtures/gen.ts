// Deterministic generators for sample hashes and addresses. Every value they produce is
// fabricated: none of these hashes or addresses exist on any chain.

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(seed: string, alphabet: string, n: number): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(r() * alphabet.length)];
  return out;
}

const HEX = "0123456789abcdef";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const tronHash = (seed: string) => pick(`tx:${seed}`, HEX, 64);
export const evmHash = (seed: string) => `0x${pick(`tx:${seed}`, HEX, 64)}`;
export const tronAddress = (seed: string) => `T${pick(`ta:${seed}`, BASE58, 33)}`;
export const evmAddress = (seed: string) => `0x${pick(`ea:${seed}`, HEX, 40)}`;

/** Same first 4 and last 4 characters as `target`, different middle: an address-poisoning look-alike. */
export function lookAlike(target: string, seed: string): string {
  if (target.startsWith("0x")) {
    const body = target.slice(2);
    return `0x${body.slice(0, 4)}${pick(`la:${seed}`, HEX, body.length - 8)}${body.slice(-4)}`;
  }
  return `${target.slice(0, 4)}${pick(`la:${seed}`, BASE58, target.length - 8)}${target.slice(-4)}`;
}
