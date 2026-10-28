import Link from "next/link";
import { notFound } from "next/navigation";
import { Status } from "@/components/Status";
import { ConfirmMatch } from "@/components/requests/RequestActions";
import { DemoBadge, TonePill } from "@/components/requests/StatePill";
import { CONFIRMATIONS } from "@/lib/requests/check";
import { formatUsdc, suggestMatches, walletOf } from "@/lib/requests/lifecycle";
import { shortAddr, shortHash } from "@/lib/requests/present";
import { requestsStore } from "@/lib/requests/service";
import { friendlyTime, possessive } from "@/lib/requests/ui";

export const dynamic = "force-dynamic";

/** An unidentified payment: money that arrived with nothing on-chain saying which invoice it pays. */
export default async function UnidentifiedPayment({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const data = await requestsStore().load();
  const o = data.observations[decodeURIComponent(key)];
  if (!o) notFound();
  const matchedTo = o.attribution.kind === "request" ? data.requests[o.attribution.requestId] : undefined;
  const wallet = walletOf(data, o.chain, o.to, o.demo);
  const suggestions = o.attribution.kind === "none" ? suggestMatches(data, o, CONFIRMATIONS) : [];
  const top = suggestions[0];
  const note = "";

  return (
    <div className="page case">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="faint" style={{ fontSize: 12 }}><Link href="/requests">At a glance</Link> / Unidentified payment</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>{formatUsdc(o.amount)} {o.tokenSymbol} <span className="faint" style={{ fontWeight: 400 }}>with no reference</span></h1>
            {matchedTo ? <TonePill tone="paid" label="Matched" /> : <TonePill tone="attention" label="Unidentified" />}
            {o.demo && <DemoBadge />}
          </div>
        </div>
      </div>

      <div className="cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className={`verdict tone-box-${matchedTo ? "paid" : "attention"}`} data-testid="verdict">
            <div className="eyebrow">What happened</div>
            {matchedTo ? (
              <>
                <h2>Matched to {matchedTo.customerRef} · {matchedTo.invoiceRef}</h2>
                <p>{o.attribution.kind === "request" ? o.attribution.reason : ""}</p>
                <Link className="btn btn-primary" href={`/requests/${matchedTo.id}`} style={{ alignSelf: "flex-start" }}>Open {matchedTo.invoiceRef} →</Link>
              </>
            ) : (
              <>
                <h2>{top ? `Most likely ${possessive(top.request.customerRef)} ${top.request.invoiceRef}` : "No likely match"}</h2>
                <p>
                  {formatUsdc(o.amount)} {o.tokenSymbol} arrived at {wallet?.label ?? shortAddr(o.to)}. No open request uses that address, and a blockchain
                  transfer carries no invoice number, so the address can&apos;t say which invoice this pays. {top ? "The evidence below points to one invoice. A person confirms it: the product never matches on a guess." : "Nothing in the records points to an invoice yet."}
                </p>
              </>
            )}
          </section>

          {!matchedTo && suggestions.map((s, i) => (
            <section key={s.request.id} className="panel" data-testid="suggestion">
              <div className="panel-h">
                <h2>{i === 0 ? "Suggested match" : "Also possible"}: {s.request.customerRef} <span className="faint" style={{ fontWeight: 400 }}>{s.request.invoiceRef} · {formatUsdc(s.request.amount)} {s.request.token}</span></h2>
                <span className={`score score-${s.confidence.toLowerCase()}`} title={`Score ${s.score}/100 from the signals below. Not a probability: a person confirms.`} data-testid="score">{s.confidence} match · {s.signals.filter((x) => x.ok).length} of {s.signals.length} signals</span>
              </div>
              <ul className="signals">
                {s.signals.map((x) => (
                  <li key={x.label} className={x.ok ? "ok" : "no"}><span aria-hidden>{x.ok ? "✓" : "–"}</span><span>{x.label}</span><span /></li>
                ))}
              </ul>
              {i === 0 && (
                <div className="panel-b" style={{ borderTop: "1px solid var(--border)" }}>
                  <ConfirmMatch obsKey={o.key} requestId={s.request.id} label={`Confirm: this pays ${s.request.invoiceRef}`} suggestedNote={note} />
                  <Link href={`/requests/${s.request.id}`} style={{ fontSize: 12 }}>See {s.request.invoiceRef} and {possessive(s.request.customerRef)} message</Link>
                </div>
              )}
            </section>
          ))}

          <section className="panel">
            <div className="panel-h"><h2>What this can&apos;t tell you</h2></div>
            <ul className="panel-b" style={{ margin: 0, paddingLeft: 32 }}>
              <li>Which invoice the sender meant: the chain records addresses and amounts, not invoice numbers.</li>
              <li>Who controls the sending address. &ldquo;Paid from before&rdquo; means the same address paid an earlier invoice of this customer.</li>
              {o.source === "simulated" && <li>This is a simulated demo transfer: no blockchain was asked.</li>}
            </ul>
          </section>
        </div>

        <aside className="side">
          <section className="panel">
            <div className="panel-h"><h2>The payment</h2></div>
            <dl className="kv">
              <dt>Amount</dt><dd className="amount">{formatUsdc(o.amount)} {o.tokenSymbol}</dd>
              <dt>Token</dt><dd><Status status="pass" label={`Genuine ${o.tokenSymbol}`} /></dd>
              <dt>Network</dt><dd>Ethereum</dd>
              <dt>Arrived</dt><dd>{friendlyTime(o.blockTime ?? o.firstSeenAt)}</dd>
              <dt>To</dt><dd><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{o.to}</span>{wallet && <div className="faint" style={{ fontSize: 12 }}>{wallet.label}</div>}</dd>
              <dt>From</dt><dd className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{o.from}</dd>
              <dt>Transaction</dt><dd className="mono" style={{ fontSize: 12 }} title={o.source === "simulated" ? "A fictional demo transaction" : undefined}>{shortHash(o.hash)}</dd>
              <dt>Confirmations</dt><dd>{Math.min(o.confirmations, CONFIRMATIONS)} of {CONFIRMATIONS}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
