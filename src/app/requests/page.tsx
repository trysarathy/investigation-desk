import Link from "next/link";
import { AutoRefresh } from "@/components/requests/AutoRefresh";
import { DemoControls, LoadDemoButton } from "@/components/requests/DemoControls";
import { StatePill } from "@/components/requests/StatePill";
import { formatTime } from "@/lib/format";
import { formatUsdc, unattributed } from "@/lib/requests/lifecycle";
import { nextAction } from "@/lib/requests/present";
import { loadRequests } from "@/lib/requests/service";
import { STATE_LABELS, STATE_MEANING, type RequestState } from "@/lib/requests/types";
import { demoStatus, lastActivity, sortViews, STATE_ORDER } from "@/lib/requests/ui";

export const dynamic = "force-dynamic";

const VIEWS: { key: string; label: string; match: (s: RequestState) => boolean }[] = [
  { key: "open", label: "Open", match: (s) => s !== "completed" },
  ...STATE_ORDER.map((s) => ({ key: s, label: STATE_LABELS[s], match: (x: RequestState) => x === s })),
  { key: "all", label: "All", match: () => true },
];

export default async function RequestsInbox({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "open" } = await searchParams;
  const { data, views } = await loadRequests();
  const demo = demoStatus(data);
  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const shown = sortViews(views.filter((v) => active.match(v.state)));
  const loose = unattributed(data);
  const empty = views.length === 0;

  return (
    <div className="page">
      <AutoRefresh ms={5000} />
      <div className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>Payment requests</h1>
          {demo.hasDemo && <span className="demo-flag" title="Every business, customer, address and transfer in the demo is synthetic. Transfers come from a simulated provider.">Demo · synthetic business data</span>}
        </div>
        <Link className="btn btn-primary" href="/requests/new">New request</Link>
      </div>

      {empty ? (
        <section className="panel" style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>No payment requests yet</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
            Create a request to get a payment link for your customer. Or load the demo: a sample business&apos;s day of USDC invoice
            payments, with simulated transfers you control.
          </p>
          <div style={{ display: "flex", gap: 8 }}><Link className="btn" href="/requests/new">New request</Link><LoadDemoButton /></div>
        </section>
      ) : (
        <>
          {demo.hasDemo && <DemoControls scenarios={demo.scenarios} waitingForBlock={demo.waitingForBlock} inBlock={demo.inBlock} head={demo.head} />}
          <nav className="chips" aria-label="Filter by state">
            {VIEWS.map((v) => (
              <Link key={v.key} href={`/requests?view=${v.key}`} className="chip" aria-pressed={active.key === v.key}>
                {v.label} <span className="count">{views.filter((x) => v.match(x.state)).length}</span>
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <section className="panel" style={{ padding: 16 }}><span className="muted">Nothing in &ldquo;{active.label}&rdquo;.</span> <Link href="/requests?view=all">Show all requests</Link></section>
          ) : (
            <>
              <section className="panel req-table">
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Request</th><th>Customer</th><th style={{ textAlign: "right" }}>Requested</th><th style={{ textAlign: "right" }}>Received</th><th>State</th><th>Next</th><th>Owner</th><th>Updated</th></tr></thead>
                    <tbody>
                      {shown.map((v) => {
                        const r = v.request;
                        const short = v.review === "short" && v.state !== "completed";
                        return (
                          <tr key={r.id}>
                            <td><Link href={`/requests/${r.id}`} className="mono">{r.id}</Link> <span className="faint">{r.invoiceRef}</span></td>
                            <td>{r.customerRef}</td>
                            <td className="amount" style={{ textAlign: "right" }}>{formatUsdc(r.amount)}</td>
                            <td className="amount" style={{ textAlign: "right", color: short ? "var(--amber)" : undefined }}>{v.received === "0" && v.pending === "0" ? <span className="faint">—</span> : formatUsdc(v.received)}{v.pending !== "0" && <span className="faint"> +{formatUsdc(v.pending)}</span>}</td>
                            <td><StatePill state={v.state} /></td>
                            <td className="muted" style={{ whiteSpace: "normal", minWidth: 200 }}>{nextAction(v).title}</td>
                            <td className={v.request.owner ? "" : "faint"}>{v.request.owner ?? "—"}</td>
                            <td className="faint">{formatTime(lastActivity(v))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="req-cards">
                {shown.map((v) => (
                  <Link key={v.request.id} href={`/requests/${v.request.id}`} className="panel req-card" style={{ color: "inherit" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span className="mono">{v.request.id}</span><StatePill state={v.state} /></div>
                    <div><strong>{v.request.customerRef}</strong> <span className="faint">{v.request.invoiceRef}</span></div>
                    <div className="amount">{formatUsdc(v.received)} of {formatUsdc(v.request.amount)} USDC</div>
                    <div className="muted" style={{ fontSize: 12 }}>{nextAction(v).title}</div>
                  </Link>
                ))}
              </div>
            </>
          )}
          {loose.length > 0 && (
            <section className="panel">
              <div className="panel-h"><h2>Transfers no open request claims</h2><span className="faint">{loose.length}</span></div>
              <ul className="activity">
                {loose.map((o) => <li key={o.key}><span className="mono faint">{o.hash.slice(0, 12)}…</span><span>{formatUsdc(o.amount)} {o.tokenSymbol} to {o.to.slice(0, 8)}…{o.to.slice(-4)}: {o.attribution.reason}</span></li>)}
              </ul>
            </section>
          )}
          <details className="panel">
            <summary style={{ padding: "12px 16px", cursor: "pointer" }} className="muted">What each state means</summary>
            <dl className="kv">{STATE_ORDER.map((s) => <div key={s} style={{ display: "contents" }}><dt><StatePill state={s} /></dt><dd className="muted">{STATE_MEANING[s]}</dd></div>)}</dl>
          </details>
        </>
      )}
    </div>
  );
}
