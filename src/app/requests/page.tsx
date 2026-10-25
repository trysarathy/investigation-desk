import Link from "next/link";
import { AutoRefresh } from "@/components/requests/AutoRefresh";
import { LoadDemoButton, PlayPayment, ReloadDemo } from "@/components/requests/DemoControls";
import { DemoBadge, TonePill } from "@/components/requests/StatePill";
import { isDemoMode } from "@/lib/mode";
import { formatUsdc } from "@/lib/requests/lifecycle";
import { verdict } from "@/lib/requests/present";
import { loadRequests } from "@/lib/requests/service";
import { formatMinutes, glance, MINUTES_PER_AUTO_MATCH, MINUTES_PER_EXCEPTION } from "@/lib/requests/ui";

export const dynamic = "force-dynamic";

/** The first screen: what the product does, in one line, and this week at a glance. */
export default async function AtAGlance() {
  const { data, views } = await loadRequests();
  const demoMode = isDemoMode();
  const g = glance(data, views, Date.now());
  const acme = views.find((v) => v.request.id === "DEMO-1041");
  const acmeTone = acme ? verdict(data, acme) : undefined;
  const fern = views.find((v) => v.request.id === "DEMO-1046" && v.request.demo);
  const fernTone = fern ? verdict(data, fern) : undefined;
  const hasDemo = views.some((v) => v.request.demo);

  return (
    <div className="page glance">
      <AutoRefresh ms={5000} />
      <section className="hero" aria-label="What this does">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <h1>Get paid in stablecoins without the mess.</h1>
          {hasDemo && <DemoBadge />}
        </div>
        <p className="hero-sub">Every request tells the sender exactly what to send, where and on which network. Every payment is matched, checked and explained for you.</p>
        {hasDemo && (
          <ul className="outcomes" aria-label="Outcomes">
            <li><strong>{g.paidAuto} of {g.arrived} payments</strong><span>that arrived this week were matched and marked paid with no one touching them</span></li>
            <li><strong>Minutes, not hours</strong><span>per exception: the evidence, the likely cause and the customer reply are ready when you open it <em>(demo estimate)</em></span></li>
            <li><strong>Before it&apos;s sent</strong><span>the payment page catches look-alike scam addresses while the customer can still stop</span></li>
          </ul>
        )}
      </section>

      {views.length === 0 ? (
        <section className="panel" style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>No payment requests yet</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
            {demoMode ? "Load the demo: a fictional business's week of stablecoin invoice payments, with every kind of problem a finance team meets. All demo data, all offline."
              : "Create a request to get a payment link for your customer. Or load the demo: a fictional business's week, with simulated transfers."}
          </p>
          <div style={{ display: "flex", gap: 8 }}><LoadDemoButton /><Link className="btn" href="/requests/new">New request</Link></div>
        </section>
      ) : (
        <>
          <section className="kpis" aria-label="This week">
            <div className="kpi"><span className="k">Requests sent</span><span className="v">{g.sent}</span><span className="s">this week</span></div>
            <div className="kpi kpi-paid"><span className="k">Paid automatically</span><span className="v">{g.paidAuto}</span><span className="s">of {g.arrived} payments that arrived</span></div>
            <div className="kpi kpi-attention"><span className="k">Need attention</span><span className="v">{g.attention.length}</span><span className="s">listed below, most urgent first</span></div>
            <div className="kpi"><span className="k">Received this week</span><span className="v v-sm">{g.received.map((x) => <span key={x}>{x}</span>)}</span>
              <span className="s">of {g.requested.join(" + ")} requested{g.toRefund !== "0" ? ` · incl. ${formatUsdc(g.toRefund)} USDC to refund` : ""}</span></div>
            <div className="kpi kpi-estimate"><span className="k">Time saved · demo estimate</span><span className="v">~{formatMinutes(g.minutesSaved)}</span>
              <span className="s">{g.paidAuto} auto-matched × {MINUTES_PER_AUTO_MATCH} min + {g.attention.length} explained × {MINUTES_PER_EXCEPTION} min</span></div>
          </section>

          {acme && acmeTone && (
            <section className="panel" aria-label="Live: a routine payment">
              <div className="panel-b" style={{ flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "10px 16px" }}>
                <span className="eyebrow">Arriving now</span>
                <TonePill tone={acmeTone.tone} label={acmeTone.status} />
                <Link href={`/requests/${acme.request.id}`}><strong>{acme.request.customerRef}</strong> <span className="faint">{acme.request.invoiceRef}</span></Link>
                <span className="amount">{formatUsdc(acme.request.amount)} {acme.request.token}</span>
                <span className="muted" style={{ flex: "1 1 200px" }}>{acmeTone.title}</span>
                {acme.state === "awaiting_payment" && acme.request.demo && <PlayPayment />}
              </div>
              {fern && fernTone && fernTone.tone === "waiting" && (
                <div className="panel-b" style={{ flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
                  <span className="eyebrow">About to pay</span>
                  <TonePill tone={fernTone.tone} label={fernTone.status} />
                  <Link href={`/requests/${fern.request.id}`}><strong>{fern.request.customerRef}</strong> <span className="faint">{fern.request.invoiceRef}</span></Link>
                  <span className="amount">{formatUsdc(fern.request.amount)} {fern.request.token}</span>
                  <span className="muted" style={{ flex: "1 1 200px" }}>&ldquo;I&apos;ll use the address from last time.&rdquo;</span>
                  <a className="btn" href={`/pay/${fern.request.publicId}`} target="_blank" rel="noreferrer" data-testid="fernhill-sender">Open their payment page ↗</a>
                </div>
              )}
            </section>
          )}

          <section className="panel" aria-labelledby="attn-h">
            <div className="panel-h"><h2 id="attn-h">Needs attention</h2><span className="faint">{g.attention.length ? "most urgent first" : "nothing"}</span></div>
            {g.attention.length === 0 ? <div className="panel-b muted">Nothing needs a person right now.</div> : (
              <ul className="attn">
                {g.attention.map((a) => (
                  <li key={a.href}>
                    <Link href={a.href} className="attn-row" data-testid="attention-item">
                      <TonePill tone={a.tone} label={a.status} />
                      <span className="attn-who"><strong>{a.who}</strong> <span className="faint">{a.ref}</span></span>
                      <span className="attn-title">{a.title}</span>
                      <span className="amount attn-amt">{a.amount}</span>
                      <span className="attn-go" aria-hidden>→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="btn" href="/requests/all">All requests</Link>
            <Link className="btn" href="/requests/new">New request</Link>
            <span style={{ flex: 1 }} />
            {hasDemo && <ReloadDemo />}
          </div>
        </>
      )}
    </div>
  );
}
