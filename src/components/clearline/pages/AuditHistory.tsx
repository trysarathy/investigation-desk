"use client";
import Link from "../Link";
import { useMemo } from "react";
import { useWorkspace } from "../workspace";
import { FilterBar, SearchFilter, SelectFilter, matchesText, useQuery, useSearchText } from "../filters";
import { label } from "../human";
import { Empty, PageHead, Panel, fmtTime, ui } from "../ui";
import { hrefOfRecord, paymentOfRecords, paymentsOf, referencesOf } from "../audit";

/** Plain-English group of an engine audit action ("journal.approved" → "Journal"). */
const GROUPS: Record<string, string> = {
  intent: "Payment", quote: "Quotes", instruction: "Instruction", provider: "Provider events", webhook: "Provider events", statement: "Statement lines",
  allocation: "Matching", exception: "Exceptions", case: "Cases", owner: "Owners", note: "Notes", evidence: "Evidence", hold: "Compliance holds",
  chain: "Chain", advance: "Funding", funding: "Funding", repayment: "Funding", liquidity: "Liquidity", clock: "Clock", workspace: "Workspace",
  journal: "Journal entries", accounting: "Accounting set-up and exports", scenario: "Resets",
};
const groupOf = (action: string) => GROUPS[action.split(".")[0]] ?? label("auditAction", action.split(".")[0]);

/**
 * Founder journey step 17: the complete audit history, workspace-wide or for one payment, filterable by payment,
 * actor, action, record type and text. Every event is the engine's own (`ws.audit`); nothing is hidden or edited.
 */
export default function AuditHistory() {
  const { ws, actors, actorName } = useWorkspace();
  const { get } = useQuery();
  const payment = get("payment"), actor = get("actor"), action = get("action"), entity = get("entity"), group = get("group");
  const [text, setText, commitText, clearText] = useSearchText();
  const owners = useMemo(() => paymentOfRecords(ws), [ws]);
  const events = useMemo(() => [...ws.audit].reverse().map((a) => ({ a, refs: referencesOf(a), payments: paymentsOf(a, owners) })), [ws, owners]);
  const rows = events.filter(({ a, payments }) =>
    (!payment || payments.includes(payment)) && (!actor || a.actorId === actor) && (!action || a.action === action) &&
    (!entity || a.entityType === entity) && (!group || groupOf(a.action) === group) &&
    matchesText(text, a.id, a.action, a.summary, a.entityId, a.entityType, actorName(a.actorId)));
  const distinct = (xs: string[]) => [...new Set(xs)].sort();
  const intent = payment ? ws.intents.find((i) => i.id === payment) : undefined;
  const filters = [
    payment && `payment ${intent?.internalReference ?? payment}`, actor && `actor ${actorName(actor)}`, action && `action ${action}`,
    entity && `record type ${entity}`, group && `area ${group}`, text.trim() && `text “${text.trim()}”`,
  ].filter(Boolean);
  const actorRole = (id: string) => actors.find((x) => x.id === id)?.role;

  return (
    <>
      <PageHead eyebrow="Oversight" title="Audit history"
        lede="Every action recorded by the engine in this workspace: who did it (a simulated person), what, when, and the records it names. The history is append-only; filters only narrow what you see." />
      {intent && <p className={ui.hint} data-testid="audit-payment-scope">Showing the history of payment <Link href={`/clearline/payments/${intent.id}`}>{intent.internalReference}</Link> <span className="mono">({intent.id})</span>: events about the payment and every record linked to it (quotes, instruction, provider events, statement lines, exceptions, case, evidence, journal entries).</p>}
      <FilterBar label="Filter audit history" onClear={clearText} clear={filters.length ? ["payment", "actor", "action", "entity", "group", "q"] : undefined}
        summary={<>Showing <span data-testid="audit-count">{rows.length}</span> of {ws.audit.length} events{filters.length ? <> · filtered by {filters.join(", ")}</> : null}.</>}>
        <SearchFilter label="Search" placeholder="Id, action, summary, person…" value={text} onChange={setText} onCommit={commitText} />
        <SelectFilter param="payment" label="Payment" options={ws.intents.map((i) => ({ value: i.id, label: `${i.internalReference} (${i.id})` }))} />
        <SelectFilter param="actor" label="Actor" options={distinct(ws.audit.map((a) => a.actorId)).map((id) => ({ value: id, label: actorName(id) }))} />
        <SelectFilter param="group" label="Area" options={distinct(ws.audit.map((a) => groupOf(a.action))).map((g) => ({ value: g, label: g }))} />
        <SelectFilter param="action" label="Action" options={distinct(ws.audit.map((a) => a.action)).map((x) => ({ value: x, label: x }))} />
        <SelectFilter param="entity" label="Record type" options={distinct(ws.audit.map((a) => a.entityType)).map((x) => ({ value: x, label: label("auditEntity", x) }))} />
      </FilterBar>
      <Panel title={`Events (${rows.length})`} id="events">
        {rows.length === 0 ? <Empty>No audit events match these filters.</Empty> : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Audit history table">
            <table className={`${ui.table} ${ui.stack}`} data-testid="audit-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Summary</th><th>Evidence references</th></tr></thead>
              <tbody>{rows.map(({ a, refs }) => (
                <tr key={a.id} id={a.id} data-action={a.action}>
                  <td data-label="Time" className={ui.num}>{fmtTime(a.at)}<span className={ui.sub + " mono"}>{a.id}</span></td>
                  <td data-label="Actor" data-testid="audit-actor">{actorName(a.actorId)}{actorRole(a.actorId) && <span className={ui.sub}>Simulated {actorRole(a.actorId)}</span>}</td>
                  <td data-label="Action"><code className={ui.code} data-testid="audit-action">{a.action}</code><span className={ui.sub}>{groupOf(a.action)}</span></td>
                  <td data-label="Record">{label("auditEntity", a.entityType)}<span className={ui.sub + " mono"}>{a.entityId}</span></td>
                  <td data-label="Summary" className={ui.wrapAny}>{a.summary}</td>
                  <td data-label="Evidence references" data-testid="audit-refs">{refs.length === 0 ? "—" : (
                    <ul className={ui.jLinks}>{refs.map((id) => { const href = hrefOfRecord(id, owners); return <li key={id}>{href ? <Link href={href} className="mono">{id}</Link> : <span className="mono">{id}</span>}</li>; })}</ul>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
