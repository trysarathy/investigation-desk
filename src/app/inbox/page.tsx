import Link from "next/link";
import { ActingAs, ActorLink } from "@/components/ActingAs";
import { RoutesEditor } from "@/components/RoutesEditor";
import { Status } from "@/components/Status";
import { formatTime } from "@/lib/format";
import { STATUS_LABELS, type InboxItem, type InboxStatus } from "@/lib/payments/inbox";
import { paymentsStore, refreshInbox } from "@/lib/payments/live";
import { resolvePaymentRef } from "@/lib/payments/match";
import { codeLabel } from "@/lib/payments/view";

// Recomputed on every visit: deadlines and grace periods move with the clock.
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "active", label: "Active" }, { key: "open", label: "Open" }, { key: "awaiting_provider", label: "Awaiting provider" },
  { key: "under_review", label: "Under review" }, { key: "reopened", label: "Reopened" }, { key: "closed", label: "Closed" }, { key: "all", label: "All" },
];
const FAMILIES = [{ key: "", label: "All kinds" }, { key: "payment", label: "Payment exceptions" }, { key: "review", label: "Matching reviews" }, { key: "deposit", label: "Deposit investigations" }];
const STATUS_ICON: Record<InboxStatus, "warn" | "info" | "pass" | "fail"> = { open: "warn", awaiting_provider: "info", under_review: "info", closed: "pass", reopened: "fail" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ view?: string; family?: string }> }) {
  const { view = "active", family = "" } = await searchParams;
  const inbox = await refreshInbox();
  const result = (await paymentsStore().load()).match?.result;
  const all = Object.values(inbox.items);
  const counts = Object.fromEntries(VIEWS.map((v) => [v.key, all.filter((i) => v.key === "all" || (v.key === "active" ? i.status !== "closed" : i.status === v.key)).length]));
  const items = all
    .filter((i) => view === "all" || (view === "active" ? i.status !== "closed" : i.status === view))
    .filter((i) => !family || i.family === family)
    .sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || (a.confidence === "High" ? 0 : 1) - (b.confidence === "High" ? 0 : 1) || (a.lastSeen < b.lastSeen ? 1 : -1));
  const q = (o: Record<string, string>) => `/inbox?${new URLSearchParams({ view, ...(family ? { family } : {}), ...o })}`;
  const subject = (i: InboxItem) => {
    if (i.subject.kind === "payment") {
      const now = result ? resolvePaymentRef(result, i.subject.paymentId).payment?.paymentId : undefined;
      return <Link href={`/payments/${i.subject.paymentId}`} className="mono">{now ?? i.subject.paymentId}{now && now !== i.subject.paymentId ? ` (was ${i.subject.paymentId})` : ""}</Link>;
    }
    if (i.subject.kind === "case") return <Link href={i.subject.href} className="mono">{i.subject.caseId}</Link>;
    return <span className="mono faint">record</span>;
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inbox</h1>
        <ActorLink href="/api/payments/export.csv" className="btn btn-sm">Export reconciled CSV</ActorLink>
      </div>
      <ActingAs />
      <p className="muted" style={{ margin: 0 }}>
        Filled by every matching run: payment exceptions, matching reviews and deposit investigations. An exception closes by itself when its condition goes away;
        a closed one reopens when its evidence changes, or when a later contradiction arrives on the same payment.
      </p>
      <nav className="chips" aria-label="Status">
        {VIEWS.map((v) => <Link key={v.key} href={q({ view: v.key })} className="chip" aria-pressed={view === v.key}>{v.label} <span className="count">{counts[v.key]}</span></Link>)}
      </nav>
      <nav className="chips" aria-label="Kind">
        {FAMILIES.map((f) => <Link key={f.key} href={`/inbox?${new URLSearchParams({ view, ...(f.key ? { family: f.key } : {}) })}`} className="chip" aria-pressed={family === f.key}>{f.label}</Link>)}
      </nav>
      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Item</th><th>Kind</th><th>What</th><th>Subject</th><th>Confidence</th><th>Status</th><th>Owner</th><th>Follow up</th><th>Last seen</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.itemId}>
                  <td><Link href={`/inbox/${encodeURIComponent(i.itemId)}`} className="mono">{i.itemId}</Link></td>
                  <td>{codeLabel(i)}{i.sample && <span className="badge" style={{ marginLeft: 6 }}>Sample</span>}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 320 }}>{i.title}</td>
                  <td>{subject(i)}</td>
                  <td>{i.confidence ?? "—"}</td>
                  <td><Status status={STATUS_ICON[i.status]} label={STATUS_LABELS[i.status]} /></td>
                  <td>{i.owner ?? <span className="faint">—</span>}</td>
                  <td>{i.followUp ?? <span className="faint">—</span>}</td>
                  <td className="faint">{formatTime(i.lastSeen)}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={9} className="muted">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <RoutesEditor settings={inbox.settings} />
    </div>
  );
}
