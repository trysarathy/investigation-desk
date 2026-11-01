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

/** Xero `Organisation.Timezone` (Windows-style, e.g. SINGAPORESTANDARDTIME) → IANA, or undefined if unknown. */
export function windowsToIana(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return Object.prototype.hasOwnProperty.call(WINDOWS_TO_IANA, name) ? WINDOWS_TO_IANA[name] : undefined;
}

/** The calendar date (YYYY-MM-DD) of an instant in an IANA zone. */
export function localDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
