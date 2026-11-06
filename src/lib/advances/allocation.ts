import { sub } from "../payments/money";
/** Allocate at most the outstanding principal; the remainder stays unapplied. */
export function allocateCapped(receipt: string, outstanding: string) {
  if (![receipt, outstanding].every((v) => /^\d+(\.\d{1,2})?$/.test(v)))
    throw Error(
      "Allocation requires nonnegative amounts with at most two decimals.",
    );
  const applied = sub(receipt, outstanding).startsWith("-")
    ? receipt
    : outstanding;
  return { applied, excess: sub(receipt, applied) };
}
