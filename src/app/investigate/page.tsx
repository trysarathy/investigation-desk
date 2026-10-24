import Link from "next/link";
import { redirect } from "next/navigation";
import { Mono } from "@/components/Mono";
import { Investigation } from "@/components/Investigation";
import { Status } from "@/components/Status";
import { fetchFacts } from "@/lib/chain/investigate";
import { liveDeps, liveLookupsEnabled } from "@/lib/chain/live";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { loadWorkspace } from "@/lib/workspace/live";
import { parseReportingCustomer } from "@/lib/csv/files";
import { demoDeps } from "@/lib/demo/deps";
import { normaliseInput } from "@/lib/normalise";
import { liveCaseView, resolveInput } from "@/lib/view";

const KIND_LABEL = {
  hash: "Transaction hash",
  tron_address: "Tron address",
  evm_address: "EVM address",
  customer_ref: "Customer reference",
  unrecognised: "Unrecognised reference (possibly an exchange withdrawal ID)",
} as const;

/**
 * Pasted input lands here: open the matching sample case, or look a hash up live on every
 * supported chain against the company's uploaded Files A and B. `customer` is optional; without
 * it, File A's owner of the destination at block time is used, and the case says so.
 */
export default async function InvestigatePage({ searchParams }: { searchParams: Promise<{ q?: string; customer?: string }> }) {
  const { q = "", customer } = await searchParams;
  const match = q.trim() ? resolveInput(q) : undefined;
  if (match) redirect(`/cases/${match.id}`);
  const input = normaliseInput(q);

  const reporting = parseReportingCustomer(customer);
  const { ws, missing, data } = await loadWorkspace(reporting.customerId);
  const demo = !!data.demo;
  if (input.kind === "hash" && (liveLookupsEnabled() || demo) && ws && !reporting.error) {
    const facts = await fetchFacts(q, ws, demo ? demoDeps() : liveDeps(), SAMPLE_SETTINGS);
    const view = await liveCaseView(facts, demo);
    return <Investigation key={`${view.id}-${facts.checkedAt}-${reporting.customerId ?? ""}`} view={view} />;
  }

  const reason = reporting.error ? reporting.error : input.kind !== "hash"
    ? "Live lookup by address or customer reference is not built yet; paste a transaction hash."
    : !liveLookupsEnabled()
      ? "Live chain lookups are turned off on this server (LIVE_LOOKUPS=off)."
      : `Upload ${missing.map((m) => `File ${m}`).join(" and ")} in Settings → Data first, or load the demo workspace there: without the company's files no address or ledger verdict can be given.`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>New case</h1>
        <Link className="btn" href="/">Back <span className="kbd">Esc</span></Link>
      </div>
      <div className="verdict-bar paused" role="status">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="verdict-title">Check paused</div>
          <div className="muted">
            {reason} No verdict is given.
          </div>
        </div>
      </div>
      <section className="panel">
        <dl className="kv">
          <dt>Input</dt>
          <dd>{q.trim() ? <Mono value={q.trim()} head={10} tail={10} /> : <span className="faint">Nothing pasted</span>}</dd>
          <dt>Detected as</dt>
          <dd>{q.trim() ? KIND_LABEL[input.kind] : "—"}</dd>
          <dt>Chains to check</dt>
          <dd>{input.kind === "hash" ? "Tron, Ethereum, BNB Chain, then Polygon, Base, Arbitrum, Optimism" : input.kind === "tron_address" ? "Tron" : input.kind === "evm_address" ? "Ethereum, BNB Chain" : "Looked up in File A"}</dd>
          <dt>Status</dt>
          <dd><Status status="warn" label="Not checked" /></dd>
        </dl>
      </section>
    </div>
  );
}
