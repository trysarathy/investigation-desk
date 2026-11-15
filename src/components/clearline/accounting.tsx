"use client";
/**
 * Accounting Bridge (rc4) — shared console pieces. The engine (@/lib/clearline, CHANGE 15) owns every entry, amount,
 * status and word: these components only render `accountingBridgeView(ws)` and link its evidence. Clearline posts
 * nothing; "posted" is only ever a person's record (`record_posting`), and every screen here says so.
 */
import Link from "./Link";
import { useMemo } from "react";
import {
  TERMINAL_FOR_SETTLEMENT_REPORT, accountingBridgeView, formatMinor,
  type AccountingBridgeView, type CurrencyCode, type ExecutionState, type JournalProposalRow, type JournalProposalStatus, type Workspace,
} from "@/lib/clearline";
import { useWorkspace } from "./workspace";
import { label } from "./human";
import { Chip, Code, ui, type Tone } from "./ui";

/** Review m2: the posting rules are sandbox rules not yet signed off by the founder (ACCOUNTING_BRIDGE.md). */
export const RULES_NOTE = "Sandbox posting rules, pending founder sign-off — review with your accountant before using this file." as const;

export function RulesNote() {
  return <p className={ui.hint} data-testid="rules-note" style={{ margin: "0 0 8px" }}><Chip tone="warn">Not signed off</Chip> {RULES_NOTE}</p>;
}

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

/**
 * Payout states in which the supplier did not receive the money: the engine's own terminal list
 * (TERMINAL_FOR_SETTLEMENT_REPORT) plus on hold, as the bridge's derive uses them. Never a local copy.
 */
const notDelivered = (e: ExecutionState) => TERMINAL_FOR_SETTLEMENT_REPORT.includes(e) || e === "on_hold";

type PaidInput = Pick<JournalProposalRow, "id" | "showsSupplierPaid" | "evidence" | "intentId" | "status" | "current" | "evidenceChange">;

/** An exported or posted entry whose evidence changed afterwards: it stays in the file / ledger as it was. */
export const changedAfterExport = (p: Pick<JournalProposalRow, "status" | "current" | "evidenceChange">) =>
  (p.status === "exported" || p.status === "posted") && (!!p.evidenceChange || !p.current);

/**
 * What the entry says about the supplier. Driven by the engine: its `showsSupplierPaid` flag, the evidence the entry
 * names, whether that evidence still gives this entry (`current`, `evidenceChange`) and the payout's execution state.
 * - Withdrawn (superseded / rejected): says nothing.
 * - Exported or posted, evidence changed since: what it showed when exported, what happened since and the reversal
 *   (warning tone; never an unqualified "paid").
 * - Not delivered (returned, failed, cancelled, expired, on hold): "Supplier still unpaid — payable open".
 */
export function supplierPaid(p: PaidInput, ws: Workspace): { text: string; tone: Tone; showsPaid: boolean } {
  if (p.status === "superseded" || p.status === "rejected") return { text: "Withdrawn — says nothing about the supplier", tone: "neutral", showsPaid: false };
  const intent = p.intentId ? ws.intents.find((i) => i.id === p.intentId) : undefined;
  if (changedAfterExport(p)) {
    const was = p.showsSupplierPaid ? "Showed the supplier as paid when exported" : "Did not show the supplier as paid when exported";
    const since = intent && notDelivered(intent.status.execution) ? `payout since: ${label("execution", intent.status.execution).toLowerCase()}`
      : intent?.status.settlement === "contradicted" ? "settlement evidence since contradicted"
      : "its evidence changed since";
    const reversal = ws.accounting?.proposals.find((q) => q.reverses === p.id && q.status !== "rejected" && q.status !== "superseded");
    const next = reversal ? `a reversal is proposed (${reversal.id}, ${label("journalProposalStatus", reversal.status).toLowerCase()})` : "propose entries to add its reversal";
    return { text: `${was} — ${since}; ${next}`, tone: "warn", showsPaid: false };
  }
  if (p.showsSupplierPaid) return { text: p.evidence.chainObservationIds.length ? "Shows the supplier as paid — final chain transfer evidence" : "Shows the supplier as paid — bank debit evidence", tone: "info", showsPaid: true };
  if (intent && notDelivered(intent.status.execution)) return { text: "Supplier still unpaid — payable open", tone: "bad", showsPaid: false };
  return { text: "Does not show the supplier as paid", tone: "neutral", showsPaid: false };
}

export function SupplierPaid({ p }: { p: PaidInput }) {
  const { ws } = useWorkspace();
  const s = supplierPaid(p, ws);
  return <span className={ui.sub} data-testid="supplier-paid" data-shows-paid={s.showsPaid ? "true" : "false"}><Chip tone={s.tone}>{s.text}</Chip></span>;
}

/** Marker for the table and the payment page: an exported or posted entry whose evidence changed after export. */
export function EvidenceChanged({ p }: { p: Pick<JournalProposalRow, "status" | "current" | "evidenceChange"> }) {
  if (!changedAfterExport(p)) return null;
  return (
    <span className={ui.sub} data-testid="evidence-changed">
      <Chip tone="warn">Evidence changed after export</Chip>{p.evidenceChange && <> {label("supersession", p.evidenceChange.code)} <code className={ui.apiValue}>{p.evidenceChange.code}</code></>}
    </span>
  );
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
      <RulesNote />
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
                <td data-label="Status"><ProposalStatus p={p} /><EvidenceChanged p={p} />
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
      <p style={{ margin: "10px 0 0" }}><Link href={`/clearline/accounting?payment=${intentId}`}>Open these entries in Accounting</Link> · <span className={ui.hint}>An entry stays proposed until a second person approves it; nothing is posted by Clearline.</span></p>
    </div>
  );
}
