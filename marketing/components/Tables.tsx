import type { ReactNode } from "react";
import { SAMPLE_QUOTES, SAMPLE_RECON, SAMPLE_LIQUIDITY, SAMPLE_PAYMENTS } from "@/lib/sample";
import { ExecStatus, EvidenceStatus, ReconStatus } from "@/components/Status";

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
    <TableWrap label="Sample route quotes" caption="Output of the test-mode quote engine for SGD 48,215.37 → PHP at KYC tier 2. Fixed illustrations, not executable offers.">
      <thead><tr><th scope="col">Quote</th><th scope="col">Provider</th><th scope="col">Route</th><th scope="col" className="r">Rate</th><th scope="col" className="r">Fee</th><th scope="col">ETA</th><th scope="col">Eligibility</th></tr></thead>
      <tbody>{SAMPLE_QUOTES.map(q => (
        <tr key={q.id}>
          <td className="mono">{q.id}</td><td>{q.provider}</td><td>{q.route}</td>
          <td className="r num">{q.rate}</td><td className="r num">{q.fee}</td><td>{q.eta}</td>
          <td>{q.eligible ? <span className="st-exec tone-neutral">eligible</span> : <span className="st-exec tone-warning">excluded: {q.reason}</span>}</td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}

export function ReconTable() {
  return (
    <TableWrap label="Sample reconciliation" caption="Output of the test-mode reconcile step. A matching amount alone is never treated as attribution; references and payment IDs must agree.">
      <thead><tr><th scope="col">Reference</th><th scope="col">Payment</th><th scope="col" className="r">Amount</th><th scope="col">Source</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead>
      <tbody>{SAMPLE_RECON.map(r => (
        <tr key={r.reference}>
          <td className="mono">{r.reference}</td><td className="mono">{r.paymentId}</td><td className="r num">{r.amount}</td>
          <td>{r.source}</td><td><ReconStatus state={r.recon} /></td><td>{r.reason}</td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}

export function LiquidityTable() {
  return (
    <TableWrap label="Sample liquidity by provider" caption="Free = balance − safeguarded − pending − buffer. Restricted amounts are subtracted, never shown as spendable. Fictional balances.">
      <thead><tr><th scope="col">Provider</th><th scope="col">Ccy</th><th scope="col" className="r">Balance</th><th scope="col" className="r">Safeguarded</th><th scope="col" className="r">Pending</th><th scope="col" className="r">Buffer</th><th scope="col" className="r">Free</th></tr></thead>
      <tbody>{SAMPLE_LIQUIDITY.map(l => (
        <tr key={l.provider}>
          <td>{l.provider}</td><td className="mono">{l.currency}</td><td className="r num">{l.balance}</td><td className="r num">{l.safeguarded}</td>
          <td className="r num">{l.pending}</td><td className="r num">{l.buffer}</td><td className="r num"><b>{l.free}</b></td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}

export function PaymentsTable() {
  return (
    <TableWrap label="Sample payments with three separate statuses" caption="The five seeded test-mode payments. Execution, evidence and reconciliation are tracked separately.">
      <thead><tr><th scope="col">Payment</th><th scope="col">Reference</th><th scope="col">Beneficiary</th><th scope="col" className="r">Amount</th><th scope="col">Execution</th><th scope="col">Evidence</th><th scope="col">Reconciliation</th></tr></thead>
      <tbody>{SAMPLE_PAYMENTS.map(p => (
        <tr key={p.id}>
          <td className="mono">{p.id}</td><td className="mono">{p.reference}</td><td>{p.beneficiary}</td><td className="r num">{p.amount}</td>
          <td><ExecStatus state={p.exec} /></td><td><EvidenceStatus state={p.evidence} /></td><td><ReconStatus state={p.recon} /></td>
        </tr>
      ))}</tbody>
    </TableWrap>
  );
}
