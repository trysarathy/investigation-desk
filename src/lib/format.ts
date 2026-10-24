// Display helpers shared by server and client components.

export function truncateMiddle(value: string, head = 6, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Fixed clock for fixture mode so ages and verdicts are reproducible. */
export const FIXTURE_NOW = "2026-10-21T15:30:00+08:00";

export function formatAge(fromIso: string, nowIso: string): string {
  const mins = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(fromIso)) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatTime(iso: string): string {
  // Display in Singapore time, the pilot region, with the offset written out.
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} SGT`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return "about a minute";
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `about ${mins} minutes`;
  return `about ${Math.round(mins / 60)} hours`;
}

/** An amount for reading: trailing zeros after the point dropped (593.560000 → 593.56). Exports keep the exact value. */
export function displayAmount(amount: string): string {
  if (!/^-?\d+\.\d+$/.test(amount)) return amount;
  const trimmed = amount.replace(/0+$/, "").replace(/\.$/, "");
  return /^-?0$/.test(trimmed) ? "0" : trimmed;
}

/** A span of minutes for a sentence: "45 min", "23 h 19 min", "1 d 0 h". */
export function formatSpan(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}
