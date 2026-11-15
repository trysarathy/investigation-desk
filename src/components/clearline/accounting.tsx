"use client";
/**
 * Accounting Bridge (rc4) — shared console pieces. The engine (@/lib/clearline, CHANGE 15) owns every entry, amount,
 * status and word: these components only render `accountingBridgeView(ws)` and link its evidence. Clearline posts
 * nothing; "posted" is only ever a person's record (`record_posting`), and every screen here says so.
 */
import Link from "./Link";
import { useMemo } from "react";
import {
  accountingBridgeView, formatMinor,
  type AccountingBridgeView, type CurrencyCode, type JournalProposalRow, type JournalProposalStatus, type Workspace,
} from "@/lib/clearline";
import { useWorkspace } from "./workspace";
import { label } from "./human";
import { Chip, Code, ui, type Tone } from "./ui";

/** Shown under every "record posting" control and on every accounting page. */
export const POSTING_NOTE = "Recorded by a person. Clearline does not post to any ledger.";

export function useBridge(): AccountingBridgeView {
  const { ws } = useWorkspace();
  return useMemo(() => accountingBridgeView(ws), [ws]);
}

/** Exact amount without the currency prefix ("24,651.37"); the currency has its own column. */
export function exact(amountMinor: number, currency: CurrencyCode): string {
  return formatMinor(amountMinor, currency).slice(currency.length + 1);
}

const STATUS_TONE: Record<JournalProposalStatus, Tone> = { proposed: "warn", approved: "info", exported: "info", posted: "neutral", rejected: "neutral", superseded: "bad" };

export function ProposalStatus({ p }: { p: Pick<JournalProposalRow, "status" | "statusLabel"> }) {
  return (
    <span data-testid="proposal-status" data-api-value={p.status}>
      <Chip tone={STATUS_TONE[p.status]} title={`API value: ${p.status}`}>{p.statusLabel}</Chip>{" "}
      <span className={ui.apiValue}>{p.status}</span>
    </span>
  );
}

/** Payout states in which the supplier did not receive the money (the engine's execution state, not a posting rule). */
const NOT_DELIVERED = new Set(["returned", "failed", "cancelled", "expired", "on_hold"]);

/**
 * What the entry says about the supplier. Driven by the engine: its `showsSupplierPaid` flag, the evidence the entry
 * names, and the payout's execution state. A payout that was not delivered (returned, failed, cancelled, expired or
 * on hold) reads "Supplier still unpaid — payable open"; no posting-rule code is interpreted here.
 */
export function supplierPaid(p: Pick<JournalProposalRow, "showsSupplierPaid" | "evidence" | "intentId" | "status">, ws: Workspace): { text: string; tone: Tone } {
  // A superseded or rejected entry is withdrawn: it says nothing about the supplier, whatever it said when proposed.
  if (p.status === "superseded" || p.status === "rejected") return { text: "Withdrawn — says nothing about the supplier", tone: "neutral" };
  if (p.showsSupplierPaid) return { text: p.evidence.chainObservationIds.length ? "Shows the supplier as paid — final chain transfer evidence" : "Shows the supplier as paid — bank debit evidence", tone: "info" };
  const intent = p.intentId ? ws.intents.find((i) => i.id === p.intentId) : undefined;
  if (intent && NOT_DELIVERED.has(intent.status.execution)) return { text: "Supplier still unpaid — payable open", tone: "bad" };
  return { text: "Does not show the supplier as paid", tone: "neutral" };
}

export function SupplierPaid({ p }: { p: Pick<JournalProposalRow, "showsSupplierPaid" | "evidence" | "intentId" | "status"> }) {
  const { ws } = useWorkspace();
  const s = supplierPaid(p, ws);
  return <span className={ui.sub} data-testid="supplier-paid" data-shows-paid={p.showsSupplierPaid && p.status !== "superseded" && p.status !== "rejected" ? "true" : "false"}><Chip tone={s.tone}>{s.text}</Chip></span>;
}

/** One line per journal line: side, account code and name (or "not mapped"), role. */
export function accountOf(p: JournalProposalRow, key: string) {
  return p.accounts.find((a) => a.accountKey === key);
}

export function LinesAccounts({ p }: { p: JournalProposalRow }) {
  return (
    <ul className={ui.jLines} data-testid="entry-accounts">
      {p.lines.map((l) => {
        const a = accountOf(p, l.accountKey);
        return (
          <li key={l.lineNo}>
            <span className={ui.jSide}>{l.side === "debit" ? "Dr" : "Cr"}</span>{" "}
            {a?.accountCode ? <><span className="mono" data-testid="account-code">{a.accountCode}</span> {a.accountName}</> : <><strong data-testid="account-unmapped">Not mapped</strong><span className={ui.sub}>{a?.roleLabel ?? l.accountKey}</span></>}
          </li>
        );
      })}
    </ul>
  );
}

export function LinesAmounts({ p, side }: { p: JournalProposalRow; side: "debit" | "credit" }) {
  return (
    <ul className={ui.jLines} data-testid={`entry-${side}`}>
      {p.lines.map((l) => (
        <li key={l.lineNo} className="mono">
          {l.side === side ? exact(l.amountMinor, l.currency) : <><span aria-hidden="true">—</span><span className={ui.srOnly}>no {side}</span></>}
        </li>
      ))}
    </ul>
  );
}

export function totalOf(p: JournalProposalRow, side: "debit" | "credit"): number {
  return p.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amountMinor, 0);
}

export function Balanced({ p }: { p: JournalProposalRow }) {
  const d = totalOf(p, "debit"), c = totalOf(p, "credit");
  return (
    <span data-testid="entry-balanced" data-balanced={p.balanced ? "true" : "false"}>
      <Chip tone={p.balanced ? "info" : "bad"} title={`Debits ${exact(d, p.currency)} · credits ${exact(c, p.currency)}`}>{p.balanced ? "Balanced" : "Not balanced"}</Chip>
      {!p.balanced && <span className={ui.sub}>Dr {exact(d, p.currency)} · Cr {exact(c, p.currency)}</span>}
    </span>
  );
}

/** Evidence links: statement line, chain observation and payment, each opening the payment's investigation. */
export function EvidenceLinks({ p, ws }: { p: JournalProposalRow; ws: Workspace }) {
  const intent = p.intentId ? ws.intents.find((i) => i.id === p.intentId) : undefined;
  const lines = p.evidence.statementLineIds.map((id) => ws.statementLines.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l);
  return (
    <ul className={ui.jLinks} data-testid="entry-evidence">
      {lines.map((l) => (
        <li key={l.id}><Link href={intent ? `/clearline/payments/${intent.id}#timeline` : `/clearline/reconciliation#${l.id}`} data-evidence="statement-line">Statement line {l.lineId}</Link><span className={ui.sub}>{l.id}</span></li>
      ))}
      {p.evidence.chainObservationIds.map((id) => (
        <li key={id}><Link href={intent ? `/clearline/payments/${intent.id}#chain` : "/clearline/payments"} data-evidence="chain-observation">Chain observation</Link><span className={ui.sub}>{id}</span></li>
      ))}
      {intent && <li><Link href={`/clearline/payments/${intent.id}#accounting`} data-evidence="payment">Payment {intent.internalReference}</Link><span className={ui.sub}>{intent.id}</span></li>}
      {p.openExceptionIds.map((id) => (
        <li key={id}><Link href={`/clearline/exceptions?view=all#${id}`} data-evidence="exception">Open exception</Link><span className={ui.sub}>{id}</span></li>
      ))}
    </ul>
  );
}

/** Not-proposed items that concern one payment (by id, or through its exceptions). */
export function notProposedFor(v: AccountingBridgeView, ws: Workspace, intentId: string) {
  const exc = new Set(ws.exceptions.filter((e) => e.intentId === intentId).map((e) => e.id));
  return v.notProposed.filter((n) => n.refs.includes(intentId) || n.exceptionIds.some((x) => exc.has(x)));
}

/**
 * F. Accounting outcome on the payment investigation: the lifecycle's last step. Lists this payment's proposed
 * entries with their status in the engine's words, and what the bridge deliberately did not propose.
 */
export function AccountingOutcome({ intentId }: { intentId: string }) {
  const { ws, actorName } = useWorkspace();
  const v = useBridge();
  const mine = v.proposals.filter((p) => p.intentId === intentId);
  const none = notProposedFor(v, ws, intentId);
  return (
    <div className={ui.panelBody} data-testid="accounting-outcome">
      <p className={ui.hint} style={{ marginTop: 0 }}>{v.disclaimer}</p>
      {mine.length === 0 ? (
        <p data-testid="accounting-outcome-empty" style={{ margin: "0 0 8px" }}>No journal entry is proposed for this payment{none.length ? "; the reasons are below" : ""}. Entries are proposed only from bank statement or final chain evidence.</p>
      ) : (
        <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Journal entries for this payment">
          <table className={`${ui.table} ${ui.stack} ${ui.jTable}`}>
            <thead><tr><th>Date</th><th>Entry</th><th>Accounts</th><th className={ui.r}>Debit</th><th className={ui.r}>Credit</th><th>Status</th></tr></thead>
            <tbody>{mine.map((p) => (
              <tr key={p.id} data-proposal={p.id}>
                <td data-label="Date" className={ui.num}>{p.postingDate}</td>
                <td data-label="Entry">{p.ruleLabel}<span className={ui.sub}><Link href={`/clearline/accounting?payment=${intentId}#${p.id}`} className="mono">{p.id}</Link> · {p.currency}</span><SupplierPaid p={p} /></td>
                <td data-label="Accounts"><LinesAccounts p={p} /></td>
                <td data-label="Debit" className={ui.r}><LinesAmounts p={p} side="debit" /></td>
                <td data-label="Credit" className={ui.r}><LinesAmounts p={p} side="credit" /></td>
                <td data-label="Status"><ProposalStatus p={p} />
                  {p.approval && <span className={ui.sub}>Approved by {actorName(p.approval.by)}</span>}
                  {p.posting && <span className={ui.sub}>{POSTING_NOTE} Reference <span className="mono">{p.posting.externalReference}</span> (simulated)</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {none.length > 0 && (
        <>
          <h3 className={ui.eyebrow} style={{ marginTop: 12 }}>Not proposed, and why</h3>
          <ul data-testid="accounting-not-proposed" style={{ margin: 0, paddingLeft: 18 }}>
            {none.map((n, i) => <li key={i}>{n.text} <Code>{n.code}</Code></li>)}
          </ul>
        </>
      )}
      <p style={{ margin: "10px 0 0" }}><Link href={`/clearline/accounting?payment=${intentId}`}>Open these entries in Accounting</Link> · <span className={ui.hint}>{label("journalProposalStatus", "proposed")} until a second person approves.</span></p>
    </div>
  );
}
