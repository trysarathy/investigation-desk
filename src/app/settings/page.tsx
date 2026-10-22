import Link from "next/link";
import { Mono } from "@/components/Mono";
import { Status } from "@/components/Status";
import { ADDRESSES_UPLOADED_AT, FILE_A, FILE_B, LEDGER_UPLOADED_AT, SAMPLE_SETTINGS } from "@/lib/fixtures";
import { formatTime } from "@/lib/format";
import { CHAIN_NAMES, DEPOSIT_CHAINS, type Token } from "@/lib/types";

const TABS = [
  { key: "data", label: "Data" },
  { key: "rules", label: "Rules" },
  { key: "team", label: "Team" },
  { key: "audit", label: "Audit log" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "data" } = await searchParams;
  const s = SAMPLE_SETTINGS;

  return (
    <div className="page">
      <h1>Settings</h1>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/settings?tab=${t.key}`} className="tab" aria-current={tab === t.key ? "page" : undefined}>{t.label}</Link>
        ))}
      </nav>

      {tab === "data" && (
        <section className="panel table-wrap">
          <table className="table">
            <thead><tr><th>File</th><th>Last upload</th><th style={{ textAlign: "right" }}>Rows</th><th>Errors</th></tr></thead>
            <tbody>
              <tr style={{ cursor: "default" }}><td>A · Deposit addresses</td><td>{formatTime(ADDRESSES_UPLOADED_AT)}</td><td className="num" style={{ textAlign: "right" }}>{FILE_A.length}</td><td><Status status="pass" label="None" /></td></tr>
              <tr style={{ cursor: "default" }}><td>B · Deposit ledger</td><td>{formatTime(LEDGER_UPLOADED_AT)}</td><td className="num" style={{ textAlign: "right" }}>{FILE_B.length}</td><td><Status status="pass" label="None" /></td></tr>
              <tr style={{ cursor: "default" }}><td>C · Customers (optional)</td><td className="faint">Not uploaded</td><td className="num faint" style={{ textAlign: "right" }}>—</td><td className="faint">—</td></tr>
            </tbody>
          </table>
          <p className="faint" style={{ margin: 0, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>Sample files. Upload and row-level validation arrive in build week 4.</p>
        </section>
      )}

      {tab === "rules" && (
        <>
          <section className="panel">
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
              <h2>Rules</h2><span className="mono muted">{s.version}</span>
            </div>
            <dl className="kv">
              <dt>Confirmation thresholds</dt>
              <dd>{DEPOSIT_CHAINS.map((c) => `${CHAIN_NAMES[c]} ${s.confirmations[c]}`).join(" · ")}</dd>
              <dt>Minimum deposit</dt>
              <dd>{DEPOSIT_CHAINS.map((c) => {
                const m = Object.entries(s.minimums[c]);
                return `${CHAIN_NAMES[c]} ${m.length ? m.map(([t, v]) => `${v} ${t}`).join(", ") : "not set"}`;
              }).join(" · ")}</dd>
              <dt>Below-minimum policy</dt>
              <dd>{s.belowMinimumPolicy}</dd>
              <dt>Retired-address policy</dt>
              <dd>{s.retiredAddressPolicy} <span className="faint">(D18 next step)</span></dd>
              <dt>Where credits appear in the app</dt>
              <dd>{s.whereInApp} <span className="faint">(D13 reply)</span></dd>
              <dt>Keys held on other EVM chains</dt>
              <dd>{s.keysHeldOnOtherChains ? "Yes" : "No"} <span className="faint">(decides the D04 next step)</span></dd>
            </dl>
          </section>
          <section className="panel table-wrap">
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><h2>Token allowlist and official contracts</h2></div>
            <table className="table">
              <thead><tr><th>Chain</th><th>Token</th><th>Official contract</th><th>Accepted</th></tr></thead>
              <tbody>
                {DEPOSIT_CHAINS.flatMap((c) => (["USDT", "USDC"] as Token[]).map((t) => {
                  const official = s.officialContracts[c]?.[t];
                  const accepted = s.acceptedTokens[c].some((a) => a.symbol === t);
                  return (
                    <tr key={`${c}-${t}`} style={{ cursor: "default" }}>
                      <td>{CHAIN_NAMES[c]}</td>
                      <td>{t}</td>
                      <td>{official ? <Mono value={official} head={8} tail={8} /> : <Status status="warn" label="Not set: confirm on the issuer's official page" />}</td>
                      <td>{accepted ? <Status status="pass" label="Yes" /> : <span className="faint">No</span>}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
            <p className="faint" style={{ margin: 0, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
              Only the two contracts verified in the spec's sources are set. D06 does not run for a pair without a confirmed official contract. Editing and rule versioning arrive in build week 5.
            </p>
          </section>
        </>
      )}

      {(tab === "team" || tab === "audit") && (
        <section className="panel" style={{ padding: 24 }}>
          <p className="muted" style={{ margin: 0 }}>{tab === "team" ? "Members and roles" : "The append-only audit log"} arrive with authentication in build week 5.</p>
        </section>
      )}
    </div>
  );
}
