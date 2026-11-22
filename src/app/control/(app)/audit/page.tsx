import type { Metadata } from "next";
import { auditHistory, listMembers } from "@/server/control";
import { pageContext } from "@/server/control-page";
import s from "@/components/control/control.module.css";
import { PageTitle, TableRegion, when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Audit" };

export default async function AuditPage() {
  const ctx = await pageContext();
  const [events, members] = await Promise.all([auditHistory(ctx, 200), listMembers(ctx)]);
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const actor = (e: (typeof events)[number]) => {
    if (e.actorUserId) return names.get(e.actorUserId) ?? "A former member";
    const seed = (e.details as { actorId?: string } | null)?.actorId;
    return seed ? `Fictional seed data (${seed})` : "System";
  };
  return (
    <>
      <PageTitle title="Audit history" lede="Append-only. The newest 200 events in this organisation: who did what, and when." />
      <TableRegion label="Audit history">
        <table className={s.table} data-testid="audit-table">
          <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Summary</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={String(e.seq)}>
                <td className={s.mono}>{when(e.at)}</td>
                <td>{actor(e)}</td>
                <td className={s.mono}>{e.action}</td>
                <td>{e.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
    </>
  );
}
