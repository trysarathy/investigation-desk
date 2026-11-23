import type { Metadata } from "next";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { EntityMonthForm, pickEntityMonth } from "@/components/merchant/EntityMonth";
import { DEMO_LABEL, Empty, one } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Evidence packs" };

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { shell } = await merchantMember();
  const sp = await searchParams;
  const pick = pickEntityMonth(shell.entities, one(sp.entity), one(sp.month));
  return (
    <>
      <h1 className={s.title}>Evidence packs</h1>
      <p className={s.lede}>A pack holds the chain proof, the provider&rsquo;s record, the bank line, every approval and the audit trail: what an auditor or a customer needs to follow a payment from the chain to the books. Per-payment packs are on each payment&rsquo;s page.</p>
      {!pick ? <Empty>No entities are set up yet.</Empty> : (
        <>
          <EntityMonthForm action="/control/merchant/evidence" entities={shell.entities} entity={pick.entity} month={pick.month} label="Choose entity and month" />
          <section className={s.section} aria-labelledby="month-pack">
            <h2 className={s.h2} id="month-pack">Month pack: {pick.entity.id}, {pick.month}</h2>
            <p className={s.small}>Every payment of {pick.entity.name} whose transfer falls in {pick.month} (merchant day, {pick.entity.timezone}). Each download is recorded in the audit history with its SHA-256. {shell.dataMode === "live" ? null : <>Files are marked &ldquo;{DEMO_LABEL}&rdquo;; </>}CSV cells that a spreadsheet could run as a formula are escaped.</p>
            <ul className={m.downloads}>
              {(["pdf", "csv", "json"] as const).map((f) => (
                <li key={f}><a href={`/api/control/merchant/evidence?entity=${encodeURIComponent(pick.entity.id)}&month=${pick.month}&format=${f}`} download>Download {f === "pdf" ? "PDF summary" : f.toUpperCase()}</a></li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
