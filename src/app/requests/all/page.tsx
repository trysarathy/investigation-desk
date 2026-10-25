import Link from "next/link";
import { AutoRefresh } from "@/components/requests/AutoRefresh";
import { DemoBadge, TonePill } from "@/components/requests/StatePill";
import { formatTime } from "@/lib/format";
import { formatUsdc } from "@/lib/requests/lifecycle";
import { verdict, type Tone } from "@/lib/requests/present";
import { loadRequests } from "@/lib/requests/service";
import { lastActivity, sortViews } from "@/lib/requests/ui";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string; tones: Tone[] }[] = [
  { key: "all", label: "All", tones: ["blocked", "attention", "progress", "waiting", "paid"] },
  { key: "attention", label: "Needs attention", tones: ["attention", "blocked"] },
  { key: "progress", label: "Arriving", tones: ["progress"] },
  { key: "waiting", label: "Awaiting payment", tones: ["waiting"] },
  { key: "paid", label: "Paid", tones: ["paid"] },
];

export default async function AllRequests({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "all" } = await searchParams;
  const { data, views } = await loadRequests();
  const f = FILTERS.find((x) => x.key === view) ?? FILTERS[0];
  const rows = sortViews(views, data).map((v) => ({ v, vd: verdict(data, v) }));
  const shown = rows.filter((x) => f.tones.includes(x.vd.tone));
  return (
    <div className="page">
      <AutoRefresh ms={5000} />
      <div className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><h1 style={{ margin: 0 }}>All requests</h1>{views.some((v) => v.request.demo) && <DemoBadge />}</div>
        <Link className="btn btn-primary" href="/requests/new">New request</Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>Every request, including earlier ones (the at-a-glance numbers cover this week only).</p>
      <nav className="chips" aria-label="Filter">
        {FILTERS.map((x) => (
          <Link key={x.key} href={`/requests/all?view=${x.key}`} className="chip" aria-pressed={f.key === x.key}>
            {x.label} <span className="count">{rows.filter((r) => x.tones.includes(r.vd.tone)).length}</span>
          </Link>
        ))}
      </nav>
      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Customer</th><th>Invoice</th><th style={{ textAlign: "right" }}>Requested</th><th style={{ textAlign: "right" }}>Received</th><th>Status</th><th>What happened</th><th>Updated</th></tr></thead>
            <tbody>
              {shown.map(({ v, vd }) => (
                <tr key={v.request.id}>
                  <td><Link href={`/requests/${v.request.id}`}><strong>{v.request.customerRef}</strong></Link></td>
                  <td className="faint">{v.request.invoiceRef}</td>
                  <td className="amount" style={{ textAlign: "right" }}>{formatUsdc(v.request.amount)} <span className="faint">{v.request.token}</span></td>
                  <td className="amount" style={{ textAlign: "right" }}>{v.received === "0" && v.pending === "0" ? <span className="faint">—</span> : formatUsdc(v.received)}{v.pending !== "0" && <span className="faint"> +{formatUsdc(v.pending)}</span>}</td>
                  <td><TonePill tone={vd.tone} label={vd.status} /></td>
                  <td className="muted" style={{ whiteSpace: "normal", minWidth: 220 }}>{vd.title}</td>
                  <td className="faint">{formatTime(lastActivity(v))}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="muted">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
