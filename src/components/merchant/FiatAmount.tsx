import { Amount } from "@/components/ui";
import { FIAT_DECIMALS } from "@/lib/clearline/merchant/config";

/**
 * A stored fiat amount in minor units, shown exactly (as a decimal string, never through a float) with its currency,
 * grouped like fmtFiat ("SGD 1,234.50"). An unknown currency is shown as its minor units, never guessed.
 */
export function FiatAmount({ minor, currency, block, tone, "data-testid": testId }: { minor: string | bigint | number | null | undefined; currency: string; block?: boolean; tone?: boolean; "data-testid"?: string }) {
  if (minor === null || minor === undefined) return <>—</>;
  const exp = FIAT_DECIMALS[currency as keyof typeof FIAT_DECIMALS];
  const m = typeof minor === "number" ? BigInt(minor) : minor;
  if (exp === undefined) return <Amount value={String(m)} currency={`${currency} (minor units)`} block={block} data-testid={testId} />;
  return <Amount minor={m} exponent={exp} currency={currency} group block={block} tone={tone} data-testid={testId} />;
}
