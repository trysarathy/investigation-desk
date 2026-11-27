// v1 phase 2.3: Clearline's own ceiling on calls to a ledger, per connected organisation, kept below each ledger's
// published limits so Clearline is refused by itself before the ledger refuses it [ASSUMPTION: limits from the ledgers'
// developer documentation: Xero 60 calls a minute and 5,000 a day per organisation; QuickBooks Online 500 a minute per
// company]. A 429 from the ledger blocks the connection until its Retry-After has passed.
//
// In-process: one server process holds the counts. Several processes would each allow the ceiling [ASSUMPTION: the pilot
// runs one web process; a shared limiter belongs with the job queue if that changes].

import type { LedgerProvider } from "./providers";

export const LEDGER_LIMITS: Record<LedgerProvider, { perMinute: number; perDay: number }> = {
  xero: { perMinute: 50, perDay: 4500 },
  qbo: { perMinute: 400, perDay: 100_000 },
};

export class RateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) { super(`Clearline is pausing calls to this ledger to stay inside its rate limit; try again in ${retryAfterSeconds} s.`); }
}

export class LedgerRateLimiter {
  private readonly calls = new Map<string, number[]>();
  private readonly blockedUntil = new Map<string, number>();
  constructor(private readonly limits = LEDGER_LIMITS, private readonly clock: () => number = Date.now) {}

  /** Take one call for this connection, or throw RateLimited (nothing is taken then). */
  take(provider: LedgerProvider, connectionKey: string): void {
    const now = this.clock(), key = `${provider}:${connectionKey}`;
    const until = this.blockedUntil.get(key) ?? 0;
    if (until > now) throw new RateLimited(Math.ceil((until - now) / 1000));
    const day = (this.calls.get(key) ?? []).filter((t) => t > now - 86_400_000);
    const minute = day.filter((t) => t > now - 60_000);
    const lim = this.limits[provider];
    if (minute.length >= lim.perMinute) throw new RateLimited(Math.max(1, Math.ceil((minute[0] + 60_000 - now) / 1000)));
    if (day.length >= lim.perDay) throw new RateLimited(Math.max(1, Math.ceil((day[0] + 86_400_000 - now) / 1000)));
    day.push(now);
    this.calls.set(key, day);
  }

  /** The ledger said 429: no call for this connection until Retry-After (at least 1 s, at most a day) has passed. */
  backOff(provider: LedgerProvider, connectionKey: string, retryAfterSeconds: number | undefined): void {
    const s = Math.min(86_400, Math.max(1, Math.ceil(retryAfterSeconds ?? 60)));
    this.blockedUntil.set(`${provider}:${connectionKey}`, this.clock() + s * 1000);
  }
}

/** Retry-After as seconds (a number of seconds, or an HTTP date); undefined when absent or unreadable. */
export function retryAfterSeconds(v: string | null | undefined, now = Date.now()): number | undefined {
  if (!v) return undefined;
  if (/^\d{1,6}$/.test(v.trim())) return Number(v.trim());
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : undefined;
}
