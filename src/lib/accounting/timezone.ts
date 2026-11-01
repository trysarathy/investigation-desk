// The accounting organisation's timezone (posting rule R2, ADR 0002). Posting dates are calendar dates
// in the organisation's own zone. Nothing here guesses: an unknown zone is `undefined`, never UTC.

import { WINDOWS_TO_IANA } from "./windows-zones";

const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/** True for a zone name this runtime's Intl knows (e.g. "Asia/Singapore"). Offsets like "+08:00" are refused. */
export function isIanaZone(zone: string | undefined): zone is string {
  if (!zone || !IANA_SHAPE.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A Windows-style zone name → IANA, or undefined if unknown. Accepts Xero's form (SINGAPORESTANDARDTIME)
 * and Windows' own ("Singapore Standard Time"): both normalise to the table's keys.
 */
export function windowsToIana(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const key = name.replace(/[\s.-]/g, "").toUpperCase();
  return Object.prototype.hasOwnProperty.call(WINDOWS_TO_IANA, key) ? WINDOWS_TO_IANA[key] : undefined;
}

/**
 * A zone as an accounting system may write it: a full Area/City IANA name, or a Windows name. Unknown →
 * undefined. Legacy abbreviations that Node still accepts are refused: "EST" is a fixed UTC−5 with no
 * daylight saving (America/Panama), so a New York company would post summer receipts on the wrong day.
 */
export function anyZoneToIana(name: string | undefined): string | undefined {
  const areaCity = !!name && /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z0-9_+\-/]+$/.test(name);
  return areaCity && isIanaZone(name) ? name : windowsToIana(name);
}

/** The calendar date (YYYY-MM-DD) of an instant in an IANA zone. */
export function localDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
