/**
 * Date and datetime parsing per column. The column's format is decided from ALL of its values: one value with a day
 * above 12 decides day/month order; if every value could be either, the answer is "ambiguous" with both candidates —
 * never a guess. Pure: no clock, no time-zone database (offsets are fixed minutes).
 */
import { fail, ok, smallInt, type Result } from "./errors";

/** iso: YYYY-MM-DD (or YYYY/MM/DD) with an optional ISO time and offset. dmy/mdy: 31/12/2026, 31.12.2026, 12-31-2026. */
export type DateFormat = "iso" | "dmy" | "mdy" | "d_mon_y" | "excel_serial";
export const DATE_FORMATS: readonly DateFormat[] = ["iso", "dmy", "mdy", "d_mon_y", "excel_serial"];

export interface DateOptions {
  /** Offset applied to a datetime written without one, in minutes east of UTC (Singapore +480). */
  utcOffsetMinutes: number;
}

export interface ParsedDate {
  /** The value exactly as it was in the file. */
  original: string;
  format: DateFormat;
  /** Calendar date as written (in the file's own offset), YYYY-MM-DD. */
  date: string;
  /** Time of day as written, HH:mm:ss; absent for a date-only value. */
  time?: string;
  /** The UTC instant (ISO 8601, milliseconds, Z); only for values with a time. */
  instant?: string;
  /** Offset used for `instant`, minutes east of UTC. */
  offsetMinutes?: number;
  /** "file": the value carried its own offset. "default": `utcOffsetMinutes` was applied. */
  offsetSource?: "file" | "default";
}

export type DateErrorCode = "empty" | "invalid_date" | "invalid_option";
export type DateResult = Result<ParsedDate, DateErrorCode>;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const DATE_PATTERNS: Readonly<Record<Exclude<DateFormat, "excel_serial">, RegExp>> = {
  iso: /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})/,
  dmy: /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})/,
  mdy: /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})/,
  d_mon_y: /^(\d{1,2})([- /])([A-Za-z]{3,9})\.?\2(\d{4})/,
};
/** After the date: optional T or space, HH:mm[:ss[.fff]], optional Z or ±hh[:mm]. */
const TIME_TAIL = /^(?:(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
const SERIAL = /^(\d{1,7})(?:\.(\d{1,15}))?$/;
/** 9999-12-31 in the 1900 date system. */
const MAX_SERIAL = 2958465;

const pad2 = (n: number) => (n < 10 ? "0" : "") + n;
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const realDate = (y: number, m: number, d: number) => y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

function validOffset(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= -14 * 60 && minutes <= 14 * 60;
}

function parseOffset(text: string): number | undefined {
  if (text.toUpperCase() === "Z") return 0;
  const sign = text[0] === "-" ? -1 : 1;
  const digits = text.slice(1).replace(":", "");
  const h = smallInt(digits.slice(0, 2));
  const m = digits.length > 2 ? smallInt(digits.slice(2)) : 0;
  if (h < 0 || h > 14 || m < 0 || m > 59) return undefined;
  return sign * (h * 60 + m);
}

function build(original: string, format: DateFormat, y: number, mo: number, d: number, tail: string, opts: DateOptions): DateResult {
  if (!realDate(y, mo, d)) return fail("invalid_date", `"${original}" is not a real calendar date.`);
  const date = ymd(y, mo, d);
  const t = TIME_TAIL.exec(tail);
  if (!t) return fail("invalid_date", `"${original}" is not a date in this column's format.`);
  if (t[1] === undefined) {
    if (t[5] !== undefined) return fail("invalid_date", `"${original}" has an offset but no time.`);
    return ok({ original, format, date });
  }
  const h = smallInt(t[1]);
  const mi = smallInt(t[2]);
  const s = t[3] === undefined ? 0 : smallInt(t[3]);
  if (h > 23 || mi > 59 || s > 59) return fail("invalid_date", `"${original}" has an impossible time of day.`);
  // [ASSUMPTION] digits below a millisecond are kept in `original` but not in `instant`.
  const ms = t[4] === undefined ? 0 : smallInt(t[4].slice(0, 3).padEnd(3, "0"));
  const fromFile = t[5] !== undefined;
  const offset = fromFile ? parseOffset(t[5]) : opts.utcOffsetMinutes;
  if (offset === undefined) return fail("invalid_date", `"${original}" has an invalid UTC offset.`);
  const instant = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms) - offset * 60_000).toISOString();
  return ok({ original, format, date, time: `${pad2(h)}:${pad2(mi)}:${pad2(s)}`, instant, offsetMinutes: offset, offsetSource: fromFile ? "file" : "default" });
}

/** Excel's 1900 date system, including its fictional 29 February 1900 (serial 60), which is refused. */
function fromSerial(original: string, opts: DateOptions): DateResult {
  const m = SERIAL.exec(original.trim());
  if (!m) return fail("invalid_date", `"${original}" is not an Excel date number.`);
  const days = smallInt(m[1]);
  if (days < 1 || days > MAX_SERIAL) return fail("invalid_date", `"${original}" is outside Excel's date range.`);
  if (days === 60) return fail("invalid_date", `"${original}" is 29 February 1900, a date Excel invents; it does not exist.`);
  const base = Date.UTC(1899, 11, days > 60 ? 30 : 31);
  const dayStart = new Date(base + days * 86_400_000);
  const frac = m[2] ?? "";
  // Seconds of the day from the decimal digits, rounded half-up to the second, in BigInt (no float multiply).
  const scale = 10n ** BigInt(frac.length);
  let seconds = frac === "" ? 0n : (BigInt(frac) * 86_400n * 2n + scale) / (2n * scale);
  let day = dayStart;
  if (seconds >= 86_400n) { seconds -= 86_400n; day = new Date(dayStart.getTime() + 86_400_000); }
  const y = day.getUTCFullYear();
  const mo = day.getUTCMonth() + 1;
  const d = day.getUTCDate();
  if (frac === "" || /^0+$/.test(frac)) return build(original, "excel_serial", y, mo, d, "", opts);
  const sec = smallInt(seconds.toString());
  const tail = `T${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`;
  return build(original, "excel_serial", y, mo, d, tail, opts);
}

/** Parse one value in a known format. */
export function parseDate(text: string, format: DateFormat, opts: DateOptions): DateResult {
  if (!validOffset(opts.utcOffsetMinutes)) return fail("invalid_option", "utcOffsetMinutes must be a whole number of minutes between -840 and +840.");
  if (typeof text !== "string" || text.trim() === "") return fail("empty", "The date is empty.");
  const original = text;
  const v = text.trim();
  if (format === "excel_serial") return fromSerial(original, opts);
  const m = DATE_PATTERNS[format].exec(v);
  if (!m) return fail("invalid_date", `"${original}" is not a date in this column's format.`);
  const tail = v.slice(m[0].length);
  if (format === "iso") return build(original, format, smallInt(m[1]), smallInt(m[3]), smallInt(m[4]), tail, opts);
  if (format === "d_mon_y") {
    const mo = MONTHS[m[3].toLowerCase()];
    if (mo === undefined) return fail("invalid_date", `"${original}" does not name a month in English.`);
    return build(original, format, smallInt(m[4]), mo, smallInt(m[1]), tail, opts);
  }
  const a = smallInt(m[1]);
  const b = smallInt(m[3]);
  const y = smallInt(m[4]);
  return format === "dmy" ? build(original, format, y, b, a, tail, opts) : build(original, format, y, a, b, tail, opts);
}

export type DateDetection =
  | {
      status: "decided";
      format: DateFormat;
      /** Some values have a time of day. */
      hasTime: boolean;
      /** Which values carry their own UTC offset. */
      offsets: "none" | "some" | "all";
      /** More than one distinct offset appears in the file. */
      mixedOffsets: boolean;
    }
  /** Every value reads as both day/month and month/day: ask the person. */
  | { status: "ambiguous"; candidates: readonly ["dmy", "mdy"]; examples: string[] }
  /** No single format reads every value; `best` reads the most of them, and `failing` lists values it cannot. */
  | { status: "inconsistent"; best?: DateFormat; failing: { index: number; value: string }[] }
  | { status: "empty" };

/** Decide a column's date format from all its values (blank values are ignored). */
export function detectDateFormat(samples: readonly string[]): DateDetection {
  const probe: DateOptions = { utcOffsetMinutes: 0 };
  const values = samples.map((v, index) => ({ v, index })).filter((x) => typeof x.v === "string" && x.v.trim() !== "");
  if (values.length === 0) return { status: "empty" };
  const hits = new Map<DateFormat, number>(DATE_FORMATS.map((f) => [f, 0]));
  let remaining = new Set<DateFormat>(DATE_FORMATS);
  const parsedBy = new Map<DateFormat, ParsedDate[]>(DATE_FORMATS.map((f) => [f, []]));
  for (const { v } of values) {
    const fits = new Set<DateFormat>();
    for (const f of DATE_FORMATS) {
      const r = parseDate(v, f, probe);
      if (r.ok) { fits.add(f); hits.set(f, (hits.get(f) ?? 0) + 1); parsedBy.get(f)!.push(r.value); }
    }
    remaining = new Set([...remaining].filter((f) => fits.has(f)));
  }
  if (remaining.size === 0) {
    let best: DateFormat | undefined;
    for (const f of DATE_FORMATS) if ((hits.get(f) ?? 0) > 0 && (best === undefined || hits.get(f)! > hits.get(best)!)) best = f;
    const failing = values.filter(({ v }) => best === undefined || !parseDate(v, best, probe).ok).slice(0, 10).map(({ v, index }) => ({ index, value: v }));
    return { status: "inconsistent", best, failing };
  }
  if (remaining.has("dmy") && remaining.has("mdy")) return { status: "ambiguous", candidates: ["dmy", "mdy"], examples: values.slice(0, 5).map((x) => x.v) };
  const format = [...remaining][0];
  const parsed = parsedBy.get(format)!;
  const withTime = parsed.filter((p) => p.time !== undefined);
  const fromFile = withTime.filter((p) => p.offsetSource === "file");
  const distinct = new Set(fromFile.map((p) => p.offsetMinutes));
  return {
    status: "decided",
    format,
    hasTime: withTime.length > 0,
    offsets: fromFile.length === 0 ? "none" : fromFile.length === parsed.length ? "all" : "some",
    mixedOffsets: distinct.size > 1,
  };
}

export type DateColumnResult =
  | { status: "parsed"; format: DateFormat; values: (DateResult | null)[] }
  | Exclude<DateDetection, { status: "decided" }>;

/**
 * Parse a whole column: with `format` given, as that format; otherwise detected first, and if detection is not
 * decided the detection result comes back instead of values. Blank cells become null.
 */
export function parseDateColumn(values: readonly string[], opts: DateOptions & { format?: DateFormat }): DateColumnResult {
  let format = opts.format;
  if (format === undefined) {
    const d = detectDateFormat(values);
    if (d.status !== "decided") return d;
    format = d.format;
  }
  const f = format;
  return { status: "parsed", format: f, values: values.map((v) => (typeof v !== "string" || v.trim() === "" ? null : parseDate(v, f, opts))) };
}
