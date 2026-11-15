/**
 * Accounting Bridge (rc4) — read model for the console. PURE. Every value carries its HUMAN_LABELS text.
 */
import { formatDecimal } from "../money";
import { deriveJournalCandidates, isActiveProposal, isBalanced, isStandingProposal } from "./derive";
import { ACCOUNT_ROLE, JOURNAL_RULE, NOT_PROPOSED, PERIOD_STATUS, PROPOSAL_STATUS } from "./labels";
import { resolvePeriod, roleOfKey, unmappedKeys } from "./periods";
import { ACCOUNTING_EXPORT_MARKING } from "./exports";
import type { CurrencyCode, Workspace } from "../types";
import type { AccountingExportRecord, AccountingPeriod, AccountMapping, JournalProposal, JournalRuleCode, NotProposedItem } from "./types";

export const ACCOUNTING_BRIDGE_DISCLAIMER =
  "Sandbox Accounting Bridge: proposed journal entries from recorded evidence, approved by a different person and exported as a file. Clearline is not an ERP, has no connection to any ledger and posts nothing; \"posted\" only records what a person says they posted, with their reference." as const;

export interface JournalProposalRow extends JournalProposal {
  statusLabel: string;
  ruleLabel: string;
  /** The evidence still gives exactly this entry. */
  current: boolean;
  balanced: boolean;
  openExceptionIds: string[];
  /** Lines with their account role and the customer's code (when mapped). */
  accounts: { accountKey: string; roleLabel: string; accountCode?: string; accountName?: string }[];
}

export interface AccountingBridgeView {
  marking: typeof ACCOUNTING_EXPORT_MARKING;
  disclaimer: typeof ACCOUNTING_BRIDGE_DISCLAIMER;
  asOf: string;
  configured: boolean;
  periods: (AccountingPeriod & { statusLabel: string })[];
  mapping?: AccountMapping;
  /** Account keys used by proposed / approved entries that the mapping does not map (export is blocked while non-empty). */
  unmappedKeys: string[];
  proposals: JournalProposalRow[];
  /** Entries the evidence supports that are not proposed yet (propose_journal_entries would create them, period permitting). */
  pending: { sourceKey: string; ruleCode: JournalRuleCode; ruleLabel: string; entryDate: string; periodId?: string; postingDate?: string; priorPeriodItem: boolean; reason?: string }[];
  /** What the bridge deliberately does not propose, with why (including NP_NO_OPEN_PERIOD for pending entries). */
  notProposed: NotProposedItem[];
  exports: AccountingExportRecord[];
  /** Net per account key and currency over proposed, approved, exported and posted entries (decimal strings, debit positive). Never across currencies. */
  netByAccount: { accountKey: string; currency: CurrencyCode; posted: string; notYetPosted: string }[];
}

export function accountingBridgeView(ws: Workspace): AccountingBridgeView {
  const b = ws.accounting;
  const { candidates, notProposed } = deriveJournalCandidates(ws);
  const bySource = new Map(candidates.map((c) => [c.sourceKey, c]));
  const proposals = b?.proposals ?? [];
  const mapping = b?.mapping;
  const rows: JournalProposalRow[] = proposals.map((p) => {
    const c = bySource.get(p.sourceKey);
    const ids = new Set(p.lines.flatMap((l) => l.evidenceIds));
    return {
      ...structuredClone(p),
      statusLabel: PROPOSAL_STATUS[p.status], ruleLabel: JOURNAL_RULE[p.ruleCode], current: !!c && c.basisHash === p.basisHash, balanced: isBalanced(p.lines),
      openExceptionIds: ws.exceptions.filter((e) => e.status !== "resolved" && ((p.intentId && e.intentId === p.intentId) || (e.statementLineId && ids.has(e.statementLineId)) || (p.obligationId && e.obligationId === p.obligationId))).map((e) => e.id),
      accounts: [...new Set(p.lines.map((l) => l.accountKey))].map((k) => {
        const m = mapping?.entries.find((e) => e.accountKey === k);
        return { accountKey: k, roleLabel: ACCOUNT_ROLE[roleOfKey(k) ?? "suspense"] + (k.startsWith("bank:") ? ` ${k.slice(5)}` : ""), ...(m ? { accountCode: m.accountCode, accountName: m.accountName } : {}) };
      }),
    };
  });
  const isNew = (c: (typeof candidates)[number]) => !proposals.some((p) => p.sourceKey === c.sourceKey && p.basisHash === c.basisHash && (isActiveProposal(p) || (p.status === "rejected" && p.ruleCode !== "JR_REVERSAL" && !p.rejection?.notImported) || (isStandingProposal(p) && !proposals.some((q) => q.reverses === p.id && q.status !== "rejected" && q.status !== "superseded"))));
  const pending: AccountingBridgeView["pending"] = [];
  const extra: NotProposedItem[] = [];
  for (const c of candidates.filter(isNew)) {
    const r = resolvePeriod(b, c.entryDate);
    pending.push({ sourceKey: c.sourceKey, ruleCode: c.ruleCode, ruleLabel: JOURNAL_RULE[c.ruleCode], entryDate: c.entryDate, ...(r.ok ? { periodId: r.periodId, postingDate: r.postingDate } : { reason: r.reason }), priorPeriodItem: r.ok && !!r.priorPeriodItem });
    if (!r.ok) extra.push({ code: "NP_NO_OPEN_PERIOD", text: `${NOT_PROPOSED.NP_NO_OPEN_PERIOD}. ${r.reason}`, refs: [...new Set(c.lines.flatMap((l) => l.evidenceIds))], exceptionIds: [], amount: { amountMinor: c.lines.filter((l) => l.side === "debit").reduce((s, l) => s + l.amountMinor, 0), currency: c.currency } });
  }
  const net = new Map<string, { posted: bigint; other: bigint }>();
  for (const p of proposals) {
    if (p.status === "rejected" || p.status === "superseded") continue;
    for (const l of p.lines) {
      const k = `${l.accountKey}\u0000${l.currency}`;
      const t = net.get(k) ?? { posted: 0n, other: 0n };
      const v = BigInt(l.amountMinor) * (l.side === "debit" ? 1n : -1n);
      if (p.status === "posted") t.posted += v; else t.other += v;
      net.set(k, t);
    }
  }
  const netByAccount = [...net].sort(([a], [b2]) => (a < b2 ? -1 : 1)).map(([k, t]) => {
    const [accountKey, currency] = k.split("\u0000") as [string, CurrencyCode];
    return { accountKey, currency, posted: formatDecimal(Number(t.posted), currency), notYetPosted: formatDecimal(Number(t.other), currency) };
  });
  return {
    marking: ACCOUNTING_EXPORT_MARKING, disclaimer: ACCOUNTING_BRIDGE_DISCLAIMER, asOf: ws.asOf, configured: !!b,
    periods: (b?.periods ?? []).map((p) => ({ ...p, statusLabel: PERIOD_STATUS[p.status] })),
    ...(mapping ? { mapping: structuredClone(mapping) } : {}),
    unmappedKeys: unmappedKeys(mapping, proposals.filter(isActiveProposal).flatMap((p) => p.lines.map((l) => l.accountKey))),
    proposals: rows, pending, notProposed: [...notProposed, ...extra], exports: structuredClone(b?.exports ?? []), netByAccount,
  };
}
