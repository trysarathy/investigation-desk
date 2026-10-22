// Exact comparison of non-negative decimal strings. Amounts are never parsed as floats.

const DECIMAL = /^\d+(\.\d+)?$/;

export function isDecimal(s: string): boolean {
  return DECIMAL.test(s);
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  if (!isDecimal(a) || !isDecimal(b)) throw new Error(`Not a decimal string: ${!isDecimal(a) ? a : b}`);
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const aInt = ai.replace(/^0+(?=\d)/, "");
  const bInt = bi.replace(/^0+(?=\d)/, "");
  if (aInt.length !== bInt.length) return aInt.length < bInt.length ? -1 : 1;
  if (aInt !== bInt) return aInt < bInt ? -1 : 1;
  const len = Math.max(af.length, bf.length);
  const aFrac = af.padEnd(len, "0");
  const bFrac = bf.padEnd(len, "0");
  if (aFrac === bFrac) return 0;
  return aFrac < bFrac ? -1 : 1;
}

export function isZero(s: string): boolean {
  return /^0+(\.0+)?$/.test(s);
}
