"use client";
import Link from "../Link";
import { useWorkspace } from "../workspace";
import { label } from "../human";
import { OwnerControl } from "../OwnerControl";
import { FilterBar, SearchFilter, SelectFilter, matchesText, useQuery, useSearchText } from "../filters";
import { Chip, Empty, PageHead, Panel, fmtTime, ui } from "../ui";

const STATUSES = ["open", "reopened", "resolved"] as const;

export default function Investigations() {
  const { ws, actorName, actors } = useWorkspace();
  const { get } = useQuery();
  const status = get("status");
  const owner = get("owner");
  const currency = get("currency");
  const [text, setText, commitText, clearText] = useSearchText();
  const currencyOf = (intentId?: string) => ws.intents.find((i) => i.id === intentId)?.sourceCurrency;
  const all = [...ws.cases].sort((a, b) => (a.status === "resolved" ? 1 : 0) - (b.status === "resolved" ? 1 : 0));
  const cases = all.filter((c) =>
    (!status || c.status === status) &&
    (!owner || (owner === "unassigned" ? !c.ownerId : c.ownerId === owner)) &&
    (!currency || currencyOf(c.intentId) === currency) &&
    matchesText(text, c.id, c.title, c.intentId, c.advanceId, actorName(c.ownerId)));
  const currencies = [...new Set(all.map((c) => currencyOf(c.intentId)).filter(Boolean) as string[])].sort();
  const active = [
    status && `status “${label("caseStatus", status)}”`,
    owner && `owner ${owner === "unassigned" ? "Unassigned" : actorName(owner)}`,
    currency && `currency ${currency}`,
    text.trim() && `text “${text.trim()}”`,
  ].filter(Boolean);
  return (
    <>
      <PageHead eyebrow="Investigations" title="Investigation cases"
        lede="Cases opened by the engine or by people when a payment needs work. Open a case to see the payment's evidence timeline and explanation." />
      <FilterBar label="Filter cases" onClear={clearText} clear={active.length ? ["status", "owner", "currency", "q"] : undefined}
        summary={<>Showing {cases.length} of {all.length} cases{active.length ? <> · filtered by {active.join(", ")}</> : null}.</>}>
        <SearchFilter label="Search" placeholder="Case, payment, title, owner…" value={text} onChange={setText} onCommit={commitText} />
        <SelectFilter param="status" label="Status" options={STATUSES.map((v) => ({ value: v, label: label("caseStatus", v) }))} />
        <SelectFilter param="owner" label="Owner" options={[{ value: "unassigned", label: "Unassigned" }, ...actors.map((a) => ({ value: a.id, label: a.name }))]} />
        <SelectFilter param="currency" label="Currency" options={currencies.map((c) => ({ value: c, label: c }))} />
      </FilterBar>
      <Panel title={`${cases.length} case${cases.length === 1 ? "" : "s"}`} id="cases">
        {cases.length === 0 ? <Empty>{all.length === 0 ? "No investigation cases. Cases open when a payment is returned, held, contradicted or otherwise needs a person." : "No cases match these filters. Clear the filters to see the others."}</Empty> : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Investigation cases table">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Case</th><th>Status</th><th>Owner</th><th>Payment / advance</th><th>Open info requests</th><th>Exceptions</th><th>Updated</th></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} data-case={c.id}>
                    <td data-label="Case">
                      {c.intentId ? <Link href={`/clearline/payments/${c.intentId}#case`}>{c.title}</Link> : c.title}
                      <span className={ui.sub + " mono"}>{c.id}</span>
                    </td>
                    <td data-label="Status"><Chip tone={c.status === "resolved" ? "neutral" : c.status === "reopened" ? "bad" : "warn"} title={`API value: ${c.status}`}>{label("caseStatus", c.status)}</Chip></td>
                    <td data-label="Owner"><OwnerControl target={{ kind: "case", id: c.id }} ownerId={c.ownerId} /></td>
                    <td data-label="Payment / advance">
                      {c.intentId && <Link href={`/clearline/payments/${c.intentId}`} className="mono">{c.intentId}</Link>}
                      {c.intentId && currencyOf(c.intentId) && <span className={ui.sub}>{currencyOf(c.intentId)}</span>}
                      {c.advanceId && <> <Link href="/clearline/treasury/funding">{c.advanceId}</Link></>}
                    </td>
                    <td data-label="Open info requests" className={ui.num}>{c.requestedInfo.filter((r) => r.status === "open").length}</td>
                    <td data-label="Exceptions" className={ui.num}>{c.exceptionIds.length > 0 && c.intentId ? <Link href={`/clearline/exceptions?view=all&intent=${c.intentId}`}>{c.exceptionIds.length}</Link> : c.exceptionIds.length}</td>
                    <td data-label="Updated" className={ui.num}>{fmtTime(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
