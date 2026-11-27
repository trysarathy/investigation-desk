import type { Metadata } from "next";
import { MERCHANT_ACCOUNTS } from "@/lib/clearline/merchant";
import { can } from "@/server/authz";
import { monthEnd } from "@/server/merchant";
import { SANDBOX_EXPORT_LABEL } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { EntityMonthForm, pickEntityMonth } from "@/components/merchant/EntityMonth";
import { Chip, Empty, PendingSignOff, one } from "@/components/merchant/ui";
import { FiatAmount } from "@/components/merchant/FiatAmount";
import { Mono, StatusBadge } from "@/components/ui";
import g from "@/components/merchant/screens-g2.module.css";

export const metadata: Metadata = { title: "Accounting export" };

const PATTERN: Record<string, string> = { provider_confirmation: "Provider confirmation", approved_writeoff: "Write-off (after approval)", refund: "Refund netted in a settlement", settlement: "Settlement" };
type Line = { side: "debit" | "credit"; account: keyof typeof MERCHANT_ACCOUNTS; amountMinor: string; orderId?: string; batchId?: string; onApproval?: string };
type Ev = { entryDate: string | null; memo: string; ruleId: string; requiresApprovalOf: string | null };

export default async function AccountingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, shell } = await merchantMember();
  const sp = await searchParams;
  const pick = pickEntityMonth(shell.entities, one(sp.entity), one(sp.month));
  if (!pick) return (<><h1 className={s.title}>Accounting export</h1><Empty>No entities are set up yet.</Empty></>);
  const { entity, month } = pick;
  const me = await monthEnd(ctx, entity.id, month);
  const js = me.journals.filter((j) => j.status === "proposed");
  const cur = me.currency;
  const mayExport = can(ctx.role, "merchant_export");
  const ledger = entity.ledger === "quickbooks" ? "QuickBooks" : entity.ledger === "xero" ? "Xero" : "ledger";
  // the preview is paged (50 entries a page); the export file and the counts cover every proposal
  const PER = 50;
  const pages = Math.max(1, Math.ceil(js.length / PER));
  const raw = one(sp.page);
  const pageNo = Math.min(pages, Math.max(1, raw && /^\d{1,4}$/.test(raw) ? Number(raw) : 1));
  const first = (pageNo - 1) * PER;
  const shown = js.slice(first, first + PER);
  const pageHref = (n: number) => `/control/merchant/accounting?entity=${encodeURIComponent(entity.id)}&month=${month}${n > 1 ? `&page=${n}` : ""}`;
  const totals = shown.map((j) => (j.lines as Line[]).reduce((t, l) => ({ dr: t.dr + (l.side === "debit" ? BigInt(l.amountMinor) : 0n), cr: t.cr + (l.side === "credit" ? BigInt(l.amountMinor) : 0n) }), { dr: 0n, cr: 0n }));
  return (
    <>
      <h1 className={s.title}>Accounting export</h1>
      <p className={s.lede}>Journal proposals from the reconciliation, previewed line by line and exported through the Accounting Bridge as a file only. There is no live {ledger} connection.</p>
      <div className={s.warnBox} role="note" data-testid="sandbox-note"><strong>Sandbox/demo company only; posting rules pending sign-off.</strong> These entries are proposals derived from the case figures. Import the file only into a sandbox or demo company.</div>
      <EntityMonthForm action="/control/merchant/accounting" entities={shell.entities} entity={entity} month={month} label="Choose entity and month" />

      <section className={s.section} aria-labelledby="export">
        <h2 className={s.h2} id="export">Export file</h2>
        {mayExport ? (
          <>
            <p className={s.small}>{js.length} proposals for {entity.id}, {month}, in a {ledger} journal import layout. The export is recorded in the audit history with its SHA-256; it changes no proposal and posts nothing. Marked &ldquo;{SANDBOX_EXPORT_LABEL}&rdquo;.</p>
            <ul className={`${m.downloads} ${g.downloadList}`}>
              <li><a href={`/api/control/merchant/journals/export?entity=${encodeURIComponent(entity.id)}&month=${month}&format=csv`} download>Download journal CSV (sandbox)</a></li>
              <li><a href={`/api/control/merchant/journals/export?entity=${encodeURIComponent(entity.id)}&month=${month}&format=json`} download>Download journal JSON (sandbox)</a></li>
            </ul>
          </>
        ) : <p className={s.small} data-testid="export-not-allowed">Finance, an Approver or an Admin exports journal files. Your role previews them.</p>}
      </section>

      <section className={s.section} aria-labelledby="preview">
        <h2 className={s.h2} id="preview">Journal preview ({js.length})</h2>
        <p className={s.row}><Chip tone={shell.dataMode === "sample" ? "amber" : "info"}>{shell.label}</Chip><span className={s.small}>{shell.dataMode === "demo" ? "Proposed from the reconciled demo data (fictional); nothing is posted to a ledger." : shell.dataMode === "live" ? "Proposed from your reconciled data; nothing is posted to a ledger." : "Fictional entries from the illustrative cases."}</span></p>
        {pages > 1 ? <p className={s.small} data-testid="journal-range">Showing entries {first + 1}–{Math.min(first + PER, js.length)} of {js.length}.</p> : null}
        {js.length === 0 ? <Empty>No journal proposals for {entity.id} in {month}. Run reconciliation from the daily report first.</Empty> : shown.map((j, i) => {
          const ev = j.evidence as Ev;
          return (
            <article className={s.panel} key={j.id} aria-labelledby={`j-${i}`} data-testid="journal-entry">
              <h3 className={s.h3} id={`j-${i}`}>{PATTERN[j.pattern] ?? j.pattern} · <Mono>{j.id}</Mono></h3>
              <p className={s.row}><PendingSignOff /> <Chip>Proposed</Chip> {ev.requiresApprovalOf ? <Chip tone="amber">{ev.requiresApprovalOf.startsWith("resolution:") ? "Post only after the controller's resolution" : "Post only after write-off approval"}</Chip> : null} <span className={s.small}>Entry date {ev.entryDate ?? "when approved"} · rule <Mono>{ev.ruleId}</Mono></span></p>
              <p className={s.small}>{ev.memo}</p>
              <div className={g.wrap} role="region" aria-label={`Lines of ${j.id}`} tabIndex={0}>
                <table className={g.dense}>
                  <thead><tr><th scope="col">Account</th><th scope="col" className={g.num}>Debit</th><th scope="col" className={g.num}>Credit</th><th scope="col">Reference</th></tr></thead>
                  <tbody>
                    {(j.lines as Line[]).map((l, k) => (
                      <tr key={k}><td>{MERCHANT_ACCOUNTS[l.account] ?? l.account}{l.onApproval ? <span className={s.small}> (on approval)</span> : null}</td><td className={g.num}>{l.side === "debit" ? <FiatAmount minor={l.amountMinor} currency={cur} /> : ""}</td><td className={g.num}>{l.side === "credit" ? <FiatAmount minor={l.amountMinor} currency={cur} /> : ""}</td><td className={g.cellMono}>{l.orderId ?? l.batchId ?? ""}</td></tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><th scope="row">Total</th><td className={g.num}><strong><FiatAmount minor={totals[i].dr} currency={cur} /></strong></td><td className={g.num}><strong><FiatAmount minor={totals[i].cr} currency={cur} /></strong></td><td>{totals[i].dr === totals[i].cr ? <StatusBadge kind="matched" label="Balanced" /> : <StatusBadge kind="exception" label="Not balanced" />}</td></tr>
                  </tfoot>
                </table>
              </div>
            </article>
          );
        })}
        {pages > 1 ? (
          <nav className={m.pager} aria-label="Pages of journal proposals">
            <span className={s.small}>Page {pageNo} of {pages}</span>
            {pageNo > 1 ? <a href={pageHref(pageNo - 1)} rel="prev">Previous page</a> : null}
            {pageNo < pages ? <a href={pageHref(pageNo + 1)} rel="next">Next page</a> : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
