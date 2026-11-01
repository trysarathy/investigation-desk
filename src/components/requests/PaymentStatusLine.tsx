import type { PaymentStatus } from "@/lib/requests/status";

/** The one-sentence status (and ETA, inside the sentence) for a payment. `live`: announce changes (the detail page refreshes itself). */
export function PaymentStatusLine({ s, live }: { s: PaymentStatus; live?: boolean }) {
  return <p className="status-line" data-testid="status-line" data-status={s.key} role={live ? "status" : undefined}>{s.sentence}</p>;
}
