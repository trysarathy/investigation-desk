"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { filterRows, isTypingTarget, sortRows, windowRange, type SortDir, type SortValue } from "./logic";
import { IconColumns, IconSort } from "./icons";
import u from "./ui.module.css";

export interface Column<T> {
  /** Stable id (used for sort state and the column menu). */
  id: string;
  /** Header content: keep the page's existing header text, which tests read. */
  header: ReactNode;
  /** Plain-text name for the column menu when `header` is not a string. */
  headerText?: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable (exact for decimal strings and bigints). */
  sortValue?: (row: T) => SortValue;
  /** Text this column contributes to the filter box (default: the sortValue as text). */
  filterValue?: (row: T) => string;
  /** Right-aligned with tabular figures (amounts, counts). */
  numeric?: boolean;
  /** false keeps the column out of the hide menu (default true). */
  hideable?: boolean;
  defaultHidden?: boolean;
  /** Extra class on th and td. */
  className?: string;
  /** Header cell of the row (th scope="row") instead of td. */
  rowHeader?: boolean;
}

export interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  /** The table's caption (visible). Or `label` for an accessible name without a visible caption. */
  caption?: ReactNode;
  label?: string;
  /** Enter on a row (and a click on an empty part of it) opens it: a URL to navigate to, or a callback. */
  rowHref?: (row: T) => string | null | undefined;
  onOpen?: (row: T) => void;
  /** Quick actions shown when a row is hovered or focused (the column has a screen-reader header "Actions"). */
  rowActions?: (row: T) => ReactNode;
  /** Show a filter box over the loaded rows (default true). */
  filterable?: boolean;
  filterLabel?: string;
  initialSort?: { id: string; dir: SortDir };
  /** Window the rows when there are more than this (default 200). Infinity renders every row. */
  virtualizeAbove?: number;
  /** Fixed row height in px for windowing (default 32, the --cl-row-h token). */
  rowHeight?: number;
  /** Scroll height of a windowed table (default 600 px). */
  maxHeight?: number;
  emptyText?: ReactNode;
  className?: string;
  "data-testid"?: string;
  rowTestId?: (row: T) => string | undefined;
}

/**
 * A dense, accessible data table: a real <table> (th scope="col"), sticky header, client-side sort (aria-sort) and
 * filter on the rows already loaded, a column hide menu, hover quick actions, keyboard row navigation (j / k move,
 * Enter opens), and windowing above `virtualizeAbove` rows (fixed row height plus spacer rows) so 10,000 rows scroll.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const { rows, columns, rowKey, caption, label, rowHref, onOpen, rowActions, filterable = true, filterLabel = "Filter rows", initialSort,
    virtualizeAbove = 200, rowHeight = 32, maxHeight = 600, emptyText = "No rows.", className, rowTestId } = props;
  const router = useRouter();
  const id = useId();
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(initialSort ?? null);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)));
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(maxHeight);
  const scroller = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = columns.filter((c) => !hidden.has(c.id));
  const filterText = useCallback((r: T) => columns.map((c) => (c.filterValue ? c.filterValue(r) : c.sortValue ? String(c.sortValue(r) ?? "") : "")).join(" "), [columns]);
  const shown = useMemo(() => {
    const f = filterable && query ? filterRows(rows, filterText, query) : [...rows];
    const col = sort ? columns.find((c) => c.id === sort.id) : undefined;
    return col?.sortValue ? sortRows(f, col.sortValue, sort!.dir) : f;
  }, [rows, query, sort, columns, filterable, filterText]);

  const windowed = shown.length > virtualizeAbove;
  const range = windowed ? windowRange(shown.length, scrollTop, viewport, rowHeight) : { start: 0, end: shown.length, before: 0, after: 0 };

  useEffect(() => {
    if (!windowed || !scroller.current) return;
    const el = scroller.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => setViewport(el.clientHeight)) : null;
    ro?.observe(el);
    setViewport(el.clientHeight);
    return () => ro?.disconnect();
  }, [windowed]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => { setActive((a) => (a >= shown.length ? shown.length - 1 : a)); }, [shown.length]);

  const open = (r: T) => {
    if (onOpen) return onOpen(r);
    const href = rowHref?.(r);
    if (href) router.push(href);
  };

  const focusRow = (i: number) => {
    setActive(i);
    const el = scroller.current;
    if (windowed && el) {
      const top = i * rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
    }
    requestAnimationFrame(() => (document.getElementById(`${id}-r${i}`) as HTMLElement | null)?.focus({ preventScroll: !windowed ? false : true }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target as HTMLElement)) return;
    if (!shown.length) return;
    if (e.key === "j" || e.key === "ArrowDown" && (e.target as HTMLElement).tagName === "TR") { e.preventDefault(); focusRow(Math.min(shown.length - 1, active + 1)); }
    else if (e.key === "k" || e.key === "ArrowUp" && (e.target as HTMLElement).tagName === "TR") { e.preventDefault(); focusRow(Math.max(0, active - 1)); }
    else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "TR" && active >= 0) { e.preventDefault(); open(shown[active]); }
  };

  const toggleSort = (c: Column<T>) => setSort((s) => (s?.id === c.id ? { id: c.id, dir: s.dir === "asc" ? "desc" : "asc" } : { id: c.id, dir: c.numeric ? "desc" : "asc" }));
  const hideable = columns.filter((c) => c.hideable !== false);
  const span = visible.length + (rowActions ? 1 : 0);
  const name = (c: Column<T>) => c.headerText ?? (typeof c.header === "string" ? c.header : c.id);

  return (
    <div className={[u.dt, className ?? ""].filter(Boolean).join(" ")} data-testid={props["data-testid"]} onKeyDown={onKeyDown}>
      {(filterable || hideable.length > 0) ? (
        <div className={u.dtTools}>
          {filterable ? <input className={u.input} type="search" aria-label={filterLabel} placeholder={`${filterLabel}…`} value={query} onChange={(e) => setQuery(e.target.value)} /> : <span />}
          <span className={u.dtCount} aria-live="polite">{query ? `${shown.length} of ${rows.length} rows` : `${rows.length} rows`}</span>
          {hideable.length > 0 ? (
            <div className={u.menuWrap} ref={menuRef}>
              <button type="button" className={u.button} aria-expanded={menuOpen} aria-controls={`${id}-cols`} onClick={() => setMenuOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}><IconColumns /> Columns</button>
              {menuOpen ? (
                <div className={u.menu} id={`${id}-cols`} role="group" aria-label="Show columns" onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}>
                  {hideable.map((c) => (
                    <label key={c.id}>
                      <input type="checkbox" checked={!hidden.has(c.id)} disabled={!hidden.has(c.id) && visible.length === 1}
                        onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                      {name(c)}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={u.scroller} ref={scroller} style={windowed ? { maxHeight, overflowY: "auto" } : undefined} onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}>
        <table className={u.table} aria-label={caption ? undefined : label} aria-rowcount={windowed ? shown.length + 1 : undefined} data-windowed={windowed ? "true" : undefined}>
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {visible.map((c) => {
                const dir = sort?.id === c.id ? sort.dir : null;
                return (
                  <th key={c.id} scope="col" className={[c.numeric ? u.right : "", c.className ?? ""].filter(Boolean).join(" ")} aria-sort={c.sortValue ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}>
                    {c.sortValue ? <button type="button" className={u.sortButton} onClick={() => toggleSort(c)}>{c.header}<span className={u.sortIcon}><IconSort dir={dir ?? "none"} /></span></button> : c.header}
                  </th>
                );
              })}
              {rowActions ? <th scope="col" className={u.actionsCell}><span className={u.srOnly}>Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <tr><td colSpan={span} className={u.empty}>{emptyText}</td></tr> : null}
            {range.before > 0 ? <tr className={u.spacer} aria-hidden="true"><td colSpan={span} style={{ height: range.before }} /></tr> : null}
            {shown.slice(range.start, range.end).map((r, k) => {
              const i = range.start + k;
              return (
                <tr key={rowKey(r)} id={`${id}-r${i}`} tabIndex={active === i || (active < 0 && i === 0) ? 0 : -1} className={[u.row, active === i ? u.rowActive : ""].filter(Boolean).join(" ")}
                  style={windowed ? { height: rowHeight } : undefined} aria-rowindex={windowed ? i + 2 : undefined} data-testid={rowTestId?.(r)}
                  onFocus={(e) => { if (e.target === e.currentTarget) setActive(i); }}
                  onClick={(e) => { if ((rowHref || onOpen) && e.target === e.currentTarget) open(r); }}>
                  {visible.map((c) => {
                    const cls = [c.numeric ? u.right : "", c.className ?? ""].filter(Boolean).join(" ") || undefined;
                    return c.rowHeader ? <th key={c.id} scope="row" className={cls}>{c.cell(r)}</th> : <td key={c.id} className={cls}>{c.cell(r)}</td>;
                  })}
                  {rowActions ? <td className={u.actionsCell}><span className={u.actions}>{rowActions(r)}</span></td> : null}
                </tr>
              );
            })}
            {range.after > 0 ? <tr className={u.spacer} aria-hidden="true"><td colSpan={span} style={{ height: range.after }} /></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
