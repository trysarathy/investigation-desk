/**
 * Exact amount parsing: text as people and banks write it → integer minor units (bigint). String and BigInt
 * operations only: no floating point, no rounding. A value with more fractional digits than the precision allows is
 * an error, never rounded. (tests/clearline/ingest/decimal.test.ts fails if a float conversion appears here.)
 */
import { fail, ok, type Result } from "./errors";

export type DecimalSeparator = "." | ",";

export interface AmountOptions {
  /** Digits after the decimal point in the minor unit: 2 for SGD, 0 for JPY, 6 for USDT, up to 18. */
  precision: number;
  /** "." (default): 1,234.56 · 1'234.56 · 1 234.56. ",": 1.234,56 · 1 234,56. */
  decimalSeparator?: DecimalSeparator;
  /** Accept a trailing DR (negative) or CR (positive) marker. Off by default: a DR/CR value is then an error. */
  allowDrCr?: boolean;
  /**
   * Accept extra fractional digits when they are all zeros ("1250.000" at precision 2). Off by default: any digit
   * beyond the precision is an error, so nothing is ever rounded or dropped without the caller opting in.
   */
  allowTrailingZeros?: boolean;
}

export type AmountErrorCode =
  | "empty" | "invalid_precision" | "too_long" | "not_a_number" | "exponent" | "bad_grouping"
  | "too_many_decimals" | "conflicting_signs" | "dr_cr_disabled" | "too_large";

export type AmountResult = Result<bigint, AmountErrorCode>;

export const MAX_PRECISION = 18;
const MAX_TEXT = 64;
const MAX_INTEGER_DIGITS = 30;
/** Currency symbols that may precede or follow an amount. */
const SYMBOLS = "$€£¥₩₹₱₫฿₽₺₪₦";
const MINUS = "-−‒–"; // hyphen-minus, minus sign, figure dash, en dash (spreadsheets export all of them)
const APOSTROPHES = "'’";

interface Core { body: string; negative: boolean; drCr?: "DR" | "CR" }

/**
 * Peel signs, brackets, DR/CR and one currency code or symbol on each side off an amount, leaving the digits and
 * separators. Every sign marker is counted, so "(-1.00)" or "-1.00 DR" is a conflict rather than a guess.
 */
function peel(text: string, allowDrCr: boolean): Result<Core, AmountErrorCode> {
  let s = text.trim();
  let negatives = 0;
  let plus = false;
  let prefixCurrency = false;
  let suffixCurrency = false;
  let drCr: "DR" | "CR" | undefined;
  for (let guard = 0; guard < 12; guard++) {
    const before = s;
    if (s.startsWith("(") && s.endsWith(")")) {
      negatives++;
      s = s.slice(1, -1).trim();
    }
    const dc = /(DR|CR)\.?$/i.exec(s);
    if (dc && !drCr && (dc.index === 0 || !/[A-Za-z]/.test(s[dc.index - 1]))) {
      const mark = dc[1].toUpperCase() as "DR" | "CR";
      if (!allowDrCr) return fail("dr_cr_disabled", `"${text}" ends in ${mark}; turn on the DR/CR option for this column to read it as ${mark === "DR" ? "a debit (negative)" : "a credit (positive)"}.`);
      drCr = mark;
      if (mark === "DR") negatives++;
      s = s.slice(0, dc.index).trim();
    }
    const pre = /^(?:[A-Za-z]{3,5}(?![A-Za-z])|[A-Za-z]{1,3}\$|[$€£¥₩₹₱₫฿₽₺₪₦])/.exec(s);
    if (pre && !prefixCurrency && s.length > pre[0].length) {
      prefixCurrency = true;
      s = s.slice(pre[0].length).trim();
    }
    const suf = /(?:(?<![A-Za-z])[A-Za-z]{3,5}|[€£¥₩₹₱₫฿₽₺₪₦$])$/.exec(s);
    if (suf && !suffixCurrency && s.length > suf[0].length) {
      suffixCurrency = true;
      s = s.slice(0, s.length - suf[0].length).trim();
    }
    if (s.startsWith("+")) {
      if (plus) return fail("conflicting_signs", `"${text}" has more than one plus sign.`);
      plus = true;
      s = s.slice(1).trim();
    } else if (s.length > 0 && MINUS.includes(s[0])) {
      negatives++;
      s = s.slice(1).trim();
    }
    if (s.length > 1 && MINUS.includes(s[s.length - 1])) {
      negatives++;
      s = s.slice(0, -1).trim();
    }
    if (s === before) break;
  }
  if (negatives > 1) return fail("conflicting_signs", `"${text}" is marked negative more than once (brackets, a minus sign or DR); write it one way only.`);
  if (negatives === 1 && (plus || drCr === "CR")) return fail("conflicting_signs", `"${text}" is marked both positive and negative.`);
  for (const ch of s) if (SYMBOLS.includes(ch) || /[A-Za-z]/.test(ch)) {
    if (ch === "e" || ch === "E") return fail("exponent", `"${text}" is in scientific notation; format the column as a number with all its digits before exporting.`);
    return fail("not_a_number", `"${text}" is not an amount.`);
  }
  return ok({ body: s, negative: negatives === 1, drCr });
}

const isDigits = (s: string) => /^\d+$/.test(s);
const isGroupChar = (ch: string, decimal: DecimalSeparator) => /\s/.test(ch) || APOSTROPHES.includes(ch) || ch === (decimal === "." ? "," : ".");

/** Integer part with optional grouping: groups of exactly three digits after a first group of one to three. */
function integerDigits(part: string, decimal: DecimalSeparator, text: string): Result<string, AmountErrorCode> {
  if (part === "" || isDigits(part)) return ok(part);
  let sep: string | undefined;
  const groups: string[] = [""];
  for (const ch of part) {
    if (ch >= "0" && ch <= "9") groups[groups.length - 1] += ch;
    else if (isGroupChar(ch, decimal)) {
      const kind = /\s/.test(ch) ? " " : APOSTROPHES.includes(ch) ? "'" : ch;
      if (sep !== undefined && sep !== kind) return fail("bad_grouping", `"${text}" mixes different thousand separators.`);
      sep = kind;
      groups.push("");
    } else {
      return fail("not_a_number", `"${text}" is not an amount.`);
    }
  }
  const [first, ...rest] = groups;
  if (first.length < 1 || first.length > 3 || rest.some((g) => g.length !== 3)) {
    const other = decimal === "." ? "a decimal comma (1.234,56)" : "a decimal point (1,234.56)";
    return fail("bad_grouping", `"${text}" does not have thousand separators every three digits. If this column uses ${other}, change the column's decimal separator.`);
  }
  return ok(groups.join(""));
}

/** Parse one amount to signed minor units. */
export function parseAmount(text: string, options: AmountOptions): AmountResult {
  const { precision } = options;
  const decimal = options.decimalSeparator ?? ".";
  if (!Number.isInteger(precision) || precision < 0 || precision > MAX_PRECISION) return fail("invalid_precision", `Precision must be a whole number from 0 to ${MAX_PRECISION}.`);
  if (typeof text !== "string" || text.trim() === "") return fail("empty", "The amount is empty.");
  if (text.length > MAX_TEXT) return fail("too_long", `The amount is longer than ${MAX_TEXT} characters.`);
  const peeled = peel(text, options.allowDrCr === true);
  if (!peeled.ok) return peeled;
  const { body, negative } = peeled.value;

  const at = body.indexOf(decimal);
  if (at !== -1 && body.indexOf(decimal, at + 1) !== -1) {
    const other = decimal === "." ? "decimal comma" : "decimal point";
    return fail("bad_grouping", `"${text}" has more than one "${decimal}". If "${decimal}" separates thousands in this column, choose ${other}.`);
  }
  const intPart = at === -1 ? body : body.slice(0, at).trim();
  const fracPart = at === -1 ? "" : body.slice(at + 1).trim();
  if (fracPart !== "" && !isDigits(fracPart)) return fail("not_a_number", `"${text}" is not an amount.`);
  const int = integerDigits(intPart, decimal, text);
  if (!int.ok) return int;
  if (int.value === "" && fracPart === "") return fail("not_a_number", `"${text}" has no digits.`);
  let frac = fracPart;
  if (frac.length > precision && options.allowTrailingZeros === true && /^0*$/.test(frac.slice(precision))) frac = frac.slice(0, precision);
  if (frac.length > precision) {
    return fail("too_many_decimals", `"${text}" has ${fracPart.length} decimal place${fracPart.length === 1 ? "" : "s"}; at most ${precision} ${precision === 1 ? "is" : "are"} allowed here. Amounts are never rounded.`);
  }
  const whole = int.value.replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_INTEGER_DIGITS) return fail("too_large", `"${text}" is too large.`);
  const minor = BigInt(whole || "0") * 10n ** BigInt(precision) + BigInt(frac.padEnd(precision, "0") || "0");
  return ok(negative ? -minor : minor);
}

/** Signed minor units back to a plain decimal string ("-1234.50"); for messages and round-trip checks. */
export function formatMinor(minor: bigint, precision: number): string {
  const neg = minor < 0n;
  const digits = (neg ? -minor : minor).toString().padStart(precision + 1, "0");
  const whole = digits.slice(0, digits.length - precision);
  return `${neg ? "-" : ""}${whole}${precision > 0 ? "." + digits.slice(digits.length - precision) : ""}`;
}

export type DecimalStyleDetection =
  /** Every sample that says anything agrees. `evidence` counts the samples that decided it. */
  | { status: "decided"; decimalSeparator: DecimalSeparator; evidence: number }
  /** Nothing decides it (e.g. only "1,234" or "1.500"): ask the person. */
  | { status: "ambiguous"; candidates: readonly [DecimalSeparator, DecimalSeparator]; examples: string[] }
  /** Some samples only make sense with a point and others only with a comma. */
  | { status: "conflict"; pointExamples: string[]; commaExamples: string[] }
  /** No separators at all (whole numbers): either choice reads the same. */
  | { status: "no_separators" };

type Vote = "point" | "comma" | "ambiguous" | "none";

function vote(body: string): Vote {
  const dots = body.split(".").length - 1;
  const commas = body.split(",").length - 1;
  if (dots > 0 && commas > 0) return body.lastIndexOf(".") > body.lastIndexOf(",") ? "point" : "comma";
  const sep = dots > 0 ? "." : commas > 0 ? "," : undefined;
  if (sep === undefined) return "none";
  const count = sep === "." ? dots : commas;
  const asPoint = sep === "." ? "point" : "comma";
  const asGroup = sep === "." ? "comma" : "point";
  if (count > 1) return asGroup; // 1,234,567 or 1.234.567: the repeated mark separates thousands
  const after = body.slice(body.indexOf(sep) + 1).replace(/\s/g, "");
  const before = body.slice(0, body.indexOf(sep));
  if (after.length !== 3) return asPoint; // 12,5 or 1.50: not a thousands group
  if (/[\s'’]/.test(before)) return asPoint; // 1 234,567: another mark already groups thousands
  if (before.replace(/^0+/, "") === "") return asPoint; // 0,125 or ,125
  return "ambiguous"; // 1,234 or 1.234
}

/** Decide a column's decimal separator from all of its sample values. Unparseable samples are ignored. */
export function detectDecimalSeparator(samples: readonly string[]): DecimalStyleDetection {
  const point: string[] = [];
  const comma: string[] = [];
  const ambiguous: string[] = [];
  for (const raw of samples) {
    if (typeof raw !== "string" || raw.trim() === "" || raw.length > MAX_TEXT) continue;
    const peeled = peel(raw, true);
    if (!peeled.ok) continue;
    const v = vote(peeled.value.body);
    if (v === "point") point.push(raw);
    else if (v === "comma") comma.push(raw);
    else if (v === "ambiguous") ambiguous.push(raw);
  }
  if (point.length && comma.length) return { status: "conflict", pointExamples: point.slice(0, 5), commaExamples: comma.slice(0, 5) };
  if (point.length) return { status: "decided", decimalSeparator: ".", evidence: point.length };
  if (comma.length) return { status: "decided", decimalSeparator: ",", evidence: comma.length };
  if (ambiguous.length) return { status: "ambiguous", candidates: [".", ","], examples: ambiguous.slice(0, 5) };
  return { status: "no_separators" };
}
