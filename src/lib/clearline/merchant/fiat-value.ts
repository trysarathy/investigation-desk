/**
 * v1 (founder decision, #173): a token-priced invoice's fiat value comes only from a recorded rate (the latest
 * `<symbol>/<currency>` rate at or before the payment's final transfer, no more than 24 hours older; see
 * fiatValueOf in match.ts). Without one, the engine records `ledger.fiatValue.status = "needs_rate"` and keeps its fiat
 * fields at 0n internally, because they are not known. Every surface (payment page, lists, reports, evidence pack,
 * exports, month-end) reads them through these helpers and says "needs a rate" instead of showing or emitting 0.
 *
 * Pure and client-safe: no server imports.
 */

/** What every surface shows in place of a fiat amount that has no recorded rate. */
export const NEEDS_A_RATE = "needs a rate";
/** The machine value emitted in exports and JSON next to a nulled amount. */
export const NEEDS_RATE_STATUS = "needs_rate" as const;

/** The parts of a ledger (engine or stored JSON) these helpers read. */
export interface FiatLedgerLike { fiatValue?: { status: string } | null; balanceState?: string }

/** True when the ledger is a token-priced invoice's whose fiat value needs a recorded rate. */
export const needsRate = (l: FiatLedgerLike | null | undefined): boolean => l?.fiatValue?.status === NEEDS_RATE_STATUS;

/**
 * Which of a ledger's fiat amounts are unknown. With no rate the invoice's fiat value is unknown; so is the open balance
 * unless the token price was received in full (then nothing is open: a true zero), and the customer overpayment when
 * more token than the price arrived. A fully received token price leaves nothing open and nothing over.
 */
export function unknownFiat(l: FiatLedgerLike | null | undefined): { invoice: boolean; open: boolean; overpaid: boolean } {
  if (!needsRate(l)) return { invoice: false, open: false, overpaid: false };
  const st = l!.balanceState;
  return { invoice: true, open: st !== "fully_credited" && st !== "over_credited", overpaid: st === "over_credited" };
}

/**
 * A difference with no fiat value: one received in another token than the invoice's (never converted, so never valued),
 * or a token-amount difference while the invoice's fiat value needs a rate. Its stored amount (0) is not a value.
 */
export const differenceNeedsRate = (type: string, l: FiatLedgerLike | null | undefined): boolean =>
  type === "price_token_mismatch" || (type === "price_token_amount" && needsRate(l));

/** A display string: the formatted amount, or "needs a rate". */
export const fiatOrNeedsRate = (unknown: boolean, format: () => string): string => (unknown ? NEEDS_A_RATE : format());

/** A wire value (JSON, CSV): the amount as a string, or null when it needs a rate. */
export const minorOrNull = (unknown: boolean, minor: string | bigint | number): string | null => (unknown ? null : String(minor));

/**
 * The wire form of a stored ledger: each unknown fiat amount is null and `fiatValueStatus` says "needs_rate". A ledger
 * with a rate (or a fiat-priced invoice's) is returned with `fiatValueStatus` "rated" or absent, amounts unchanged.
 */
export function ledgerWire<L extends FiatLedgerLike & { invoice: { amountMinor: unknown }; openBalanceMinor: unknown; customerOverpaymentMinor: unknown }>(l: L) {
  const u = unknownFiat(l);
  if (!u.invoice) return { ...l, ...(l.fiatValue ? { fiatValueStatus: l.fiatValue.status } : {}) };
  return {
    ...l, fiatValueStatus: NEEDS_RATE_STATUS,
    invoice: { ...l.invoice, amountMinor: null },
    openBalanceMinor: u.open ? null : l.openBalanceMinor,
    customerOverpaymentMinor: u.overpaid ? null : l.customerOverpaymentMinor,
  };
}
