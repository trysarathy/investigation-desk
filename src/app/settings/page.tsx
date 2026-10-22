import Link from "next/link";
import { Mono } from "@/components/Mono";
import { Status } from "@/components/Status";
import { COMPANY_CONTRACT_LABEL, COMPANY_DECLARED_CHAINS, officialContractFor } from "@/lib/contracts";
import { UploadPanel } from "@/components/UploadPanel";
import { DemoPanel } from "@/components/DemoPanel";
import { DEMO_STEPS } from "@/lib/demo/files";
import { demoModeOn } from "@/lib/demo/reset";
import { loadWorkspace } from "@/lib/workspace/live";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { CHAIN_NAMES, DEPOSIT_CHAINS, type Token } from "@/lib/types";

const TABS = [
  { key: "data", label: "Data" },
  { key: "rules", label: "Rules" },
  { key: "team", label: "Team" },
  { key: "audit", label: "Audit log" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "data" } = await searchParams;
  const { data: workspace } = await loadWorkspace();
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
        <>
          <p className="muted" style={{ margin: 0 }}>
            Live investigations (pasted hashes and bulk runs) use these files. The sample cases in the queue keep their own sample data.
          </p>
          <DemoPanel active={!!workspace.demo} preview={demoModeOn()} steps={DEMO_STEPS} />
          {demoModeOn() ? (
            <p className="muted" style={{ margin: 0 }}>Uploads are off on this demo preview (DEMO_MODE=1), so it never holds real customer data.</p>
          ) : (
            <>
              <UploadPanel kind="A" current={workspace.demo ? undefined : workspace.fileA?.upload} />
              <UploadPanel kind="B" current={workspace.demo ? undefined : workspace.fileB?.upload} />
            </>
          )}
          <p className="faint" style={{ margin: 0 }}>
            UTF-8, one header row, column names exactly as listed. Amounts are exact decimals, timestamps carry an offset.
            Rows that break a rule are rejected and listed, never fixed. Uploading an identical file changes nothing.
            File C (customers) is optional and not needed.
          </p>
        </>
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
                  const resolved = officialContractFor(c, t, s);
                  const accepted = s.acceptedTokens[c].find((a) => a.symbol === t);
                  return (
                    <tr key={`${c}-${t}`} style={{ cursor: "default" }}>
                      <td>{CHAIN_NAMES[c]}</td>
                      <td>{t}</td>
                      <td>
                        {resolved ? <><Mono value={resolved.contract} head={8} tail={8} />
                          {resolved.source === "company" && <span className="faint"> {COMPANY_CONTRACT_LABEL}{resolved.note ? `, ${resolved.note}` : ""}</span>}</>
                          : COMPANY_DECLARED_CHAINS.has(c)
                            ? <span className="faint">None declared by the company</span>
                            : <Status status="warn" label="Not set: confirm on the issuer's official page" />}
                      </td>
                      <td>{accepted ? <Status status="pass" label={accepted.note ? `Yes (${accepted.note})` : "Yes"} /> : <span className="faint">No</span>}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
            <p className="faint" style={{ margin: 0, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
              Issuer contracts are set only where confirmed on Tether's or Circle's own pages. On BNB Chain neither issuer lists one, so the company's declared contract stands in. D06 does not run for a pair with neither. Editing and rule versioning arrive in build week 5.
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
