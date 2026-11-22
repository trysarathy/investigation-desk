import type { Metadata } from "next";
import { workQueue } from "@/server/control";
import { pageContext } from "@/server/control-page";
import s from "@/components/control/control.module.css";
import { caseStatusLabel, PageTitle, priorityLabel, TableRegion, Tag, when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Investigations" };

export default async function InvestigationsPage() {
  const ctx = await pageContext();
  const { cases, exceptions } = await workQueue(ctx);
  return (
    <>
      <PageTitle title="Investigations" lede="Every investigation in this organisation, open ones first." />
      <TableRegion label="Investigations">
        <table className={s.table}>
          <caption>{cases.filter((c) => c.status !== "resolved").length} open of {cases.length}</caption>
          <thead><tr><th scope="col">Investigation</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Priority</th><th scope="col">Next action</th><th scope="col">Due</th><th scope="col">Open exceptions</th><th scope="col">Last update</th></tr></thead>
          <tbody>
            {[...cases].sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved")).map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.intentId ? <a href={`/control/payments/${encodeURIComponent(c.intentId)}`}>{c.title}</a> : c.title}</th>
                <td>{caseStatusLabel(c.status)}</td>
                <td>{c.ownerName ?? <span className={s.muted}>Unassigned</span>}</td>
                <td>{c.priority === "high" || c.priority === "urgent" ? <Tag tone="warn">{priorityLabel(c.priority)}</Tag> : priorityLabel(c.priority)}</td>
                <td>{c.nextAction ?? <span className={s.muted}>None set</span>}</td>
                <td>{c.dueDate ?? "—"}</td>
                <td>{exceptions.filter((e) => e.caseId === c.id && e.status !== "resolved").length}</td>
                <td>{when(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
    </>
  );
}
