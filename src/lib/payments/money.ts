// Exact decimal arithmetic on amount strings, for the amount and fee rules. Amounts are never
// floats: each value is an integer of minor units at its own scale, aligned before adding.

const SIGNED = /^-?\d+(\.\d+)?$/;

interface Fixed { v: bigint; scale: number }

function parse(s: string): Fixed {
  if (!SIGNED.test(s)) throw new Error(`Not a decimal amount: ${s}`);
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace(/^-/, "").split(".");
  const v = BigInt(int + frac);
  return { v: neg ? -v : v, scale: frac.length };
}

const align = (a: Fixed, b: Fixed): [bigint, bigint, number] => {
  const scale = Math.max(a.scale, b.scale);
  return [a.v * 10n ** BigInt(scale - a.scale), b.v * 10n ** BigInt(scale - b.scale), scale];
};

function format({ v, scale }: Fixed): string {
  const neg = v < 0n;
  let digits = (neg ? -v : v).toString().padStart(scale + 1, "0");
  let out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  // Trailing zeros carry no value; keep the shortest exact form.
  if (scale) out = out.replace(/\.?0+$/, "");
  digits = out;
  return neg && digits !== "0" ? `-${digits}` : digits;
}

export const isAmount = (s: string | undefined): s is string => !!s && SIGNED.test(s);

export function add(a: string, b: string): string {
  const [x, y, scale] = align(parse(a), parse(b));
  return format({ v: x + y, scale });
}

export function sub(a: string, b: string): string {
  const [x, y, scale] = align(parse(a), parse(b));
  return format({ v: x - y, scale });
}

export function abs(a: string): string {
  return a.replace(/^-/, "");
}

export function eq(a: string, b: string): boolean {
  const [x, y] = align(parse(a), parse(b));
  return x === y;
}

export const isZeroAmount = (a: string) => eq(a, "0");

/** a × bps / 10 000, exact (a basis-point fee never needs rounding to compare). */
export function mulBps(a: string, bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Basis points must be a whole number of 0 or more: ${bps}`);
  const p = parse(a);
  return format({ v: p.v * BigInt(bps), scale: p.scale + 4 });
}

export function sum(values: string[]): string {
  return values.reduce((acc, v) => add(acc, v), "0");
}
