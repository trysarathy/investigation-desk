"use client";

import { DataTable, type Column } from "@/components/ui";
import type { MerchantPaymentRow } from "@/server/merchant";
import type { PartsSummary } from "@/server/merchant-ui";
import { NEEDS_A_RATE } from "@/lib/clearline/merchant/fiat-value";
import s from "@/components/control/control.module.css";
import { BankChip, ChainChip, DecisionChip, FiatAmount, LedgerChip, ProviderChip, decisionLabel, differenceLabel } from "./ui";

/** One page of payments (server paging and filters), with client sort, filter and column hiding on the rows shown. */
export type PaymentsTableRow = MerchantPaymentRow & { parts: PartsSummary | null };

const DECISION_ORDER: Record<string, number> = { exception: 0, suggested_for_review: 1, matched_with_difference: 2, matched: 3 };
const href = (r: PaymentsTableRow) => `/control/merchant/payments/${encodeURIComponent(r.orderId)}`;

const COLUMNS: Column<PaymentsTableRow>[] = [
  { id: "order", header: "Order", hideable: false, rowHeader: true, sortValue: (r) => r.orderId, filterValue: (r) => `${r.orderId} ${r.txHashes.join(" ")}`,
    // a plain link: opening a payment is a full page load (the payment page renders on the server)
    cell: (r) => <a href={href(r)} className={s.mono}>{r.orderId}</a> },
  { id: "entity", header: "Entity", sortValue: (r) => r.entityId, cell: (r) => <span className={s.mono}>{r.entityId}</span> },
  { id: "invoice", header: "Invoice", numeric: true,
    sortValue: (r) => ("priceToken" in r && r.priceToken ? r.fiatValueMinor ?? null : r.invoiceMinor === null ? null : BigInt(r.invoiceMinor)) as bigint | string | null,
    filterValue: (r) => r.currency,
    cell: (r) => <span data-testid="invoice-amount">{"priceToken" in r && r.priceToken
      // v1 (#173): a token-priced invoice shows its fiat value at a recorded rate, or "needs a rate" (never 0)
      ? (r.fiatValueMinor !== null ? <><FiatAmount minor={r.fiatValueMinor} currency={r.currency} /> <span className={s.muted}>(priced in a token)</span></> : <>{NEEDS_A_RATE} <span className={s.muted}>(priced in a token)</span></>)
      : <FiatAmount minor={r.invoiceMinor} currency={r.currency} />}</span> },
  { id: "explanation", header: "Explanation", sortValue: (r) => DECISION_ORDER[r.decision] ?? 9, filterValue: (r) => decisionLabel(r.decision), cell: (r) => <DecisionChip decision={r.decision} /> },
  { id: "chain", header: "Chain", sortValue: (r) => r.parts?.chain.transfers ?? null, filterValue: (r) => r.networks.join(" "), cell: (r) => <ChainChip p={r.parts ?? undefined} /> },
  { id: "provider", header: "Provider", sortValue: (r) => r.parts?.provider.claims.join(",") ?? null, cell: (r) => <ProviderChip p={r.parts ?? undefined} /> },
  { id: "bank", header: "Bank", sortValue: (r) => r.parts?.bank.status ?? null, filterValue: (r) => `${r.parts?.bank.status ?? ""} ${r.batchIds.join(" ")}`, cell: (r) => <BankChip p={r.parts ?? undefined} /> },
  { id: "ledger", header: "Ledger", sortValue: (r) => r.parts?.ledger.label ?? null, cell: (r) => <LedgerChip p={r.parts ?? undefined} /> },
  { id: "differences", header: "Differences", sortValue: (r) => r.differenceTypes.map(differenceLabel).join(", "),
    cell: (r) => (r.differenceTypes.length ? r.differenceTypes.map(differenceLabel).join(", ") : <span className={s.muted}>None</span>) },
  { id: "age", header: "Age", numeric: true, sortValue: (r) => r.ageDays, cell: (r) => `${r.ageDays} d` },
];

export function PaymentsTable({ rows }: { rows: PaymentsTableRow[] }) {
  return (
    <div role="region" aria-label="Payments table">
      <DataTable rows={rows} columns={COLUMNS} rowKey={(r) => r.orderId} label="Payments" onOpen={(r) => window.location.assign(href(r))} filterLabel="Filter the payments shown"
        virtualizeAbove={Infinity} rowTestId={() => "payment-row"} />
    </div>
  );
}
