/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { orNotFound } from "@/server/control-page";
import { batchBridge } from "@/server/merchant";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { Chip, differenceLabel, fiat } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Batch bridge" };

const CHECKS: Record<string, string> = {
  linesEqualGross: "The batch's lines add up to its gross", bridgeEqualsGross: "The bridge from the merchant's day equals the gross",
  grossLessFeesRefundsEqualsNet: "Gross − fees − refunds = net", netEqualsBankLine: "Net = the bank line", noUnexplained: "No unexplained amount",
};

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await merchantMember();
  const id = decodeURIComponent((await params).id);
  const b = await orNotFound(batchBridge(ctx, id));
  const max = b.lines.reduce((x, l) => { const a = BigInt(l.amountMinor); const v = a < 0n ? -a : a; return v > x ? v : x; }, 1n);
  const href = (orders: string[]) => (orders.length === 1 ? `/control/merchant/payments/${encodeURIComponent(orders[0])}` : `/control/merchant/payments?orders=${encodeURIComponent(orders.join(","))}`);
  return (
    <>
      <p className={s.small}><a href="/control/merchant/batches">← All batches</a></p>
      <h1 className={s.title}>Batch {b.batchId}</h1>
      <p className={s.lede}>From the merchant&rsquo;s day ({b.merchantDay}, {b.merchantTimeZone.name}) to the bank credit. Provider day {b.providerDay} ({b.cutOffNote}). {b.tied ? <Chip tone="ok" testId="batch-tied">Tied to the cent</Chip> : <Chip tone="warn" testId="batch-tied">Not tied</Chip>}</p>
      <section className={s.section} aria-labelledby="waterfall">
        <h2 className={s.h2} id="waterfall">Bridge</h2>
        <div className={s.tableWrap} role="region" aria-label="Batch bridge table" tabIndex={0}>
          <table className={s.table}>
            <thead><tr><th scope="col">Step</th><th scope="col" className={s.num}>Amount</th><th scope="col" className={m.barCell}><span className={s.muted}>Size</span></th><th scope="col">Payments</th><th scope="col">Why</th></tr></thead>
            <tbody>{b.lines.map((l, i) => {
              const a = BigInt(l.amountMinor);
              const pct = Number(((a < 0n ? -a : a) * 1000n) / max) / 10;
              const total = l.kind === "gross" || l.kind === "net" || l.kind === "merchant_day";
              return (
                <tr key={i}>
                  <td>{total ? <strong>{l.label}</strong> : l.label}{l.differenceType ? <><br /><Chip tone="info">{differenceLabel(l.differenceType)}</Chip></> : null}</td>
                  <td className={s.num}>{total ? <strong>{fiat(l.amountMinor, b.currency)}</strong> : fiat(l.amountMinor, b.currency)}</td>
                  <td className={m.barCell} aria-hidden="true"><span className={`${m.bar} ${a < 0n ? m.barNeg : ""}`} style={{ width: `${pct}%` }} /></td>
                  <td>{l.orderIds.length ? <a href={href(l.orderIds)}>{l.orderIds.length === 1 ? l.orderIds[0] : `${l.orderIds.length} payments`}</a> : <span className={s.muted}>—</span>}</td>
                  <td className={s.small}>{l.reason}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
      <section className={s.section} aria-labelledby="checks">
        <h2 className={s.h2} id="checks">Checks</h2>
        <ul className={s.plainList}>{Object.entries(b.checks).map(([k, v]) => <li key={k} className={s.row}>{v ? <Chip tone="ok">Pass</Chip> : <Chip tone="warn">Fail</Chip>} {CHECKS[k] ?? k}</li>)}</ul>
        <p className={s.small}>Bank line: {b.bankLineId ? <span className={s.mono}>{b.bankLineId}</span> : "none yet"}{b.bankLineLabel ? ` (${b.bankLineLabel})` : ""}. Settlement {b.settlementVerified ? "verified by the bank line" : "not verified"}.</p>
      </section>
    </>
  );
}
