"use client";
import Link from "../Link";
import { useWorkspace } from "../workspace";
import { Chip, Empty, PageHead, Panel, fmtTime, ui } from "../ui";

export default function Investigations() {
  const { ws, actorName } = useWorkspace();
  const cases = [...ws.cases].sort((a, b) => (a.status === "resolved" ? 1 : 0) - (b.status === "resolved" ? 1 : 0));
  return (
    <>
      <PageHead eyebrow="Workspace" title="Investigations"
        lede="Cases opened by the engine or by people when a payment needs work. Open a case to see the payment's evidence timeline and explanation." />
      <Panel title={`${cases.length} case${cases.length === 1 ? "" : "s"}`} id="cases">
        {cases.length === 0 ? <Empty>No investigation cases. Cases open when a payment is returned, held, contradicted or otherwise needs a person.</Empty> : (
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Investigation cases">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Case</th><th>Status</th><th>Owner</th><th>Payment / advance</th><th>Open info requests</th><th>Exceptions</th><th>Updated</th></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Case">
                      {c.intentId ? <Link href={`/clearline/payments/${c.intentId}#case`}>{c.title}</Link> : c.title}
                      <span className={ui.sub + " mono"}>{c.id}</span>
                    </td>
                    <td data-label="Status"><Chip tone={c.status === "resolved" ? "ok" : c.status === "reopened" ? "bad" : "warn"}>{c.status === "resolved" ? "Resolved" : c.status === "reopened" ? "Reopened" : "Open"}</Chip></td>
                    <td data-label="Owner">{actorName(c.ownerId)}</td>
                    <td data-label="Payment / advance">
                      {c.intentId && <Link href={`/clearline/payments/${c.intentId}`} className="mono">{c.intentId}</Link>}
                      {c.advanceId && <> <Link href="/clearline/control/funding">{c.advanceId}</Link></>}
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
