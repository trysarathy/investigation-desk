import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectDecimalSeparator, formatMinor, parseAmount, type AmountOptions } from "@/lib/clearline/ingest";

const p2: AmountOptions = { precision: 2 };
const comma2: AmountOptions = { precision: 2, decimalSeparator: "," };
const minor = (text: string, opts: AmountOptions = p2) => {
  const r = parseAmount(text, opts);
  if (!r.ok) throw new Error(`${text}: ${r.code} ${r.message}`);
  return r.value;
};
const code = (text: string, opts: AmountOptions = p2) => {
  const r = parseAmount(text, opts);
  return r.ok ? `ok:${r.value}` : r.code;
};

describe("parseAmount: thousand separators", () => {
  it.each([
    ["1234.56", p2], ["1,234.56", p2], ["1'234.56", p2], ["1’234.56", p2], ["1 234.56", p2],
    ["1.234,56", comma2], ["1 234,56", comma2], ["1 234,56", comma2], ["1 234,56", comma2], ["1'234,56", comma2],
  ] as const)("%s → 123456", (text, opts) => expect(minor(text, opts)).toBe(123456n));

  it("reads long groupings and plain integers", () => {
    expect(minor("12,345,678.90")).toBe(1234567890n);
    expect(minor("12.345.678,90", comma2)).toBe(1234567890n);
    expect(minor("7")).toBe(700n);
    expect(minor("0.5")).toBe(50n);
    expect(minor(".5")).toBe(50n);
    expect(minor("1.")).toBe(100n);
  });

  it("refuses malformed grouping instead of guessing", () => {
    expect(code("1,5")).toBe("bad_grouping"); // a decimal comma read with the point option
    expect(code("12,34,567.00")).toBe("bad_grouping"); // lakh grouping is not accepted
    expect(code("1,234 567.00")).toBe("bad_grouping"); // two different separators
    expect(code("1.234.567,00")).toBe("bad_grouping"); // decimal comma read with the point option
    expect(code("1 234,56")).toBe("bad_grouping");
    expect(code("1,2345.00")).toBe("bad_grouping");
  });
});

describe("parseAmount: signs", () => {
  it.each([["-1.00"], ["(1.00)"], ["1.00-"], ["−1.00"], ["( 1.00 )"], ["-SGD 1.00"], ["SGD -1.00"], ["(SGD 1.00)"], ["$(1.00)"]])("%s is negative", (t) =>
    expect(minor(t)).toBe(-100n));
  it("reads a leading plus", () => expect(minor("+1.00")).toBe(100n));
  it("DR/CR needs the option", () => {
    expect(code("1.00 DR")).toBe("dr_cr_disabled");
    expect(minor("1.00 DR", { precision: 2, allowDrCr: true })).toBe(-100n);
    expect(minor("1,00 cr", { precision: 2, allowDrCr: true, decimalSeparator: "," })).toBe(100n);
    expect(minor("1.00DR", { precision: 2, allowDrCr: true })).toBe(-100n);
  });
  it("refuses two negative markers or mixed signs", () => {
    for (const t of ["(-1.00)", "-1.00-", "(1.00)-", "+-1"]) expect(code(t)).toBe("conflicting_signs");
    expect(code("-1.00 DR", { precision: 2, allowDrCr: true })).toBe("conflicting_signs");
    expect(code("-1.00 CR", { precision: 2, allowDrCr: true })).toBe("conflicting_signs");
  });
  it("zero is zero, whatever its sign", () => expect(minor("-0.00")).toBe(0n));
});

describe("parseAmount: currency symbols and codes", () => {
  it.each([["SGD 1,234.56"], ["$1,234.56"], ["S$1,234.56"], ["US$ 1,234.56"], ["1,234.56 SGD"], ["€1,234.56"], ["1,234.56€"], ["USD1,234.56"]])("%s", (t) =>
    expect(minor(t)).toBe(123456n));
  it("token code suffix with 6 decimals", () => expect(minor("1,234.56 USDT", { precision: 6 })).toBe(1_234_560_000n));
  it("decimal comma with a trailing euro sign", () => expect(minor("1.234,56 €", comma2)).toBe(123456n));
  it("refuses text that is not an amount", () => {
    for (const t of ["abc", "SGD", "12abc34", "1.2.3x", "--", "SGD 1.00 USD extra"]) expect(code(t)).not.toMatch(/^ok/);
  });
});

describe("parseAmount: precision", () => {
  it("more fractional digits than the precision is an error, never rounded", () => {
    expect(code("1.234")).toBe("too_many_decimals");
    expect(code("1.005")).toBe("too_many_decimals");
    expect(code("1.230")).toBe("too_many_decimals");
    expect(code("100.5", { precision: 0 })).toBe("too_many_decimals");
  });
  it("trailing zeros beyond the precision only with the explicit option", () => {
    expect(minor("1250.000", { precision: 2, allowTrailingZeros: true })).toBe(125000n);
    expect(code("1250.001", { precision: 2, allowTrailingZeros: true })).toBe("too_many_decimals");
  });
  it("JPY has 0 decimals", () => {
    expect(minor("¥1,234", { precision: 0 })).toBe(1234n);
    expect(minor("JPY 1.234", { precision: 0, decimalSeparator: "," })).toBe(1234n);
  });
  it("18-decimal token amounts are exact", () => {
    const p18: AmountOptions = { precision: 18 };
    expect(minor("0.000000000000000001", p18)).toBe(1n);
    expect(minor("123456789012.123456789012345678", p18)).toBe(123456789012123456789012345678n);
    expect(minor("1,000,000.5 ETH", p18)).toBe(1_000_000_500_000_000_000_000_000n);
    expect(code("0.0000000000000000001", p18)).toBe("too_many_decimals");
    expect(formatMinor(123456789012123456789012345678n, 18)).toBe("123456789012.123456789012345678");
  });
  it("refuses an invalid precision, exponents, empty and oversized input", () => {
    expect(code("1", { precision: 19 })).toBe("invalid_precision");
    expect(code("1", { precision: 1.5 })).toBe("invalid_precision");
    expect(code("1.5E+3")).toBe("exponent");
    expect(code("1e5")).toBe("exponent");
    expect(code("  ")).toBe("empty");
    expect(code("1".repeat(65))).toBe("too_long");
    expect(code("1".repeat(31))).toBe("too_large");
  });
});

describe("detectDecimalSeparator (column level)", () => {
  it("decides from any sample that only one reading fits", () => {
    expect(detectDecimalSeparator(["1,234", "12,5"])).toEqual({ status: "decided", decimalSeparator: ",", evidence: 1 });
    expect(detectDecimalSeparator(["1,234", "1,234.50"])).toEqual({ status: "decided", decimalSeparator: ".", evidence: 1 });
    expect(detectDecimalSeparator(["1.234.567", "2.000"])).toMatchObject({ status: "decided", decimalSeparator: "," });
    expect(detectDecimalSeparator(["1,234,567"])).toMatchObject({ status: "decided", decimalSeparator: "." });
    expect(detectDecimalSeparator(["1 234,567"])).toMatchObject({ status: "decided", decimalSeparator: "," });
    expect(detectDecimalSeparator(["SGD 1.234,56", "(5,00)"])).toMatchObject({ status: "decided", decimalSeparator: "," });
  });
  it("reports ambiguity when every value could be either (e.g. 1,234 alone)", () => {
    expect(detectDecimalSeparator(["1,234"])).toEqual({ status: "ambiguous", candidates: [".", ","], examples: ["1,234"] });
    expect(detectDecimalSeparator(["1.500", "2.000", ""])).toMatchObject({ status: "ambiguous" });
  });
  it("reports a conflict when samples disagree", () => {
    expect(detectDecimalSeparator(["1,234.56", "1.234,56"])).toMatchObject({ status: "conflict", pointExamples: ["1,234.56"], commaExamples: ["1.234,56"] });
  });
  it("whole numbers decide nothing", () => expect(detectDecimalSeparator(["12", "1 000", ""])).toEqual({ status: "no_separators" }));
});

/** mulberry32: a tiny seeded PRNG, so the property test is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: random amounts round-trip exactly in every format", () => {
  const rand = mulberry32(20261123);
  const int = (n: number) => Math.floor(rand() * n);
  const digits = (n: number) => Array.from({ length: n }, () => "0123456789"[int(10)]).join("");
  const group = (whole: string, sep: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const styles: { dec: "." | ","; groups: string[] }[] = [
    { dec: ".", groups: ["", ",", "'", " ", " ", " "] },
    { dec: ",", groups: ["", ".", "'", " ", " ", " "] },
  ];
  const signs = ["", "-", "()", "trail", "DR", "+"] as const;
  const affixes = ["", "SGD ", "$", " USDT", " €", "US$"] as const;

  it("10,000 generated values", () => {
    for (let i = 0; i < 10_000; i++) {
      const precision = [0, 2, 2, 6, 8, 18][int(6)];
      const whole = digits(1 + int(16)).replace(/^0+(?=\d)/, "");
      const fracLen = precision === 0 ? 0 : int(precision + 1);
      const frac = digits(fracLen);
      const expectedAbs = BigInt(whole) * 10n ** BigInt(precision) + BigInt(frac.padEnd(precision, "0") || "0");
      const style = styles[int(2)];
      const g = style.groups[int(style.groups.length)];
      let body = group(whole, g) + (fracLen ? style.dec + frac : "");
      const affix = affixes[int(affixes.length)];
      body = affix.startsWith(" ") || affix === " €" ? body + affix : affix + body;
      const sign = signs[int(signs.length)];
      const text = sign === "-" ? "-" + body : sign === "()" ? `(${body})` : sign === "trail" ? body + "-" : sign === "DR" ? body + " DR" : sign === "+" ? "+" + body : body;
      const negative = sign === "-" || sign === "()" || sign === "trail" || sign === "DR";
      const r = parseAmount(text, { precision, decimalSeparator: style.dec, allowDrCr: true });
      if (!r.ok) throw new Error(`#${i} ${JSON.stringify(text)} p=${precision}: ${r.message}`);
      expect(r.value).toBe(negative ? -expectedAbs : expectedAbs);
      // and back: formatMinor then parse again is the identity
      expect(parseAmount(formatMinor(r.value, precision), { precision })).toEqual({ ok: true, value: r.value });
    }
  });
});

describe("source hygiene: no float conversion of amounts", () => {
  const dir = path.resolve(__dirname, "../../../src/lib/clearline/ingest");
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : [path.join(d, f)]));
  // xlsx-cell.ts is the single documented exception: an .xlsx numeric cell IS a double.
  const sources = files(dir).filter((f) => f.endsWith(".ts") && path.basename(f) !== "xlsx-cell.ts");

  it("finds the module sources", () => expect(sources.length).toBeGreaterThanOrEqual(6));
  it.each(sources.map((f) => [path.relative(dir, f), f]))("%s has no parseFloat or Number(", (_rel, f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/parseFloat/);
    expect(src).not.toMatch(/\bNumber\(/);
  });
  it("decimal.ts does not use Math at all", () => {
    expect(readFileSync(path.join(dir, "decimal.ts"), "utf8")).not.toMatch(/\bMath\./);
  });
});
