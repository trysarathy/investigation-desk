/** Pure calendar helpers for the synthetic generator. No clock is ever read: every instant is derived from inputs. */

export const DAY_MS = 86_400_000;
export const MIN_MS = 60_000;

export const iso = (ms: number): string => new Date(ms).toISOString();
export const ms = (isoText: string): number => {
  const v = Date.parse(isoText);
  if (!Number.isFinite(v)) throw new RangeError(`Not an ISO instant: ${isoText}`);
  return v;
};

/** "2026-11" → { year, month (1-12), startMs (UTC midnight of day 1), days } */
export function parseMonth(month: string): { year: number; month: number; startMs: number; days: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new RangeError(`month must be YYYY-MM, got ${JSON.stringify(month)}`);
  const year = Number(m[1]), mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new RangeError(`month out of range: ${month}`);
  const startMs = Date.UTC(year, mon - 1, 1);
  const days = Math.round((Date.UTC(year, mon, 1) - startMs) / DAY_MS);
  return { year, month: mon, startMs, days };
}

/** Calendar date (YYYY-MM-DD) of an instant at a fixed UTC offset. */
export const dateAt = (instantMs: number, offsetMinutes: number): string => iso(instantMs + offsetMinutes * MIN_MS).slice(0, 10);

export const addDays = (date: string, n: number): string => iso(Date.parse(`${date}T00:00:00.000Z`) + n * DAY_MS).slice(0, 10);

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: string): number => new Date(`${date}T00:00:00.000Z`).getUTCDay();
export const isBusinessDay = (date: string): boolean => weekday(date) !== 0 && weekday(date) !== 6;

/** The first business day strictly after `date` [ASSUMPTION: Saturday and Sunday only; no public holidays]. */
export function nextBusinessDay(date: string): string {
  let d = addDays(date, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

/** Wall-clock parts of an instant at a fixed UTC offset. */
export function partsAt(instantMs: number, offsetMinutes: number) {
  const d = new Date(instantMs + offsetMinutes * MIN_MS);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    yyyy: String(d.getUTCFullYear()), mm: p2(d.getUTCMonth() + 1), dd: p2(d.getUTCDate()),
    HH: p2(d.getUTCHours()), MI: p2(d.getUTCMinutes()), SS: p2(d.getUTCSeconds()),
  };
}

/** "+08:00" style offset; "Z" for zero. */
export function offsetText(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Z";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const a = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** ISO 8601 local time with an explicit offset, e.g. 2026-11-03T10:15:00+08:00. */
export function isoWithOffset(instantMs: number, offsetMinutes: number): string {
  const p = partsAt(instantMs, offsetMinutes);
  return `${p.yyyy}-${p.mm}-${p.dd}T${p.HH}:${p.MI}:${p.SS}${offsetText(offsetMinutes)}`;
}
