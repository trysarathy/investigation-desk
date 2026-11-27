"use client";

import type { ReactNode } from "react";
import { DataTable, type Column, type SortValue } from "@/components/ui";

/**
 * A <DataTable> fed from a server component: the cells are rendered on the server (links, badges, exact amounts)
 * and passed as React nodes, with plain sort and filter values beside them. The client adds sort, filter, column hide,
 * the sticky header and keyboard row navigation over the rows already loaded; nothing is fetched again.
 */
export interface StaticColumn {
  id: string;
  header: string;
  numeric?: boolean;
  /** Sortable when the rows carry a sort value for this column. */
  sortable?: boolean;
  hideable?: boolean;
  defaultHidden?: boolean;
  rowHeader?: boolean;
  className?: string;
}

export interface StaticRow {
  key: string;
  testId?: string;
  cells: Record<string, ReactNode>;
  /** Exact sort values (decimal strings sort exactly), also the filter text when no `filter` is given. */
  sort?: Record<string, string | number | null>;
  /** Extra filter text for the row. */
  filter?: string;
}

export function StaticTable({ columns, rows, label, caption, filterable, filterLabel, emptyText, initialSort, testId }: {
  columns: StaticColumn[]; rows: StaticRow[]; label?: string; caption?: ReactNode; filterable?: boolean; filterLabel?: string; emptyText?: ReactNode;
  initialSort?: { id: string; dir: "asc" | "desc" }; testId?: string;
}) {
  const cols: Column<StaticRow>[] = columns.map((c) => ({
    id: c.id,
    header: c.header,
    numeric: c.numeric,
    hideable: c.hideable,
    defaultHidden: c.defaultHidden,
    rowHeader: c.rowHeader,
    className: c.className,
    cell: (r) => r.cells[c.id] ?? null,
    sortValue: c.sortable ? (r): SortValue => r.sort?.[c.id] ?? null : undefined,
    filterValue: (r) => `${r.sort?.[c.id] ?? ""}${c.id === columns[0].id && r.filter ? ` ${r.filter}` : ""}`,
  }));
  return (
    <DataTable rows={rows} columns={cols} rowKey={(r) => r.key} rowTestId={(r) => r.testId} label={label} caption={caption}
      filterable={filterable} filterLabel={filterLabel} emptyText={emptyText} initialSort={initialSort} data-testid={testId} virtualizeAbove={Infinity} />
  );
}
