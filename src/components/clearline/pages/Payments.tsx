"use client";
import Link from "../Link";
import { formatMoney, listExceptions, type CurrencyCode } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { needsAttention, EXECUTION, ExecChip, RECON, ReconChip, scopeText, SETTLEMENT, SettleChip, RAIL } from "../labels";
import { engineLabel } from "../human";
import { FilterBar, SearchFilter, SelectFilter, matchesText, useQuery, useSearchText } from "../filters";
import { Empty, LinkBtn, PageHead, Panel, ui } from "../ui";

const opts = <T extends string>(table: string, m: Record<T, [string, unknown]>) =>
  (Object.keys(m) as T[]).map((v) => ({ value: v, label: engineLabel(table, v) ?? m[v][0] }));

export default function Payments() {
  const { ws } = useWorkspace();
  const { get } = useQuery();
  const execution = get("execution");
  const settlement = get("settlement");
  const reconciliation = get("reconciliation");
  const currency = get("currency");
  const [text, setText, commitText, clearText] = useSearchText();
  const instr = (id?: string) => ws.instructions.find((x) => x.id === id);
  const quoteOf = (id?: string) => ws.quotes.find((x) => x.id === id);
  const rows = ws.intents.filter((i) =>
    (!execution || i.status.execution === execution) &&
    (!settlement || i.status.settlement === settlement) &&
    (!reconciliation || i.status.reconciliation === reconciliation) &&
    (!currency || i.sourceCurrency === currency || i.destinationCurrency === currency) &&
    matchesText(text, i.id, i.internalReference, i.beneficiaryName, i.destinationCountry, i.purpose,
      instr(i.instructionId)?.providerPaymentId, quoteOf(i.selectedQuoteId)?.providerName));
  const currencies = [...new Set(ws.intents.flatMap((i) => [i.sourceCurrency, i.destinationCurrency]))].sort() as CurrencyCode[];
  const filters = [
    execution && `execution “${engineLabel("execution", execution) ?? EXECUTION[execution as keyof typeof EXECUTION]?.[0] ?? execution}”`,
    settlement && `settlement evidence “${engineLabel("settlement", settlement) ?? SETTLEMENT[settlement as keyof typeof SETTLEMENT]?.[0] ?? settlement}”`,
    reconciliation && `reconciliation “${engineLabel("reconciliation", reconciliation) ?? RECON[reconciliation as keyof typeof RECON]?.[0] ?? reconciliation}”`,
    currency && `currency ${currency}`,
    text.trim() && `text “${text.trim()}”`,
  ].filter(Boolean);

  return (
    <>
      <PageHead eyebrow="Operations" title="Payments"
        lede="Every payment shows three separate states: what the provider reports (execution), what evidence of settlement exists, and whether it reconciles."
        actions={<LinkBtn href="/clearline/routes/new" kind="primary">New payment intent</LinkBtn>} />
      <FilterBar label="Filter payments" onClear={clearText} clear={filters.length ? ["execution", "settlement", "reconciliation", "currency", "q"] : undefined}
        summary={<>Showing {rows.length} of {ws.intents.length} payments{filters.length ? <> · filtered by {filters.join(", ")}</> : null}.</>}>
        <SearchFilter label="Search" placeholder="ID, reference, beneficiary, provider…" value={text} onChange={setText} onCommit={commitText} />
        <SelectFilter param="execution" label="Execution" options={opts("execution", EXECUTION)} />
        <SelectFilter param="settlement" label="Settlement evidence" options={opts("settlement", SETTLEMENT)} />
        <SelectFilter param="reconciliation" label="Reconciliation" options={opts("reconciliation", RECON)} />
        <SelectFilter param="currency" label="Currency" options={currencies.map((c) => ({ value: c, label: c }))} />
      </FilterBar>
      <Panel title={`${rows.length} payment${rows.length === 1 ? "" : "s"}`} id="payments">
        {rows.length === 0 ? (ws.intents.length === 0
          ? <Empty>No payments in this workspace yet. <Link href="/clearline/routes/new">Create a payment intent</Link> or <Link href="/clearline/settings">reset to the sample workspace</Link>.</Empty>
          : <Empty>No payments match these filters. Clear the filters to see all {ws.intents.length}.</Empty>) : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Payments table">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Payment</th><th>Beneficiary</th><th className={ui.r}>Amount</th><th>Provider / rail</th><th>Execution</th><th>Settlement evidence</th><th>Reconciliation</th><th>Open exceptions</th></tr></thead>
              <tbody>
                {rows.map((i) => {
                  const q = quoteOf(i.selectedQuoteId);
                  const ex = listExceptions(ws, { intentId: i.id }).filter((e) => needsAttention(e)).length;
                  const pp = instr(i.instructionId)?.providerPaymentId;
                  return (
                    <tr key={i.id}>
                      <td data-label="Payment"><Link href={`/clearline/payments/${i.id}`} className="mono">{i.id}</Link><span className={ui.sub}>{i.internalReference}</span></td>
                      <td data-label="Beneficiary">{i.beneficiaryName}<span className={ui.sub}>{i.destinationCountry} · {i.destinationCurrency}</span></td>
                      <td data-label="Amount" className={`${ui.r} ${ui.num}`}>{formatMoney({ amountMinor: i.amountMinor, currency: i.sourceCurrency })}</td>
                      <td data-label="Provider / rail">{q ? q.providerName : "Not chosen"}<span className={ui.sub}>{q ? RAIL[q.rail] : "—"}{pp ? ` · ${pp}` : ""}</span></td>
                      <td data-label="Execution"><ExecChip v={i.status.execution} /></td>
                      <td data-label="Settlement evidence"><SettleChip v={i.status.settlement} execution={i.status.execution} /><span className={ui.sub}>{scopeText(i.status.settlementScope)}</span></td>
                      <td data-label="Reconciliation"><ReconChip v={i.status.reconciliation} returnStatus={i.returnStatus} /></td>
                      <td data-label="Open exceptions" className={ui.num}>{ex > 0 ? <Link href={`/clearline/exceptions?intent=${i.id}`}>{ex}</Link> : "0"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
