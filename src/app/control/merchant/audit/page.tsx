import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/server/authz";
import { auditorView } from "@/server/auditor";
import { merchantPage } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import { Empty } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Audit" };

/** The Auditor's only page: its period, its entities and the period's evidence packs. Read-only; downloads are audited. */
export default async function AuditPage() {
  const { ctx } = await merchantPage();
  if (!can(ctx.role, "audit_download")) notFound();
  const v = await auditorView(ctx);
  const g = v.grant;
  const ev = (q: string, f: string) => `/api/control/audit/evidence?${q}&format=${f}`;
  return (
    <>
      <h1 className={s.title}>Audit</h1>
      <p className={s.lede} data-testid="audit-grant">Read-only access to {g.periodStart} – {g.periodEnd}{ctx.entityScope !== null ? ` for ${ctx.entityScope.join(", ") || "no entity"}` : ""}, until {g.expiresAt.slice(0, 16).replace("T", " ")} UTC. Every download is recorded in the audit history.</p>
      <section className={s.section} aria-labelledby="months">
        <h2 className={s.h2} id="months">Evidence packs by month</h2>
        {v.entities.length === 0 ? <Empty>No entity is visible to you.</Empty> : (
          <ul className={s.small}>{v.entities.flatMap((e) => g.months.map((m) => (
            <li key={`${e.id}-${m}`}>{e.name} ({e.id}), {m}: <a href={ev(`entity=${encodeURIComponent(e.id)}&month=${m}`, "pdf")}>PDF</a> · <a href={ev(`entity=${encodeURIComponent(e.id)}&month=${m}`, "csv")}>CSV</a> · <a href={ev(`entity=${encodeURIComponent(e.id)}&month=${m}`, "json")}>JSON</a></li>
          )))}</ul>
        )}
      </section>
      <section className={s.section} aria-labelledby="pays">
        <h2 className={s.h2} id="pays">Payments in the period ({v.payments.length})</h2>
        {v.payments.length === 0 ? <Empty>No payment in this period.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Payments in the period" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Payment</th><th scope="col">Entity</th><th scope="col">Decision</th><th scope="col">Bank evidence</th><th scope="col">Evidence pack</th></tr></thead>
              <tbody>{v.payments.map((p) => (
                <tr key={p.orderId}><td className={s.mono}>{p.orderId}</td><td>{p.entityId}</td><td>{p.decision.replace(/_/g, " ")}</td><td>{p.bankEvidence}</td>
                  <td><a href={ev(`order=${encodeURIComponent(p.orderId)}`, "pdf")}>PDF</a> · <a href={ev(`order=${encodeURIComponent(p.orderId)}`, "json")}>JSON</a></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
