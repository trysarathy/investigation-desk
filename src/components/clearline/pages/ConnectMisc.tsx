"use client";
import Link from "next/link";
import { QUOTE_LABEL, formatMinor } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { OutcomeChip, RAIL } from "../labels";
import { Chip, Code, Empty, PageHead, Panel, fmtTime, ui } from "../ui";

export function QuotesRoutes() {
  const { ws } = useWorkspace();
  const quotes = [...ws.quotes].reverse();
  return (
    <>
      <PageHead eyebrow="Connect" title="Quotes and routes" lede={<>Sandbox provider routes and every quote requested in this workspace. Each quote is labelled <strong>{QUOTE_LABEL}</strong>.</>} />
      <Panel title={`Routes (${ws.routes.length})`} id="routes">
        <div className={ui.tableWrap}>
          <table className={`${ui.table} ${ui.stack}`}>
            <thead><tr><th>Provider</th><th>Rail</th><th>Corridors</th><th className={ui.r}>Limits</th><th>ETA</th><th>Prerequisites / restriction</th></tr></thead>
            <tbody>{ws.routes.map((r) => (
              <tr key={r.id}>
                <td data-label="Provider">{r.providerName}<span className={ui.sub + " mono"}>{r.id}</span></td>
                <td data-label="Rail">{RAIL[r.rail]}{r.network && <span className={ui.sub}>{r.network.name} · chain {r.network.chainId} · testnet</span>}</td>
                <td data-label="Corridors">{r.sourceCurrencies.join("/")} → {r.destinationCurrencies.join("/")}<span className={ui.sub}>{r.destinationCountries.join(", ")}</span></td>
                <td data-label="Limits" className={`${ui.r} ${ui.num}`}>{formatMinor(r.minAmountMinor, r.sourceCurrencies[0])} – {formatMinor(r.maxAmountMinor, r.sourceCurrencies[0])}</td>
                <td data-label="ETA">{r.etaLabel}</td>
                <td data-label="Prerequisites">{r.restriction ? <Chip tone="bad">Restricted: {r.restriction}</Chip> : r.prerequisites.join(", ") || "None"}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={`Quotes (${quotes.length})`} id="quotes">
        {quotes.length === 0 ? <Empty>No quotes yet. <Link href="/clearline/connect">Create an intent and request quotes</Link>.</Empty> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Quote</th><th>Payment</th><th>Provider</th><th className={ui.r}>Rate</th><th>Eligibility</th><th>Freshness</th></tr></thead>
              <tbody>{quotes.map((q) => (
                <tr key={q.id}>
                  <td data-label="Quote" className="mono">{q.id}</td>
                  <td data-label="Payment"><Link href={`/clearline/payments/${q.intentId}`} className="mono">{q.intentId}</Link></td>
                  <td data-label="Provider">{q.providerName}</td>
                  <td data-label="Rate" className={`${ui.r} ${ui.num}`}>{q.indicativeRate}</td>
                  <td data-label="Eligibility"><Chip tone={q.eligible ? "ok" : "bad"}>{q.eligible ? "Eligible" : "Not eligible"}</Chip><span className={ui.sub}>{q.eligibilityReason}</span></td>
                  <td data-label="Freshness"><Chip tone={q.freshness === "fresh" ? "ok" : "neutral"}>{q.freshness === "fresh" ? "Fresh" : "Expired"}</Chip><span className={ui.sub}>Expires {fmtTime(q.expiresAt)}</span></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export function ProviderActivity() {
  const { ws } = useWorkspace();
  const events = [...ws.providerEvents].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return (
    <>
      <PageHead eyebrow="Connect" title="Provider activity"
        lede="Every event received from sandbox providers, including duplicates, late arrivals and rejected signatures, with how Clearline processed it. Provider events are claims, not settlement proof." />
      <Panel title={`${events.length} event${events.length === 1 ? "" : "s"}`} id="events">
        {events.length === 0 ? <Empty>No provider events yet. Submit an instruction in <Link href="/clearline/connect">Payment intents</Link> and simulate an event.</Empty> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Received</th><th>Event</th><th>Payment</th><th>Provenance</th><th>Signature</th><th>Processing</th></tr></thead>
              <tbody>{events.map((e) => (
                <tr key={e.id}>
                  <td data-label="Received" className={ui.num}>{fmtTime(e.receivedAt)}<span className={ui.sub}>seq {e.sequence}</span></td>
                  <td data-label="Event"><Code>{e.normalizedType}</Code><span className={ui.sub}>{e.providerId} · {e.providerEventId}</span></td>
                  <td data-label="Payment">{e.intentId ? <Link href={`/clearline/payments/${e.intentId}`} className="mono">{e.intentId}</Link> : "Unresolved"}</td>
                  <td data-label="Provenance">{e.provenance.replace(/_/g, " ")}<span className={ui.sub}>{e.confidence.replace(/_/g, " ")}</span></td>
                  <td data-label="Signature"><Chip tone={e.signatureResult === "invalid" ? "bad" : e.signatureResult === "valid" ? "ok" : "neutral"}>{e.signatureResult.replace(/_/g, " ")}</Chip></td>
                  <td data-label="Processing"><OutcomeChip v={e.processingOutcome} /></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
