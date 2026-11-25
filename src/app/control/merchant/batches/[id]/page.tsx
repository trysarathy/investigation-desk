/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { orNotFound } from "@/server/control-page";
import { batchBridge } from "@/server/merchant";
import { openExceptionsOf } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { Chip, EvidenceChip, differenceLabel, fiat } from "@/components/merchant/ui";
import { BANK_EVIDENCE_LABEL } from "@/lib/clearline/merchant";

export const metadata: Metadata = { title: "Batch bridge" };

const CHECKS: Record<string, string> = {
  linesEqualGross: "The batch's lines add up to its gross", bridgeEqualsGross: "The bridge from the merchant's day equals the gross",
  grossLessFeesRefundsEqualsNet: "Gross − fees − refunds = net", netEqualsBankLine: "Net = the bank line", noUnexplained: "No unexplained amount",
  perPaymentLines: "Per-payment settlement lines add up to the batch and to the bank credit",
  currencyAgrees: "Payments and the bank line are in the batch's currency (never converted)",
};
const TOTALS = new Set(["merchant_day", "gross", "net"]);
const pct = (x: bigint, max: bigint) => Number((x * 10000n) / max) / 100;

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await merchantMember();
  const id = decodeURIComponent((await params).id);
  const b = await orNotFound(batchBridge(ctx, id));
  const held = b.lines.filter((l) => l.kind === "held_by_provider" || l.kind === "unexplained").flatMap((l) => l.orderIds);
  const exceptions = await openExceptionsOf(ctx, held);
  const href = (orders: string[]) => (orders.length === 1 ? `/control/merchant/payments/${encodeURIComponent(orders[0])}` : `/control/merchant/payments?orders=${encodeURIComponent(orders.join(","))}`);

  // the waterfall: a total starts at zero; a step floats from the running total to the running total plus its amount
  let run = 0n;
  const bars = b.lines.map((l) => {
    const a = BigInt(l.amountMinor);
    const total = TOTALS.has(l.kind);
    const from = total ? 0n : run;
    const to = total ? a : run + a;
    run = to;
    return { l, a, total, lo: from < to ? from : to, hi: from < to ? to : from };
  });
  const max = bars.reduce((x, r) => (r.hi > x ? r.hi : x), 1n);
  const lo = bars.filter((r) => r.total).reduce((x, r) => (r.a < x ? r.a : x), max);
  // the axis starts a little below the smallest total, so a step of a few hundred is visible next to a total of 40,000
  const floor = lo > 0n ? (lo * 9n) / 10n : 0n;
  const span = max - floor || 1n;
  const pos = (v: bigint) => pct((v < floor ? floor : v) - floor, span);

  return (
    <>
      <p className={s.small}><a href="/control/merchant/batches">← All batches</a></p>
      <h1 className={s.title}>Batch {b.batchId}</h1>
      <p className={s.lede}>From the merchant&rsquo;s day ({b.merchantDay}, {b.merchantTimeZone.name}) to the bank credit. Provider day {b.providerDay} ({b.cutOffNote}). {b.tied ? <Chip tone="ok" testId="batch-tied">Tied to the cent</Chip> : <Chip tone="warn" testId="batch-tied">Not tied</Chip>}</p>

      <section className={s.section} aria-labelledby="waterfall-h">
        <h2 className={s.h2} id="waterfall-h">Bridge</h2>
        <figure className={m.wf} aria-labelledby="waterfall-cap" data-testid="waterfall">
          <figcaption id="waterfall-cap" className={s.small}>Each bar is one step from the merchant&rsquo;s day to the bank credit, in {b.currency}; totals start from {fiat(floor, b.currency)} so the small steps show. Open a bar to see its payments.</figcaption>
          <ol className={m.wfList}>
            {bars.map((r, i) => {
              const bar = <span className={`${m.wfBar} ${r.total ? m.wfTotal : r.a < 0n ? m.wfNeg : m.wfPos}`} style={{ "--l": `${pos(r.lo)}%`, "--w": `${Math.max(0.6, pos(r.hi) - pos(r.lo))}%` } as CSSProperties} />;
              const n = r.l.orderIds.length;
              return (
                <li key={i} className={m.wfRow} data-testid="waterfall-step">
                  <span className={m.wfLabel}>{r.total ? <strong>{r.l.label}</strong> : r.l.label}</span>
                  <span className={m.wfAmount}>{r.total ? <strong>{fiat(r.a, b.currency)}</strong> : fiat(r.a, b.currency)}</span>
                  <span className={m.wfTrack}>{n ? <a href={href(r.l.orderIds)} className={m.wfLink} aria-label={`${r.l.label}: ${fiat(r.a, b.currency)}, ${n === 1 ? `payment ${r.l.orderIds[0]}` : `${n} payments`}`}>{bar}</a> : <span aria-hidden="true">{bar}</span>}</span>
                </li>
              );
            })}
          </ol>
        </figure>
        {exceptions.length ? (
          <div className={s.warnBox} role="note" data-testid="bridge-exceptions">
            {exceptions.map((e) => <p key={e.id}><Chip tone="warn">Exception</Chip> <a href={`/control/merchant/exceptions/${encodeURIComponent(e.id)}`}>{e.id}</a> for <a href={`/control/merchant/payments/${encodeURIComponent(e.orderId!)}`}>{e.orderId}</a>: {e.reason}</p>)}
          </div>
        ) : null}
        <div className={s.tableWrap} role="region" aria-label="Batch bridge table" tabIndex={0}>
          <table className={s.table}>
            <thead><tr><th scope="col">Step</th><th scope="col" className={s.num}>Amount</th><th scope="col">Payments</th><th scope="col">Why</th></tr></thead>
            <tbody>{b.lines.map((l, i) => {
              const total = TOTALS.has(l.kind);
              return (
                <tr key={i}>
                  <td>{total ? <strong>{l.label}</strong> : l.label}{l.differenceType ? <><br /><Chip tone="info">{differenceLabel(l.differenceType)}</Chip></> : null}</td>
                  <td className={s.num}>{total ? <strong>{fiat(l.amountMinor, b.currency)}</strong> : fiat(l.amountMinor, b.currency)}</td>
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
        <p className={s.small}>Bank line: {b.bankLineId ? <span className={s.mono}>{b.bankLineId}</span> : "none yet"}{b.bankLineLabel ? ` (${b.bankLineLabel})` : ""}. Settlement {b.settlementVerified ? "verified by the bank line" : "not verified"}. <EvidenceChip level={b.bankEvidence} label={BANK_EVIDENCE_LABEL[b.bankEvidence]} /> {b.settled ? <Chip tone="ok" testId="batch-settled">Settled</Chip> : <Chip tone="plain" testId="batch-settled">Not settled</Chip>}</p>
        {b.entityValue ? (b.entityValue.status === "rated"
          ? <p className={s.small} data-testid="batch-entity-value">In the entity&rsquo;s currency: {fiat(b.entityValue.amountMinor, b.entityValue.currency)} at {b.entityValue.pair} {b.entityValue.rate} ({b.entityValue.source}, as of {b.entityValue.asOf}). Shown only: the batch is tied in {b.currency}, never converted.</p>
          : <p className={s.small} data-testid="batch-entity-value"><Chip tone="warn" testId="batch-needs-rate">Needs a rate</Chip> In the entity&rsquo;s currency: not shown ({b.entityValue.reason}). The batch is tied in {b.currency}, never converted.</p>) : null}
      </section>
    </>
  );
}
