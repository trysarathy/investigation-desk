"use client";

import { useEffect, type KeyboardEvent } from "react";
import { DataTable, StatusBadge, isTypingTarget, type Column } from "@/components/ui";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";

/**
 * The open-exceptions queue: a dense table over the rows the server sent, with client sort and filter. Keyboard:
 * j / k move, Enter opens, "a" opens the selected exception at its Owner control, "e" opens it at "Attach
 * evidence". There is no approve shortcut: approving always takes a click and a confirmation.
 */
export interface QueueRow {
  id: string; orderId: string | null; ownerRole: string; ownerName: string | null; age: string; openedAt: string; reason: string; nextStep: string;
  evidenceCount: number; noteCount: number; status: string; pendingResolutionVersion: number | null;
}

export const exceptionHref = (id: string, part?: "assign" | "evidence") => `/control/merchant/exceptions/${encodeURIComponent(id)}${part ? `#${part}` : ""}`;
const open = (id: string, part?: "assign" | "evidence") => window.location.assign(exceptionHref(id, part));

const COLUMNS: Column<QueueRow>[] = [
  { id: "exception", header: "Exception", hideable: false, rowHeader: true, sortValue: (r) => r.id, filterValue: (r) => `${r.id} ${r.orderId ?? ""}`,
    cell: (r) => <><a href={exceptionHref(r.id)} data-exception-id={r.id} className={s.mono}>{r.id}</a>{r.orderId ? <><br /><span className={s.small}>Payment <a href={`/control/merchant/payments/${encodeURIComponent(r.orderId)}`} className={s.mono}>{r.orderId}</a></span></> : null}</> },
  { id: "owner", header: "Owner", sortValue: (r) => `${r.ownerRole} ${r.ownerName ?? ""}`, cell: (r) => <>{r.ownerRole}<br /><span className={s.small}>{r.ownerName ?? "Unassigned"}</span></> },
  // oldest first when sorted descending by age: the opening instant sorts ascending
  { id: "age", header: "Age", sortValue: (r) => r.openedAt, cell: (r) => <span title={r.openedAt} className="tabular-nums">{r.age}</span> },
  { id: "reason", header: "Reason", sortValue: (r) => r.reason, className: m.wrapCell, cell: (r) => r.reason },
  { id: "next", header: "Next step", sortValue: (r) => r.nextStep, className: m.wrapCell, cell: (r) => r.nextStep },
  { id: "evidence", header: "Evidence", numeric: true, sortValue: (r) => r.evidenceCount,
    cell: (r) => <>{r.evidenceCount ? `${r.evidenceCount} attached` : <span className={s.muted}>None</span>}{r.noteCount ? <><br /><span className={s.small}>{r.noteCount} note{r.noteCount === 1 ? "" : "s"}</span></> : null}</> },
  { id: "status", header: "Status", sortValue: (r) => (r.pendingResolutionVersion ? 2 : r.status === "in_review" ? 1 : 0),
    filterValue: (r) => (r.pendingResolutionVersion ? "awaiting approval" : r.status === "in_review" ? "In review" : "Open"),
    cell: (r) => (r.pendingResolutionVersion
      ? <StatusBadge kind="needs_review" label={`Resolution v${r.pendingResolutionVersion} awaiting approval`} wrap />
      : <StatusBadge kind="exception" label={r.status === "in_review" ? "In review" : "Open"} />) },
];

export function ExceptionsQueue({ rows }: { rows: QueueRow[] }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target as HTMLElement)) return;
    if (e.key !== "a" && e.key !== "e") return;
    const tr = (e.target as HTMLElement).closest("tr");
    const id = tr?.querySelector<HTMLElement>("[data-exception-id]")?.dataset.exceptionId;
    if (!id) return;
    e.preventDefault();
    open(id, e.key === "a" ? "assign" : "evidence");
  };
  return (
    <div role="region" aria-label="Open exceptions table" onKeyDown={onKeyDown} aria-describedby="queue-keys">
      <p id="queue-keys" className={s.small}>Keys: <kbd>j</kbd> / <kbd>k</kbd> move, <kbd>Enter</kbd> opens, <kbd>a</kbd> assigns, <kbd>e</kbd> adds evidence.</p>
      <DataTable rows={rows} columns={COLUMNS} rowKey={(r) => r.id} label="Open exceptions" onOpen={(r) => open(r.id)} filterLabel="Filter open exceptions"
        virtualizeAbove={Infinity} rowTestId={() => "exception-row"} />
    </div>
  );
}

/**
 * On an exception page: "a" moves to the Owner control, "e" to the evidence form; arriving with #assign or #evidence
 * (from the queue's keys) does the same. Ignored while typing.
 */
function focusPart(part: string) {
  const el = part === "assign" ? document.querySelector<HTMLElement>("#assign select") : part === "evidence" ? document.querySelector<HTMLElement>("#evidence textarea") : null;
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
  return true;
}
export function ExceptionKeys() {
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === "assign" || h === "evidence") requestAnimationFrame(() => focusPart(h));
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingTarget(e.target as HTMLElement)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === "a" && focusPart("assign")) e.preventDefault();
      else if (e.key === "e" && focusPart("evidence")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

export interface ReviewRow { orderId: string; owner: string; reason: string; nextStep: string }
const REVIEW_COLUMNS: Column<ReviewRow>[] = [
  { id: "payment", header: "Payment", hideable: false, rowHeader: true, sortValue: (r) => r.orderId, cell: (r) => <a href={`/control/merchant/payments/${encodeURIComponent(r.orderId)}`} className={s.mono}>{r.orderId}</a> },
  { id: "owner", header: "Owner", sortValue: (r) => r.owner, cell: (r) => r.owner },
  { id: "reason", header: "Reason", sortValue: (r) => r.reason, className: m.wrapCell, cell: (r) => r.reason },
  { id: "next", header: "Next step", sortValue: (r) => r.nextStep, className: m.wrapCell, cell: (r) => r.nextStep },
];

/** Payments the engine suggested for a person's review (not exceptions): the same dense table. */
export function ReviewQueue({ rows }: { rows: ReviewRow[] }) {
  return (
    <div role="region" aria-label="Suggested for review table">
      <DataTable rows={rows} columns={REVIEW_COLUMNS} rowKey={(r) => r.orderId} label="Suggested for review" filterLabel="Filter payments to review"
        onOpen={(r) => window.location.assign(`/control/merchant/payments/${encodeURIComponent(r.orderId)}`)} virtualizeAbove={Infinity} />
    </div>
  );
}
