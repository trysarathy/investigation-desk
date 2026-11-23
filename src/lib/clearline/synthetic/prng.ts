/**
 * Seeded PRNG for the synthetic generator (sfc32, seeded through splitmix32). Pure and deterministic: no global
 * random source and no clock anywhere in this module tree. Floats are used only to choose, never for money.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform 32-bit unsigned integer. */
  u32(): number;
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number;
  /** BigInt in [lo, hi] inclusive (hi − lo below 2^53). */
  big(lo: bigint, hi: bigint): bigint;
  chance(p: number): boolean;
  pick<T>(xs: readonly T[]): T;
  weighted<T>(xs: readonly (readonly [T, number])[]): T;
  bytes(n: number): Uint8Array;
  shuffle<T>(xs: readonly T[]): T[];
  /** An independent stream derived from this one and a label (so adding draws in one place does not move another). */
  fork(label: string): Rng;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a 32-bit of a string: turns a fork label into a seed component. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const init = splitmix32(seed);
  let a = init(), b = init(), c = init(), d = init();
  const u32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) u32();
  const next = () => u32() / 4294967296;
  const rng: Rng = {
    next,
    u32,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    big: (lo, hi) => lo + BigInt(Math.floor(next() * Number(hi - lo + 1n))),
    chance: (p) => next() < p,
    pick: (xs) => {
      if (xs.length === 0) throw new RangeError("pick from an empty list");
      return xs[Math.floor(next() * xs.length)];
    },
    weighted: (xs) => {
      const total = xs.reduce((t, [, w]) => t + w, 0);
      let r = next() * total;
      for (const [x, w] of xs) { r -= w; if (r < 0) return x; }
      return xs[xs.length - 1][0];
    },
    bytes: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = u32() & 0xff;
      return out;
    },
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    fork: (label) => createRng((seed ^ fnv1a(label)) >>> 0),
  };
  return rng;
}
