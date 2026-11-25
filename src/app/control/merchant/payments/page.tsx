/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { DIFFERENCE_TYPES } from "@/server/db/merchant-schema";
import { PaymentFilters, listMerchantPayments } from "@/server/merchant";
import { batchIds, dataAsOf, partsSummaries } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { NEEDS_A_RATE } from "@/lib/clearline/merchant/fiat-value";
import { BankChip, ChainChip, DecisionChip, Empty, LedgerChip, ProviderChip, differenceLabel, fiat, one } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Payments" };

const RESULTS = [["matched", "Matched"], ["matched_with_difference", "Matched with difference"], ["suggested_for_review", "Suggested for review"], ["exception", "Exception"]] as const;
const NETWORKS = [["tron", "TRON"], ["ethereum", "Ethereum"]] as const;
const TOKENS = [["USDT", "USDT (TRON contract TR7NHq…)"], ["USDC", "USDC (Ethereum contract 0xA0b8…)"]] as const;
const num = (v: string | undefined) => (v && /^\d{1,4}$/.test(v) ? Number(v) : undefined);
/** Rows per page: the list is paged so a month of payments loads quickly; filters and the count cover every payment. */
const PAGE = 100;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, shell } = await merchantMember();
  const sp = await searchParams;
  const asOf = dataAsOf(shell.entities);
  const f = PaymentFilters.safeParse({
    entityId: one(sp.entity), result: one(sp.result), differenceType: one(sp.difference), network: one(sp.network), token: one(sp.token), batchId: one(sp.batch),
    minAgeDays: num(one(sp.minAge)), maxAgeDays: num(one(sp.maxAge)), search: one(sp.search), ...(asOf ? { asOf } : {}),
  });
  const filters = f.success ? f.data : {};
  const orders = (one(sp.orders) ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200);
  const [rows, parts, batches] = await Promise.all([listMerchantPayments(ctx, filters), partsSummaries(ctx), batchIds(ctx)]);
  const shown = orders.length ? rows.filter((r) => orders.includes(r.orderId)) : rows;
  const active = Object.values(filters).some((v) => v !== undefined && v !== asOf) || orders.length > 0;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageNo = Math.min(pages, Math.max(1, num(one(sp.page)) ?? 1));
  const visible = shown.slice((pageNo - 1) * PAGE, pageNo * PAGE);
  const pageHref = (n: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) { const x = one(v); if (x && k !== "page") u.set(k, x); }
    if (n > 1) u.set("page", String(n));
    const qs = u.toString();
    return `/control/merchant/payments${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <h1 className={s.title}>Payments</h1>
      <p className={s.lede}>Every payment with its five records kept apart: what the chain shows, what the provider claims, what the bank shows, what the ledger owes, and Clearline&rsquo;s explanation.</p>
      <form className={m.filters} method="get" action="/control/merchant/payments" aria-label="Filter payments">
        <div className={s.field}><label className={s.label} htmlFor="f-entity">Entity</label>
          <select className={s.select} id="f-entity" name="entity" defaultValue={one(sp.entity) ?? ""}><option value="">All</option>{shell.entities.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}</select></div>
        <div className={s.field}><label className={s.label} htmlFor="f-result">Result</label>
          <select className={s.select} id="f-result" name="result" defaultValue={one(sp.result) ?? ""}><option value="">Any</option>{RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className={s.field}><label className={s.label} htmlFor="f-diff">Difference type</label>
          <select className={s.select} id="f-diff" name="difference" defaultValue={one(sp.difference) ?? ""}><option value="">Any</option>{DIFFERENCE_TYPES.map((v) => <option key={v} value={v}>{differenceLabel(v)}</option>)}</select></div>
        <div className={s.field}><label className={s.label} htmlFor="f-network">Network</label>
          <select className={s.select} id="f-network" name="network" defaultValue={one(sp.network) ?? ""}><option value="">Any</option>{NETWORKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className={s.field}><label className={s.label} htmlFor="f-token">Token</label>
          <select className={s.select} id="f-token" name="token" defaultValue={one(sp.token) ?? ""}><option value="">Any</option>{TOKENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className={s.field}><label className={s.label} htmlFor="f-batch">Settlement batch</label>
          <select className={s.select} id="f-batch" name="batch" defaultValue={one(sp.batch) ?? ""}><option value="">Any</option>{batches.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
        <div className={s.field}><label className={s.label} htmlFor="f-min">Age at least (days)</label>
          <input className={s.input} id="f-min" name="minAge" inputMode="numeric" pattern="[0-9]*" defaultValue={one(sp.minAge) ?? ""} /></div>
        <div className={s.field}><label className={s.label} htmlFor="f-max">Age at most (days)</label>
          <input className={s.input} id="f-max" name="maxAge" inputMode="numeric" pattern="[0-9]*" defaultValue={one(sp.maxAge) ?? ""} /></div>
        <div className={`${s.field} ${m.wide}`}><label className={s.label} htmlFor="f-search">Search order, tx hash or deposit address</label>
          <input className={s.input} id="f-search" name="search" type="search" maxLength={200} defaultValue={one(sp.search) ?? ""} /></div>
        <div className={s.row}><button type="submit" className={s.button}>Apply filters</button>{active ? <a href="/control/merchant/payments">Clear</a> : null}</div>
      </form>
      {!f.success ? <p role="alert" className={`${s.result} ${s.resultError}`}>Some filters were not valid and were ignored.</p> : null}
      <p className={s.small} role="status" data-testid="payments-count">{shown.length} of {rows.length} payments{orders.length ? ` (the ${orders.length} payments behind one bridge line)` : ""}. Age is measured from the latest data ({asOf ? asOf.slice(0, 10) : "none"}){shell.dataMode !== "sample" ? "." : ", so illustrative data ages the same way every day."}</p>
      {shown.length === 0 ? <Empty>{rows.length === 0 && !active ? "No payments are reconciled yet. Run reconciliation from the daily report." : "No payment matches these filters."}</Empty> : (
        <div className={s.tableWrap} role="region" aria-label="Payments table" tabIndex={0}>
          <table className={s.table}>
            <thead><tr><th scope="col">Order</th><th scope="col">Entity</th><th scope="col" className={s.num}>Invoice</th><th scope="col">Explanation</th><th scope="col">Chain</th><th scope="col">Provider</th><th scope="col">Bank</th><th scope="col">Ledger</th><th scope="col">Differences</th><th scope="col" className={s.num}>Age</th></tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.orderId}>
                  <td><a href={`/control/merchant/payments/${encodeURIComponent(r.orderId)}`}>{r.orderId}</a></td>
                  <td className={s.mono}>{r.entityId}</td>
                  <td className={s.num} data-testid="invoice-amount">{"priceToken" in r && r.priceToken
                    // v1 (#173): a token-priced invoice shows its fiat value at a recorded rate, or "needs a rate" (never 0)
                    ? (r.fiatValueMinor !== null ? <>{fiat(r.fiatValueMinor, r.currency)} <span className={s.muted}>(priced in a token)</span></> : <>{NEEDS_A_RATE} <span className={s.muted}>(priced in a token)</span></>)
                    : fiat(r.invoiceMinor, r.currency)}</td>
                  <td><DecisionChip decision={r.decision} /></td>
                  <td><ChainChip p={parts.get(r.orderId)} /></td>
                  <td><ProviderChip p={parts.get(r.orderId)} /></td>
                  <td><BankChip p={parts.get(r.orderId)} /></td>
                  <td><LedgerChip p={parts.get(r.orderId)} /></td>
                  <td>{r.differenceTypes.length ? r.differenceTypes.map(differenceLabel).join(", ") : <span className={s.muted}>None</span>}</td>
                  <td className={s.num}>{r.ageDays} d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav className={m.pager} aria-label="Pages of payments" data-testid="payments-pager">
          <span className={s.small}>Showing {(pageNo - 1) * PAGE + 1}–{Math.min(pageNo * PAGE, shown.length)} of {shown.length} · page {pageNo} of {pages}</span>
          {pageNo > 1 ? <a href={pageHref(pageNo - 1)} rel="prev">Previous page</a> : null}
          {pageNo < pages ? <a href={pageHref(pageNo + 1)} rel="next">Next page</a> : null}
        </nav>
      ) : null}
    </>
  );
}
