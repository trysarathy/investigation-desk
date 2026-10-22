import { companySettings } from "@/lib/platform/settings";
import {
  saveInvestigation,
  documents,
  type CaseRecord,
} from "@/lib/platform/store";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Mono } from "@/components/Mono";
import { Investigation } from "@/components/Investigation";
import { Status } from "@/components/Status";
import { fetchFacts } from "@/lib/chain/investigate";
import { liveDeps, liveKeysPresent } from "@/lib/chain/live";
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
export default async function InvestigatePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; customer?: string }>;
}) {
  const { q = "", customer } = await searchParams;
  const match = q.trim() ? resolveInput(q) : undefined;
  if (match) redirect(`/cases/${match.id}`);
  const input = normaliseInput(q);

  const reporting = parseReportingCustomer(customer);
  const { ws, missing, data } = await loadWorkspace(reporting.customerId);
  const demo = !!data.demo;
  const settings = companySettings(demo);
  if (
    input.kind === "hash" &&
    (liveKeysPresent() || demo) &&
    ws &&
    settings &&
    !reporting.error
  ) {
    const facts = await fetchFacts(
      q,
      ws,
      demo ? demoDeps() : liveDeps(),
      settings,
    );
    const view = await liveCaseView(facts, demo, settings);
    const record = saveInvestigation(facts, settings, view, demo);
    redirect(`/library/${record.id}`);
  }

  if (q.trim() && input.kind !== "hash") {
    const results = documents<CaseRecord>("case").filter(
      (c) =>
        c.facts.customerId === q.trim() ||
        c.facts.tx?.transfers.some(
          (t) =>
            t.to.toLowerCase() === q.trim().toLowerCase() ||
            t.from.toLowerCase() === q.trim().toLowerCase(),
        ),
    );
    if (results.length)
      return (
        <div className="page">
          <div className="page-head">
            <h1>Matching investigations</h1>
            <span className="muted">{results.length} stored cases</span>
          </div>
          {results.map((c) => (
            <Link
              className="panel search-result"
              href={`/library/${c.id}`}
              key={c.id}
            >
              <strong>{c.view.verdicts.at(-1)?.label}</strong>
              <span className="mono muted">{c.facts.input.value}</span>
            </Link>
          ))}
        </div>
      );
    const assigned =
      data.fileA?.rows.filter(
        (a) =>
          a.customerId.toLowerCase() === q.trim().toLowerCase() ||
          a.address.toLowerCase() === q.trim().toLowerCase(),
      ) ?? [];
    const ledger =
      data.fileB?.rows.filter(
        (r) =>
          r.customerId.toLowerCase() === q.trim().toLowerCase() ||
          r.toAddress.toLowerCase() === q.trim().toLowerCase(),
      ) ?? [];
    if (assigned.length || ledger.length)
      return (
        <div className="page">
          <div className="page-head">
            <div>
              <span className="eyebrow">Company records</span>
              <h1>Choose the payment to investigate</h1>
              <p className="muted">
                An address or customer can have many transfers. A verdict
                requires a specific payment.
              </p>
            </div>
          </div>
          <section className="panel padded">
            <h2>Ledger matches</h2>
            {ledger.length ? (
              ledger.slice(0, 100).map((r) => (
                <div className="search-result" key={r.row}>
                  <strong>
                    {r.amount} {r.token} · {r.status}
                  </strong>
                  <span className="muted">
                    File B row {r.row} · {r.chain}
                  </span>
                  {r.txHash ? (
                    <Link
                      href={`/investigate?${new URLSearchParams({ q: r.txHash, customer: r.customerId })}`}
                    >
                      Investigate transaction ↗
                    </Link>
                  ) : (
                    <span>No transaction hash in this record</span>
                  )}
                </div>
              ))
            ) : (
              <p className="muted">
                No matching ledger rows. This does not establish non-arrival.
              </p>
            )}
          </section>
          <section className="panel padded">
            <h2>Assigned addresses</h2>
            {assigned.map((a) => (
              <div className="search-result" key={a.row}>
                <span className="mono wrap-anywhere">{a.address}</span>
                <span className="muted">
                  {a.chain} · File A row {a.row}
                </span>
              </div>
            ))}
            <Link href="/scan">Scan public address history ↗</Link>
          </section>
        </div>
      );
  }
  const reason = !settings
    ? "Set your company deposit policy in Settings → Rules before diagnosing live deposits."
    : reporting.error
      ? reporting.error
      : input.kind !== "hash"
        ? "No stored investigations match this address or customer reference. Use Company Scan for public address history, or paste a transaction hash."
        : !liveKeysPresent()
          ? "Live chain lookups need TRONGRID_API_KEY and ETHERSCAN_API_KEY in the server environment."
          : `Upload ${missing.map((m) => `File ${m}`).join(" and ")} in Settings → Data first, or load the demo workspace there: without the company's files no address or ledger verdict can be given.`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>New case</h1>
        <Link className="btn" href="/">
          Back <span className="kbd">Esc</span>
        </Link>
      </div>
      <div className="verdict-bar paused" role="status">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="verdict-title">Check paused</div>
          <div className="muted">{reason} No verdict is given.</div>
        </div>
      </div>
      <section className="panel">
        <dl className="kv">
          <dt>Input</dt>
          <dd>
            {q.trim() ? (
              <Mono value={q.trim()} head={10} tail={10} />
            ) : (
              <span className="faint">Nothing pasted</span>
            )}
          </dd>
          <dt>Detected as</dt>
          <dd>{q.trim() ? KIND_LABEL[input.kind] : "—"}</dd>
          <dt>Chains to check</dt>
          <dd>
            {input.kind === "hash"
              ? "Tron, Ethereum, BNB Chain, then Polygon, Base, Arbitrum, Optimism"
              : input.kind === "tron_address"
                ? "Tron"
                : input.kind === "evm_address"
                  ? "Ethereum, BNB Chain"
                  : "Looked up in File A"}
          </dd>
          <dt>Status</dt>
          <dd>
            <Status status="warn" label="Not checked" />
          </dd>
        </dl>
      </section>
    </div>
  );
}
