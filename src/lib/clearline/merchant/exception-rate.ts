/**
 * v1 phase 0: "exceptions per 100", defined once. Pure, no I/O. The provider console, the provider's pilot metrics
 * and the merchant's pilot metrics all show this number and nothing else under that name.
 *
 * Exceptions per 100 = still-open exceptions per 100 reconciled payments, a snapshot at the moment it is read:
 *  - Reconciled payment (the denominator): a payment (invoice) that a reconciliation run has evaluated, so it has a
 *    stored decision (one match record per payment; its latest decision counts, once), EXCLUDING unpaid orders:
 *    those whose decision credits nothing yet (ledger credited amount 0, the same test a run uses for its "unpaid"
 *    count). An invoice no run has evaluated is not counted.
 *  - Still-open exception (the numerator): an exception on one of those payments whose status is not 'resolved'
 *    ('open' or 'in_review'), EXCLUDING "batch not tied" (the payment's current rule M5.batch.not_tied), which is
 *    reported separately with its own count and rate over the same denominator.
 *  - Time window: none. Every payment reconciled to date (pilot to date) under its latest decision, and the exceptions
 *    open at the moment of reading. Exceptions a later run or a person closed do not count.
 *  - Not in either rate, reported as plain counts: open exceptions on unpaid orders, and open exceptions on no
 *    reconciled payment (a transfer that names no order).
 *  - A zero denominator is "not measured" (null), never 0.
 * Rounding: one decimal place, half up.
 */

export const BATCH_NOT_TIED_RULE = "M5.batch.not_tied";

export const EXCEPTION_RATE_DEFINITION =
  "Exceptions per 100 = exceptions still open now on reconciled payments, per 100 reconciled payments (every payment a run has evaluated, under its latest decision, excluding unpaid orders: nothing credited yet). " +
  "Pilot to date, no time window. Exceptions closed by a later run or a person do not count. Batch not tied is shown separately over the same payments. " +
  "Open exceptions on unpaid orders, or on no payment (a transfer naming no order), are counted apart and are in neither rate.";

export interface RatePayment { orderId: string; ruleId: string; creditedMinor: string | number | bigint }
export interface RateException { orderId: string | null; status: string }

/** The raw counts behind the rate. The provider's database aggregate returns the same five counts. */
export interface ExceptionRateCounts {
  /** Denominator: payments a run evaluated, excluding unpaid orders. */
  reconciledPayments: number;
  /** Numerator: still-open exceptions on those payments, excluding batch not tied. */
  openExceptions: number;
  /** Still-open batch-not-tied exceptions on those payments. */
  openBatchNotTied: number;
  /** Still-open exceptions on unpaid orders (in neither rate). */
  openOnUnpaid: number;
  /** Still-open exceptions on no reconciled payment (in neither rate). */
  openWithoutPayment: number;
}

export interface ExceptionRate extends ExceptionRateCounts {
  /** Still-open exceptions per 100 reconciled payments; null = not measured (no reconciled payment). */
  per100: number | null;
  /** Still-open batch-not-tied exceptions per 100 reconciled payments; null = not measured. */
  batchNotTiedPer100: number | null;
}

const isOpen = (status: string) => status !== "resolved";
const isUnpaid = (p: RatePayment) => BigInt(p.creditedMinor) === 0n;

/** Counts from rows: each payment's latest decision (one per order) and its organisation's exceptions. */
export function exceptionRateCounts(payments: readonly RatePayment[], exceptions: readonly RateException[]): ExceptionRateCounts {
  const byOrder = new Map(payments.map((p) => [p.orderId, p]));
  const c: ExceptionRateCounts = { reconciledPayments: 0, openExceptions: 0, openBatchNotTied: 0, openOnUnpaid: 0, openWithoutPayment: 0 };
  for (const p of byOrder.values()) if (!isUnpaid(p)) c.reconciledPayments++;
  for (const e of exceptions) {
    if (!isOpen(e.status)) continue;
    const p = e.orderId === null ? undefined : byOrder.get(e.orderId);
    if (!p) c.openWithoutPayment++;
    else if (isUnpaid(p)) c.openOnUnpaid++;
    else if (p.ruleId === BATCH_NOT_TIED_RULE) c.openBatchNotTied++;
    else c.openExceptions++;
  }
  return c;
}

/** n per 100 of d, one decimal half up; null when d is 0 (not measured). */
export function per100(n: number, d: number): number | null {
  if (!Number.isInteger(n) || !Number.isInteger(d) || n < 0 || d < 0) throw new RangeError("per100 takes non-negative whole counts");
  return d === 0 ? null : Math.round((n * 1000) / d) / 10;
}

/** The rate (and batch-not-tied rate) from counts. */
export function exceptionRate(c: ExceptionRateCounts): ExceptionRate {
  return { ...c, per100: per100(c.openExceptions, c.reconciledPayments), batchNotTiedPer100: per100(c.openBatchNotTied, c.reconciledPayments) };
}

/** Counts added across merchants (the provider's total). The rate is recomputed, never averaged. */
export function addExceptionRateCounts(xs: readonly ExceptionRateCounts[]): ExceptionRateCounts {
  const z: ExceptionRateCounts = { reconciledPayments: 0, openExceptions: 0, openBatchNotTied: 0, openOnUnpaid: 0, openWithoutPayment: 0 };
  for (const x of xs) for (const k of Object.keys(z) as (keyof ExceptionRateCounts)[]) z[k] += x[k];
  return z;
}

/** How a rate reads on a page: "Not measured" when there is nothing to measure. */
export const rateText = (v: number | null) => (v === null ? "Not measured" : String(v));
