import type { ReactNode } from "react";
import {
  EXCEPTION_DUE_POLICY, FUNDING_PROJECTION_LABEL, LIQUIDITY_POLICY_LABEL, SAMPLE_EXCEPTIONS, QUOTE_LABEL, SAMPLE_FUNDING, SAMPLE_LIQUIDITY, SAMPLE_PAYMENTS,
  SAMPLE_QUOTES, SAMPLE_STATEMENT_LINES, SAMPLE_USABLE_NOW,
} from "@/lib/sample";
import { ExecStatus, ReconStatus, SettlementStatus } from "@/components/Status";

/** Scrollable, keyboard-focusable table region. The page itself never scrolls sideways. */
export function TableWrap({ label, caption, children }: { label: string; caption: string; children: ReactNode }) {
  return (
    <figure className="table-figure">
      <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
        <table className="data-table">{children}</table>
      </div>
      <figcaption className="caption">{caption}</figcaption>
    </figure>
  );
}

export function QuotesTable() {
  return (
    <TableWrap label="Sample route quotes" caption={`The engine's quotes for INV-2026-126 (SGD 24,651.37 → PHP). Every quote is labelled "${QUOTE_LABEL}" and expires after 15 minutes.`}>
      <thead><tr><th scope="col">Provider</th><th scope="col">Rail</th><th scope="col" className="r">Rate</th><th scope="col" className="r">Provider fee</th><th scope="col" className="r">Platform fee</th><th scope="col" className="r">Est. recipient</th><th scope="col">ETA</th><th scope="col">Eligibility</th></tr></thead>
      <tbody>{SAMPLE_QUOTES.map(q => (
        <tr key={q.provider + q.rail}>
          <td>{q.provider}</td><td className="mono">{q.rail}</td>
          <td className="r num">{q.rate}</td><td className="r num">{q.providerFee}</td><td className="r num">{q.platformFee}</td><td className="r num">{q.recipient}</td><td>{q.eta}</td>
          <td>{q.eligible ? <span className="st-exec tone-neutral">eligible</span> : <><span className="st-exec tone-warning">ineligible</span><span className="caption">{q.reason}</span></>}</td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}

export function ReconTable() {
  return (
    <TableWrap label="Sample statement lines and reconciliation results" caption="The engine's statement lines after the sample build. Automatic allocation only on a trusted reference + amount + currency + value-date window; everything else becomes an exception with an RC_* explanation code. Fictional bank lines.">
      <thead><tr><th scope="col">Line</th><th scope="col">Direction</th><th scope="col" className="r">Amount</th><th scope="col">Reference</th><th scope="col">Result</th><th scope="col">Explanation</th></tr></thead>
      <tbody>{SAMPLE_STATEMENT_LINES.map(l => (
        <tr key={l.lineId}>
          <td className="mono">{l.lineId}</td><td>{l.direction} · {l.kind}</td><td className="r num">{l.amount}</td><td className="mono">{l.reference}</td>
          <td>{l.result === "allocated" ? <span className="st-recon tone-success">allocated</span> : <span className="st-recon tone-danger">exception</span>}</td>
          <td><span className="mono caption">{l.code}</span>{l.text}</td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}

export function LiquidityTable() {
  return (
    <TableWrap label="Sample liquidity by account" caption={`usable = eligible − restricted − safeguarded − committed payouts − buffer. Stale snapshots are flagged and excluded from usable now: ${SAMPLE_USABLE_NOW}. Currencies are never added together. ${LIQUIDITY_POLICY_LABEL}`}>
      <thead><tr><th scope="col">Account</th><th scope="col">Ccy</th><th scope="col" className="r">Eligible</th><th scope="col" className="r">Restricted</th><th scope="col" className="r">Safeguarded</th><th scope="col" className="r">Committed</th><th scope="col" className="r">Buffer</th><th scope="col" className="r">Usable</th><th scope="col">Snapshot</th></tr></thead>
      <tbody>{SAMPLE_LIQUIDITY.map(l => (
        <tr key={l.account}>
          <td>{l.provider}<span className="caption mono">{l.account}</span></td><td className="mono">{l.currency}</td>
          <td className="r num">{l.eligible}</td><td className="r num">{l.restricted}</td><td className="r num">{l.safeguarded}</td>
          <td className="r num">{l.committed}</td><td className="r num">{l.buffer}</td><td className="r num"><b>{l.usable}</b></td>
          <td>{l.freshness.startsWith("stale") ? <span className="st-exec tone-warning">{l.freshness}</span> : <span className="caption">{l.freshness}</span>}</td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}

export function PaymentsTable() {
  return (
    <TableWrap label="Sample payments with three separate status dimensions" caption="The engine's five seeded scenarios (s1–s5). execution, settlement (+ scope) and reconciliation are separate fields on every payment intent.">
      <thead><tr><th scope="col">Scenario</th><th scope="col">Reference</th><th scope="col">Beneficiary</th><th scope="col" className="r">Amount</th><th scope="col">execution</th><th scope="col">settlement</th><th scope="col">reconciliation</th></tr></thead>
      <tbody>{SAMPLE_PAYMENTS.map(p => (
        <tr key={p.scenario}>
          <td className="mono">{p.scenario}</td><td className="mono">{p.reference}</td><td>{p.beneficiary}</td><td className="r num">{p.amount}</td>
          <td><ExecStatus state={p.execution} /></td><td><SettlementStatus state={p.settlement} scope={p.settlementScope} /></td><td><ReconStatus state={p.reconciliation} /></td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}

export function FundingTable() {
  const f = SAMPLE_FUNDING;
  const rows: [string, ReactNode][] = [
    ["Supplier payout (Connect intent)", <>{f.supplierPayout}<br /><ExecStatus state={f.payoutStatus.execution} /> <SettlementStatus state={f.payoutStatus.settlement} scope="bank_statement" /></>],
    ["Advance", <>{f.principal} for {f.customer}</>],
    ["Treasury approval", f.approval],
    ["Repayment obligation", f.obligation],
    ["Allocations", f.allocations],
    ["Repaid / outstanding", <><span className="num">{f.repaid}</span> repaid · <b className="num">{f.outstanding}</b> outstanding · <span className="st-exec tone-warning">{f.state}</span></>],
    ["Exception", f.exception],
  ];
  return (
    <TableWrap label="Sample funding projection" caption={FUNDING_PROJECTION_LABEL}>
      <thead><tr><th scope="col">Link in the projection</th><th scope="col">s5_funding (fictional)</th></tr></thead>
      <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row" className="row-head">{k}</th><td>{v}</td></tr>)}</tbody>
    </TableWrap>
  );
}

export function ExceptionsTable() {
  const sev: Record<string, string> = { critical: "danger", high: "danger", medium: "warning", low: "neutral" };
  return (
    <TableWrap label="Sample exceptions with owners and due dates" caption={"The engine's unresolved exceptions, severity-ordered. " + EXCEPTION_DUE_POLICY}>
      <thead><tr><th scope="col">Category</th><th scope="col">Item</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Required action</th></tr></thead>
      <tbody>{SAMPLE_EXCEPTIONS.map(e => (
        <tr key={e.category}>
          <td className="mono">{e.category}</td><td className="mono">{e.reference}</td>
          <td><span className={"st-exec tone-" + sev[e.severity]}>{e.severity}</span></td><td className="mono">{e.status}</td>
          <td>{e.owner}</td><td className="num">{e.dueDate}</td><td>{e.action}</td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}
