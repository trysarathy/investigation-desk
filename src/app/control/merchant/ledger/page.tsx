import type { Metadata } from "next";
import { MERCHANT_ACCOUNTS } from "@/lib/clearline/merchant";
import { can } from "@/server/authz";
import { monthEnd } from "@/server/merchant";
import { merchantMember } from "@/server/merchant-page";
import { ledgerAccountMap, listLedgerConnections, listLedgerDrafts, postingRulesSigned } from "@/server/ledger-connect";
import { ledgerEnv } from "@/lib/accounting/connect/providers";
import s from "@/components/control/control.module.css";
import { Chip, Empty, one } from "@/components/merchant/ui";
import { Mono } from "@/components/ui";
import g from "@/components/merchant/screens-g2.module.css";
import { EntityMonthForm, pickEntityMonth } from "@/components/merchant/EntityMonth";
import { AccountMapForm, ChooseTenantForm, ConnectButton, DisconnectButton, DraftJournalButton, ReadInvoicesForm } from "@/components/merchant/ledger-forms";

export const metadata: Metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

const NAME: Record<string, string> = { xero: "Xero", qbo: "QuickBooks Online" };
const STATUS: Record<string, { label: string; tone: "ok" | "amber" | "warn" | "plain" }> = {
  active: { label: "Connected", tone: "ok" }, choose_tenant: { label: "Choose the organisation", tone: "amber" },
  needs_reconnect: { label: "Reconnect needed", tone: "warn" }, disconnected: { label: "Disconnected", tone: "plain" },
};

/**
 * v1 phase 2.3: the organisation's ledger connections. Connect (Admin), reconnect when access expired or was revoked,
 * choose the Xero organisation, read invoices into an upload for confirmation, map accounts, and write a journal
 * proposal as a DRAFT in the ledger once the posting rules are signed. Never shows a token.
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, shell } = await merchantMember();
  const sp = await searchParams;
  const env = ledgerEnv();
  const conns = await listLedgerConnections(ctx);
  const live = conns.filter((c) => c.status !== "disconnected");
  const drafts = await listLedgerDrafts(ctx);
  const signed = await postingRulesSigned(ctx.orgId, ctx.userId);
  const mayConnect = can(ctx.role, "ledger_connect"), mayRead = can(ctx.role, "merchant_upload"), mayPrepare = can(ctx.role, "accounting_prepare");
  const pick = pickEntityMonth(shell.entities, one(sp.entity), one(sp.month));
  const xero = live.find((c) => c.provider === "xero" && c.status === "active");
  const proposals = pick && xero && mayPrepare ? (await monthEnd(ctx, pick.entity.id, pick.month)).journals.filter((j) => j.status === "proposed" || j.status === "approved") : [];
  const maps = Object.fromEntries(await Promise.all(live.filter((c) => c.status === "active").map(async (c) => [c.id, await ledgerAccountMap(ctx, c.id)] as const)));
  const accounts = Object.entries(MERCHANT_ACCOUNTS).map(([key, label]) => ({ key, label }));
  return (
    <>
      <h1 className={s.title}>Ledger</h1>
      <p className={s.lede}>Connect your Xero or QuickBooks Online organisation to read sales invoices and payments, and to write journal proposals into the ledger as drafts. Clearline never posts, approves or pays anything in the ledger.</p>
      {env ? <div className={s.warnBox} role="note" data-testid="ledger-env"><strong>{env === "standin" ? "Local stand-in ledgers (fictional data)." : "Sandbox only: a Xero Demo Company or a QuickBooks sandbox company."}</strong> No live ledger can be connected in this build.</div>
        : <div className={s.warnBox} role="note" data-testid="ledger-off"><strong>Ledger connections are off on this server.</strong> Use the accounting export file instead.</div>}
      {one(sp.failed) ? <p role="alert" className={`${s.result} ${s.resultError}`}>The ledger was not connected. Start again below.</p> : null}

      <section className={s.section} aria-labelledby="connections">
        <h2 className={s.h2} id="connections">Connections</h2>
        {live.length === 0 ? <Empty>No ledger is connected.</Empty> : live.map((c) => (
          <article className={s.panel} key={c.id} data-testid={`ledger-${c.provider}`}>
            <h3 className={s.h3}>{NAME[c.provider]} <Chip tone={STATUS[c.status].tone} testId={`ledger-status-${c.provider}`}>{STATUS[c.status].label}</Chip> {c.env === "standin" ? <Chip tone="amber">Stand-in</Chip> : <Chip tone="amber">Sandbox</Chip>}</h3>
            {c.tenantName ? <p className={s.small}>Organisation: {c.tenantName}{c.baseCurrency ? <> · base currency <Mono>{c.baseCurrency}</Mono></> : null}</p> : null}
            {c.status === "active" ? <p className={s.small}>Access renews automatically before it expires{c.refreshExpiresAt ? `; reconnect before ${c.refreshExpiresAt.slice(0, 10)}` : ""}.</p> : null}
            {c.status === "needs_reconnect" ? <p role="alert" className={`${s.result} ${s.resultError}`}>{c.reconnectReason ?? "The ledger no longer accepts this connection."}</p> : null}
            {c.status === "needs_reconnect" && mayConnect ? <ConnectButton provider={c.provider} reconnect /> : null}
            {c.status === "needs_reconnect" && !mayConnect ? <p className={s.small}>An Admin reconnects the ledger.</p> : null}
            {c.status === "choose_tenant" && mayConnect ? <ChooseTenantForm connectionId={c.id} choices={c.tenantChoices} /> : null}
            {c.status === "active" && mayRead ? <ReadInvoicesForm connectionId={c.id} entities={shell.entities.map((e) => ({ id: e.id, name: e.name }))} /> : null}
            {c.status === "active" && mayPrepare && c.draftsSupported ? <details><summary>Account codes for draft journals</summary><AccountMapForm connectionId={c.id} accounts={accounts} current={maps[c.id] ?? {}} /></details> : null}
            {c.status === "active" && !c.draftsSupported ? <p className={s.small}>QuickBooks Online has no draft journals, so Clearline writes no journals there; use the accounting export file.</p> : null}
            {mayConnect ? <DisconnectButton connectionId={c.id} provider={c.provider} /> : null}
          </article>
        ))}
        {mayConnect && env ? (["xero", "qbo"] as const).filter((p) => !live.some((c) => c.provider === p)).map((p) => <ConnectButton key={p} provider={p} />) : null}
        {!mayConnect ? <p className={s.small}>An Admin connects and disconnects ledgers.</p> : null}
      </section>

      <section className={s.section} aria-labelledby="drafts">
        <h2 className={s.h2} id="drafts">Draft journals in the ledger</h2>
        <p className={s.row}>{signed ? <Chip tone="ok" testId="rules-signed">Posting rules signed</Chip> : <Chip tone="warn" testId="rules-unsigned">Posting rules not signed</Chip>}
          <span className={s.small}>{signed ? "Journal proposals may be written to Xero as drafts; a person posts them in Xero." : "Nothing is written to a ledger until the posting rules are signed. Use the accounting export file meanwhile."}</span></p>
        {pick && xero && mayPrepare ? <EntityMonthForm action="/control/merchant/ledger" entities={shell.entities} entity={pick.entity} month={pick.month} label="Choose entity and month" /> : null}
        {xero && mayPrepare ? (proposals.length === 0 ? <Empty>No proposed journals for this entity and month.</Empty> : (
          <ul className={g.downloadList}>{proposals.map((j) => {
            const d = drafts.find((x) => x.proposalId === j.id && x.connectionId === xero.id);
            return <li key={j.id}><Mono>{j.id}</Mono> {d ? <Chip tone={d.status === "drafted" ? "ok" : d.status === "failed" ? "warn" : "amber"}>{d.status === "drafted" ? `Draft ${d.externalId}` : d.status}</Chip> : null}
              {signed && d?.status !== "drafted" ? <DraftJournalButton connectionId={xero.id} proposalId={j.id} /> : null}</li>;
          })}</ul>)) : <p className={s.small}>{mayPrepare ? "Connect Xero to write drafts." : "Finance writes drafts."}</p>}
      </section>
    </>
  );
}
