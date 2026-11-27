"use client";

import { DataTable, EvidenceBadge, StatusBadge, type Column, type EvidenceLevel } from "@/components/ui";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";
import { FiatAmount } from "./ui";

/** Dense tables for the daily report and the batches list: the rows the server sent, sorted and filtered here. */

const go = (href: string) => window.location.assign(href);

// ------------------------------------------------------------------------------------------ settlement batches

export interface BatchRow {
  batchId: string; entityId: string | null; providerDay: string; currency: string; grossMinor: string; feesMinor: string; refundsMinor: string; netMinor: string;
  tied: boolean; settled: boolean; bankEvidence: EvidenceLevel; bankEvidenceLabel: string; bankLineId: string | null;
}
const batchHref = (b: BatchRow) => `/control/merchant/batches/${encodeURIComponent(b.batchId)}`;
const money = (k: "grossMinor" | "feesMinor" | "refundsMinor" | "netMinor", header: string): Column<BatchRow> => ({
  id: k, header, numeric: true, sortValue: (b) => BigInt(b[k]), filterValue: () => "", cell: (b) => <FiatAmount minor={b[k]} currency={b.currency} />,
});
const BATCH_COLUMNS: Column<BatchRow>[] = [
  { id: "batch", header: "Batch", hideable: false, rowHeader: true, sortValue: (b) => b.batchId, cell: (b) => <a href={batchHref(b)} className={s.mono}>{b.batchId}</a> },
  { id: "entity", header: "Entity", sortValue: (b) => b.entityId ?? "", cell: (b) => <span className={s.mono}>{b.entityId}</span> },
  { id: "day", header: "Provider day", sortValue: (b) => b.providerDay, cell: (b) => <span className="tabular-nums">{b.providerDay}</span> },
  money("grossMinor", "Gross"), money("feesMinor", "Fees"), money("refundsMinor", "Refunds"), money("netMinor", "Net"),
  { id: "bank", header: "Bank", sortValue: (b) => (b.settled ? 2 : b.tied ? 1 : 0), filterValue: (b) => `${b.tied ? "Tied to the cent" : "Not tied"} ${b.settled ? "Settled" : "Not settled"} ${b.bankLineId ?? ""}`,
    cell: (b) => <span className={m.badges}>
      {b.tied ? <StatusBadge kind="matched" label="Tied to the cent" /> : <StatusBadge kind="exception" label="Not tied" />}
      {b.settled ? <StatusBadge kind="approved" label="Settled" /> : <StatusBadge kind="awaiting_evidence" label="Not settled" />}
      <EvidenceBadge level={b.bankEvidence} label={b.bankEvidenceLabel} />
      {b.bankLineId ? <span className={`${s.small} ${s.mono}`}>{b.bankLineId}</span> : null}
    </span> },
];

export function BatchesTable({ rows }: { rows: BatchRow[] }) {
  return (
    <div role="region" aria-label="Settlement batches table">
      <DataTable rows={rows} columns={BATCH_COLUMNS} rowKey={(b) => b.batchId} label="Settlement batches" filterLabel="Filter batches" onOpen={(b) => go(batchHref(b))} virtualizeAbove={Infinity} rowTestId={() => "batch-row"} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ daily report

export interface EntityDayRow { id: string; name: string; href: string; payments: number; tied: number; settlements: number; settled: number; exceptions: number; writeoffs: number; timezone: string }
const ENTITY_COLUMNS: Column<EntityDayRow>[] = [
  { id: "entity", header: "Entity", hideable: false, rowHeader: true, sortValue: (r) => r.name, filterValue: (r) => `${r.name} ${r.id}`, cell: (r) => <><a href={r.href}>{r.name}</a> <span className={s.mono}>{r.id}</span></> },
  { id: "payments", header: "Payments", numeric: true, sortValue: (r) => r.payments, cell: (r) => r.payments },
  { id: "tied", header: "Settlements tied", numeric: true, sortValue: (r) => r.tied, cell: (r) => <>{r.tied} of {r.settlements}<br /><span className={s.small}>{r.settled} settled</span></> },
  { id: "exceptions", header: "Exceptions", numeric: true, sortValue: (r) => r.exceptions, cell: (r) => r.exceptions },
  { id: "writeoffs", header: "Write-offs awaiting approval", numeric: true, sortValue: (r) => r.writeoffs, cell: (r) => r.writeoffs },
  { id: "tz", header: "Merchant day", sortValue: (r) => r.timezone, cell: (r) => r.timezone },
];
export function EntityDayTable({ rows }: { rows: EntityDayRow[] }) {
  return (
    <div role="region" aria-label="Per entity table">
      <DataTable rows={rows} columns={ENTITY_COLUMNS} rowKey={(r) => r.id} label="Per entity" filterable={rows.length > 5} onOpen={(r) => go(r.href)} virtualizeAbove={Infinity} />
    </div>
  );
}

export interface DateRow { date: string; label: string; href: string; current: boolean; summary: string }
const DATE_COLUMNS: Column<DateRow>[] = [
  { id: "date", header: "Date", hideable: false, rowHeader: true, sortValue: (r) => r.date, cell: (r) => <a href={r.href} aria-current={r.current ? "true" : undefined} className="tabular-nums">{r.label}</a> },
  { id: "summary", header: "Summary", sortValue: (r) => r.summary, className: m.wrapCell, cell: (r) => r.summary },
];
export function DateTable({ rows }: { rows: DateRow[] }) {
  return (
    <div role="region" aria-label="Per date table">
      <DataTable rows={rows} columns={DATE_COLUMNS} rowKey={(r) => r.date} label="Per date" filterLabel="Filter dates" onOpen={(r) => go(r.href)} virtualizeAbove={Infinity} />
    </div>
  );
}
