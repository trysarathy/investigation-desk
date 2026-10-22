"use client";
import { useEffect, useState } from "react";
import type { ScanReport } from "@/lib/scan/types";
export function CompanyScan() {
  const [company, setCompany] = useState(""),
    [chain, setChain] = useState("ethereum"),
    [addresses, setAddresses] = useState(""),
    [days, setDays] = useState(7),
    [report, setReport] = useState<ScanReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string | null>(null),
    [page, setPage] = useState(0);
  useEffect(() => {
    if (!report || report.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/scans/${report.id}`);
        if (!r.ok) throw Error("Unable to refresh scan");
        setReport(await r.json());
      } catch (e) {
        setError((e as Error).message);
      }
    }, 700);
    return () => clearInterval(timer);
  }, [report]);
  async function start(demo = false) {
    setBusy(true);
    setError("");
    setSelected(null);
    setPage(0);
    try {
      const r = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: demo ? "Acorn Payments · fictional" : company,
          days,
          addresses: demo
            ? [{ chain: "ethereum", address: "Fictional Acorn wallet" }]
            : addresses
                .split(/\s+/)
                .filter(Boolean)
                .map((address) => ({ chain, address })),
          demo,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      setReport(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows =
      report?.transfers.filter(
        (t) => filter === "all" || t.signal === filter,
      ) ?? [],
    signals = report?.transfers.filter((t) => t.signal !== "none") ?? [],
    detail = report?.transfers.find((t) => t.id === selected);
  return (
    <div className="page scan-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Public evidence / Company Scan</div>
          <h1 className="display-title">See what reaches your wallets.</h1>
          <p className="muted">
            Surface transfer anomalies. Then connect the ledger to explain the
            last mile.
          </p>
        </div>
        <span className="badge">Read-only</span>
      </div>
      <section className="panel scan-form">
        <div>
          <h2>Scope your scan</h2>
          <p className="muted">
            No wallet connection. Public addresses only. Company ownership is
            supplied by you, not verified by this scan.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="form-grid">
            <label>
              Company label
              <input
                className="input"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company name"
                maxLength={80}
                required
              />
            </label>
            <label>
              Network
              <select
                className="input"
                value={chain}
                onChange={(e) => setChain(e.target.value)}
              >
                <option value="ethereum">Ethereum</option>
                <option value="tron">Tron</option>
                <option value="bsc">BNB Chain</option>
              </select>
            </label>
            <label>
              Lookback
              <select
                className="input"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="stack-label">
            Deposit or hot-wallet addresses
            <textarea
              className="input mono"
              rows={3}
              value={addresses}
              onChange={(e) => setAddresses(e.target.value)}
              placeholder="One public address per line · up to 5"
              required
            />
          </label>
          <div className="form-row">
            <button
              className="btn primary"
              disabled={busy || report?.status === "running"}
            >
              Scan incoming transfers <span aria-hidden>↗</span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => start(true)}
            >
              Explore fictional demo
            </button>
            <span className="muted">7–30 days · USDT / USDC</span>
          </div>
        </form>
      </section>
      {error && (
        <div className="bar bar-red" role="alert">
          {error}
        </div>
      )}
      {!report && (
        <div className="scan-principles">
          <section>
            <span className="eyebrow">01 / Observe</span>
            <h2>Follow the transfer.</h2>
            <p>
              Indexed incoming transfers with source links and hashed provider
              evidence.
            </p>
          </section>
          <section>
            <span className="eyebrow">02 / Separate</span>
            <h2>Facts before conclusions.</h2>
            <p>
              A token mismatch is a signal. A missing ledger credit needs your
              records.
            </p>
          </section>
          <section>
            <span className="eyebrow">03 / Explain</span>
            <h2>Make the next step clear.</h2>
            <p>
              Open the evidence, investigate a hash, and share a report with its
              limitations intact.
            </p>
          </section>
        </div>
      )}
      {report && (
        <>
          <div className="section-heading">
            <div>
              <h2>{report.company}</h2>
              <span className="muted">
                {report.days} days ·{" "}
                {report.demo
                  ? "Fictional demonstration"
                  : `${report.completedAddresses}/${report.addresses.length} addresses covered`}{" "}
                · {report.status}
              </span>
            </div>
            {report.status !== "running" && (
              <a className="btn" href={`/api/scans/${report.id}/pdf`}>
                Export PDF ↗
              </a>
            )}
          </div>
          {report.demo && (
            <div className="bar bar-amber">
              Fictional demo. These are invented transfers, not findings about a
              real company.
            </div>
          )}
          {report.status === "running" && (
            <div role="status">
              <progress
                max={report.addresses.length}
                value={report.completedAddresses}
              />
              <p className="muted">
                Reading indexed history · {report.pages} pages ·{" "}
                {report.transfers.length} observations. Partial results stay
                visible.
              </p>
            </div>
          )}
          {report.errors.map((e, i) => (
            <div className="bar bar-amber" key={i}>
              {e}
            </div>
          ))}
          <div className="metric-grid">
            <div className="metric">
              <span>Incoming observations</span>
              <strong>{report.transfers.length.toLocaleString()}</strong>
              <small>
                {report.status === "complete"
                  ? "Within provider coverage"
                  : "Partial coverage"}
              </small>
            </div>
            <div className="metric">
              <span>Signals to review</span>
              <strong>{signals.length}</strong>
              <small>Not confirmed payment failures</small>
            </div>
            <div className="metric">
              <span>Confirmed problem value</span>
              <strong>—</strong>
              <small>Needs policy + ledger evidence</small>
            </div>
            <div className="metric">
              <span>Customer credited?</span>
              <strong className="metric-word">Unknown</strong>
              <small>Chain arrival ≠ company credit</small>
            </div>
          </div>
          <div className="panel">
            <div className="section-heading">
              <h2>Transfer evidence</h2>
              <select
                aria-label="Filter signals"
                className="input"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All observations</option>
                <option value="contract_mismatch">
                  Contract mismatch ·{" "}
                  {
                    signals.filter((t) => t.signal === "contract_mismatch")
                      .length
                  }
                </option>
                <option value="zero_value">
                  Zero-value transfer ·{" "}
                  {signals.filter((t) => t.signal === "zero_value").length}
                </option>
                <option value="none">No scanned signal</option>
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Transfer</th>
                    <th>Amount</th>
                    <th>Observed signal</th>
                    <th>Credit status</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(page * 20, (page + 1) * 20).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <button
                          className="text-button mono"
                          onClick={() => setSelected(t.id)}
                        >
                          {t.hash.length > 24
                            ? `${t.hash.slice(0, 12)}…${t.hash.slice(-6)}`
                            : t.hash}
                        </button>
                        <div className="faint">
                          {new Date(t.at).toLocaleDateString()} · {t.chain}
                        </div>
                      </td>
                      <td className="mono">
                        {t.amount} {t.symbol}
                      </td>
                      <td>
                        <span
                          className={
                            t.signal === "none" ? "muted" : "signal-label"
                          }
                        >
                          {t.signal === "contract_mismatch"
                            ? "Contract differs from issuer list"
                            : t.signal === "zero_value"
                              ? "Zero-value transfer"
                              : "No scanned signal"}
                        </span>
                      </td>
                      <td className="muted">Not assessed</td>
                      <td>
                        {t.source ? (
                          <a href={t.source} target="_blank" rel="noreferrer">
                            Explorer ↗
                          </a>
                        ) : (
                          <span className="faint">Fictional</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 && (
                <div className="form-row" style={{ padding: 16 }}>
                  <button
                    className="btn"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span className="muted">
                    {page * 20 + 1}–{Math.min((page + 1) * 20, rows.length)} of{" "}
                    {rows.length}
                  </span>
                  <button
                    className="btn"
                    disabled={(page + 1) * 20 >= rows.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
              {!rows.length && (
                <p className="empty-note">
                  {report.status === "unavailable"
                    ? "History unavailable. This is not a clean bill of health."
                    : "No observations in this view."}
                </p>
              )}
            </div>
          </div>
          {detail && (
            <section className="panel">
              <div className="section-heading">
                <h2>Observation detail</h2>
                <button className="btn" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
              <dl className="kv">
                <dt>From</dt>
                <dd className="mono wrap-anywhere">{detail.from}</dd>
                <dt>To</dt>
                <dd className="mono wrap-anywhere">{detail.to}</dd>
                <dt>Token contract</dt>
                <dd className="mono wrap-anywhere">{detail.contract}</dd>
                <dt>Evidence SHA-256</dt>
                <dd className="mono wrap-anywhere">{detail.evidenceHash}</dd>
                <dt>Next step</dt>
                <dd>
                  {detail.signal === "contract_mismatch"
                    ? "Verify the contract and company token policy before treating this as a genuine deposit."
                    : "Join the transfer to the company ledger. Public data does not prove customer credit."}
                </dd>
              </dl>
              {!report.demo && (
                <a
                  className="btn"
                  href={`/investigate?q=${encodeURIComponent(detail.hash)}`}
                >
                  Investigate with company records
                </a>
              )}
            </section>
          )}
          <section className="panel">
            <h2>What this scan can establish</h2>
            <ul className="coverage-list">
              {report.coverage.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="muted">
              No USD loss estimate is produced: stablecoin face value, issuer
              backing and customer loss are different facts.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
