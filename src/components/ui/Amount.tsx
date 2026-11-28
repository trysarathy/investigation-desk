import { formatDecimal, isDecimalString, minorToDecimal } from "./logic";
import u from "./ui.module.css";

export interface AmountProps {
  /** The exact stored decimal string, e.g. "1234.50" or "-0.000001". Shown digit for digit, never rounded. */
  value?: string;
  /** Or minor units with their exponent (converted exactly, as strings): minor="123450" exponent={2} → "1234.50". */
  minor?: string | bigint;
  exponent?: number;
  /** Always shown: "SGD", "USD", "USDT"… */
  currency: string;
  /** Thousands separators (default false, so the digits match the stored string exactly). */
  group?: boolean;
  /** Currency before the number ("SGD 1,234.50") instead of after it (default "before", as fmtFiat). */
  currencyPosition?: "before" | "after";
  /** Colour a negative amount (default false). */
  tone?: boolean;
  /** Render as a block (right-aligned in its cell); default inline-block. */
  block?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** An exact amount: right-aligned, tabular figures, always with its currency. A value that is not a decimal string is shown as given. */
export function Amount({ value, minor, exponent, currency, group = false, currencyPosition = "before", tone = false, block = false, className, ...rest }: AmountProps) {
  const exact = value !== undefined ? value : minor !== undefined ? minorToDecimal(minor, exponent ?? 0) : "";
  const text = isDecimalString(exact) ? formatDecimal(exact, { group }) : exact;
  const cur = <span className={`${u.currency} ${currencyPosition === "before" ? u.currencyBefore : ""}`}>{currency}</span>;
  const cls = [u.amount, block ? u.amountBlock : "", tone && text.startsWith("-") ? u.negative : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls} data-testid={rest["data-testid"]} data-amount={exact} data-currency={currency}>
      {/* a real space, so copied or read-out text is "SGD 324.00" (the CSS gap is visual only) */}
      {currencyPosition === "before" ? <>{cur}{" "}{text}</> : <>{text}{" "}{cur}</>}
    </span>
  );
}
