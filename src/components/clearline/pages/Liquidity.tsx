"use client";
import { computeLiquidity, formatMinor, type CurrencyCode } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { Chip, Code, Notice, PageHead, Panel, fmtTime, ui } from "../ui";

export default function Liquidity() {
  const { ws } = useWorkspace();
  const v = computeLiquidity(ws);
  const usable = Object.entries(v.currentUsableByCurrency) as [CurrencyCode, number][];
  return (
    <>
      <PageHead eyebrow="Control" title="Liquidity"
        lede={<>Reported balances from sandbox provider statements, and what is usable under the policy below. As of <span className="num">{fmtTime(v.asOf)}</span>.</>} />
      <Notice>
        <strong>Policy: {v.policy.label}</strong> — defined by {v.policy.definedBy}. Buffer {v.policy.bufferBps / 100}% (with minimums); snapshots older than {v.policy.maxAgeMinutes} minutes are stale and excluded from usable totals. This is an illustrative provider-defined policy, not a regulatory classification.
      </Notice>
      <Panel title="Usable now, by currency (fresh snapshots only)" id="usable">
        <div className={ui.panelBody}>
          <dl className={ui.dl}>
            {usable.length === 0 ? <div><dt>Usable</dt><dd>No fresh snapshots</dd></div> :
              usable.map(([c, m]) => <div key={c}><dt>{c}</dt><dd className="num"><strong>{formatMinor(m, c)}</strong></dd></div>)}
          </dl>
          {v.staleExcluded.length > 0 && <p className={ui.hint}>Excluded as stale: {v.staleExcluded.join(", ")}. Currencies are never added together.</p>}
        </div>
      </Panel>
      <Panel title="Provider balances" id="balances">
        <div className={ui.tableWrap}>
          <table className={`${ui.table} ${ui.stack}`}>
            <thead><tr><th>Provider / account</th><th>Source and as-of</th><th className={ui.r}>Reported eligible</th><th className={ui.r}>Restricted</th><th className={ui.r}>Safeguarded</th><th className={ui.r}>Committed payouts</th><th className={ui.r}>Buffer</th><th className={ui.r}>Usable</th><th>Freshness</th></tr></thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Provider / account">{r.providerId}<span className={ui.sub + " mono"}>{r.accountRef} · {r.currency}</span></td>
                  <td data-label="Source and as-of">{r.source}<span className={ui.sub}>{fmtTime(r.asOf)} · {r.ageMinutes} min old</span></td>
                  <td data-label="Reported eligible" className={`${ui.r} ${ui.num}`}>{formatMinor(r.eligibleMinor, r.currency)}</td>
                  <td data-label="Restricted" className={`${ui.r} ${ui.num}`}>{formatMinor(r.restrictedMinor, r.currency)}</td>
                  <td data-label="Safeguarded" className={`${ui.r} ${ui.num}`}>{formatMinor(r.safeguardedMinor, r.currency)}</td>
                  <td data-label="Committed payouts" className={`${ui.r} ${ui.num}`}>{formatMinor(r.committedPayoutsMinor, r.currency)}</td>
                  <td data-label="Buffer" className={`${ui.r} ${ui.num}`}>{formatMinor(r.bufferMinor, r.currency)}</td>
                  <td data-label="Usable" className={`${ui.r} ${ui.num}`}><strong>{formatMinor(r.usableMinor, r.currency)}</strong></td>
                  <td data-label="Freshness"><Chip tone={r.stale ? "warn" : "ok"}>{r.stale ? "Stale — excluded" : "Fresh"}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={ui.panelBody + " " + ui.hint} style={{ margin: 0 }}>Formula (from the engine): <Code>{v.rows[0]?.formula ?? "usable = eligible − restricted − safeguarded − committed − buffer"}</Code></p>
      </Panel>
    </>
  );
}
