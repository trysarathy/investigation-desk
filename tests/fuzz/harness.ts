/**
 * v1 E1 (phase 5.2): a tiny deterministic fuzzing harness (no dependency: fast-check is not installed in this build).
 * Seeded PRNG, generators for hostile text and bytes, and mutation of valid seed inputs. Every run prints nothing on
 * success; a failure names the seed and the iteration so it reproduces exactly:
 *   CLEARLINE_FUZZ_SEED=<seed> CLEARLINE_FUZZ_ITERATIONS=<n> npx vitest run tests/fuzz
 * Defaults keep the suite fast in CI; raise CLEARLINE_FUZZ_ITERATIONS for a longer local soak.
 * All generated data is random noise or mutated FICTIONAL samples; nothing real is ever used.
 */

export const SEED = Number(process.env.CLEARLINE_FUZZ_SEED ?? 0x5eed_e1);
export const ITERATIONS = Math.max(1, Number(process.env.CLEARLINE_FUZZ_ITERATIONS ?? 300));

/** mulberry32: small, fast, good enough for test-case generation. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  return { next, int, pick };
}
export type Rng = ReturnType<typeof rng>;

/** Characters parsers commonly trip on: delimiters, quotes, signs, separators, control and odd Unicode. */
const NASTY = [
  ",", ";", "\t", "|", '"', "'", "\n", "\r", "\r\n", "\\", "/", ":", "{", "}", "[", "]", "<", ">", "&", "=", "-", "+", "(", ")",
  ".", "0", "1", "9", " ", " ", " ", "’", "−", "e", "E", "C", "D", "R", "N", "\u0000", "\u0007", "\u001b",
  "﻿", "�", "​", "‮", "😀", "\ud800", "é", "€", "¥", "$", "%", "#", "@", "=cmd|' /C calc'!A0",
  "__proto__", "constructor", "prototype", "NaN", "Infinity", "-0", "1e309", "9".repeat(40), "<!ENTITY x SYSTEM \"file:///etc/passwd\">",
  "<!DOCTYPE d [<!ENTITY a \"aaaaaaaaaa\">]>", "&a;", "]]>", "<![CDATA[", ":61:", ":86:", ":20:", "-}", "{4:",
];

export function nastyText(r: Rng, maxLen = 200): string {
  const n = r.int(maxLen);
  let s = "";
  for (let i = 0; i < n; i++) {
    const roll = r.int(4);
    s += roll === 0 ? String.fromCharCode(r.int(0x80)) : roll === 1 ? String.fromCharCode(r.int(0x10000)) : r.pick(NASTY);
  }
  return s;
}

export function randomBytes(r: Rng, maxLen = 512): Uint8Array {
  const b = new Uint8Array(r.int(maxLen));
  for (let i = 0; i < b.length; i++) b[i] = r.int(256);
  return b;
}

/** Byte-level mutations of a valid sample: flips, deletions, insertions, duplications, truncation and splices. */
export function mutateBytes(r: Rng, seed: Uint8Array, rounds = 1 + r.int(6)): Uint8Array {
  let b = Array.from(seed);
  for (let k = 0; k < rounds; k++) {
    const at = b.length ? r.int(b.length) : 0;
    switch (r.int(7)) {
      case 0: if (b.length) b[at] = r.int(256); break;
      case 1: if (b.length) b[at] ^= 1 << r.int(8); break;
      case 2: b.splice(at, 1 + r.int(16)); break;
      case 3: b.splice(at, 0, ...Array.from(new TextEncoder().encode(r.pick(NASTY)))); break;
      case 4: { const len = 1 + r.int(32); b.splice(at, 0, ...b.slice(at, at + len)); break; }
      case 5: b = b.slice(0, at); break;
      default: { const from = r.int(Math.max(1, b.length)); b.splice(at, 0, ...b.slice(from, from + 1 + r.int(64))); }
    }
  }
  return Uint8Array.from(b);
}

export const enc = (s: string) => new TextEncoder().encode(s);
export const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** Text mutations at line granularity (keeps more of a format's structure than byte noise does). */
export function mutateLines(r: Rng, text: string): string {
  const lines = text.split("\n");
  for (let k = 0, n = 1 + r.int(4); k < n; k++) {
    const at = r.int(lines.length);
    switch (r.int(5)) {
      case 0: lines.splice(at, 1); break;
      case 1: lines.splice(at, 0, lines[r.int(lines.length)] ?? ""); break;
      case 2: lines[at] = (lines[at] ?? "") + r.pick(NASTY); break;
      case 3: lines[at] = nastyText(r, 40); break;
      default: { const l = lines[at] ?? ""; const c = r.int(l.length + 1); lines[at] = l.slice(0, c) + r.pick(NASTY) + l.slice(c); }
    }
  }
  return lines.join("\n");
}

/** A hostile input of one of several shapes for a text parser: noise, a mutated seed (bytes or lines), or a pathological repeat. */
export function textCase(r: Rng, seeds: readonly string[]): string {
  const seed = seeds.length ? r.pick(seeds) : "";
  switch (r.int(5)) {
    case 0: return nastyText(r);
    case 1: return dec(mutateBytes(r, enc(seed)));
    case 2: return mutateLines(r, seed);
    case 3: return r.pick(NASTY).repeat(1 + r.int(2000));
    default: return seed;
  }
}

export function bytesCase(r: Rng, seeds: readonly Uint8Array[]): Uint8Array {
  switch (r.int(4)) {
    case 0: return randomBytes(r);
    case 1: case 2: return mutateBytes(r, seeds.length ? r.pick(seeds) : new Uint8Array());
    default: return seeds.length ? r.pick(seeds) : new Uint8Array();
  }
}

/**
 * Runs `body` ITERATIONS times with a fresh per-iteration seed. A throw from `body` is re-thrown with the seed and
 * iteration so the failure reproduces. `maxMs` bounds a single iteration (a parser that blows up on pathological
 * input fails here rather than hanging CI).
 */
export async function fuzz(name: string, body: (r: Rng, i: number) => void | Promise<void>, opts: { iterations?: number; maxMs?: number } = {}) {
  const n = opts.iterations ?? ITERATIONS;
  const maxMs = opts.maxMs ?? 2_000;
  for (let i = 0; i < n; i++) {
    const r = rng(SEED ^ Math.imul(i + 1, 0x9e3779b1) ^ hash(name));
    const t0 = performance.now();
    try {
      await body(r, i);
    } catch (e) {
      throw new Error(`fuzz ${name}: iteration ${i} (CLEARLINE_FUZZ_SEED=${SEED}) failed: ${(e as Error)?.stack ?? e}`);
    }
    const ms = performance.now() - t0;
    if (ms > maxMs) throw new Error(`fuzz ${name}: iteration ${i} (CLEARLINE_FUZZ_SEED=${SEED}) took ${ms.toFixed(0)} ms (limit ${maxMs} ms)`);
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Calls fn; returns the thrown value, or undefined when it returned normally. */
export async function thrown(fn: () => unknown): Promise<unknown> {
  try { await fn(); return undefined; } catch (e) { return e; }
}
