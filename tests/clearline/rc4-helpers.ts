/** rc4 Accounting Bridge test helpers. */
import { accountingBridgeView, applyAction, sampleWorkspace, scenarioIntentId, type JournalProposal, type Workspace, type WorkspaceAction } from "@/lib/clearline";
import { run } from "./helpers";

export const S = (ws: Workspace, sc: string) => scenarioIntentId(ws, sc)!;
export const proposals = (ws: Workspace) => ws.accounting?.proposals ?? [];
export const byRule = (ws: Workspace, rule: JournalProposal["ruleCode"], intentId?: string) => proposals(ws).filter((p) => p.ruleCode === rule && (!intentId || p.intentId === intentId));
export const active = (ws: Workspace) => proposals(ws).filter((p) => p.status === "proposed" || p.status === "approved");
export const period = (ws: Workspace) => ws.accounting!.periods[0];
export const propose = (ws: Workspace, actor = "usr_maya", periodId?: string) => run(ws, actor, { type: "propose_journal_entries", ...(periodId ? { periodId } : {}) });
export const view = accountingBridgeView;
export const tryAct = (ws: Workspace, actor: string, action: WorkspaceAction) => applyAction(ws, action, { actorId: actor, at: ws.asOf });

/** Approve, export and record posting for the given proposals (maker usr_maya → checker usr_daniel). */
export function postAll(ws: Workspace, ids: string[], ref = "JNL-2026-11-0001"): Workspace {
  for (const id of ids) ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace;
  ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
  for (const id of ids) ws = run(ws, "usr_maya", { type: "record_posting", proposalId: id, externalReference: ref }).workspace;
  return ws;
}

/** The s4 USDC payout driven to a final, tx-hash-matched chain transfer. */
export function s4Final(ws: Workspace = sampleWorkspace()): Workspace {
  return run(ws, "usr_maya", { type: "simulate_provider_event", intentId: S(ws, "s4_chain") }).workspace;
}

/** Sum of lines per (account key, currency) over the given proposals, debit positive (BigInt). */
export function net(ps: JournalProposal[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const p of ps) for (const l of p.lines) m.set(`${l.accountKey}|${l.currency}`, (m.get(`${l.accountKey}|${l.currency}`) ?? 0n) + BigInt(l.amountMinor) * (l.side === "debit" ? 1n : -1n));
  return m;
}

/** Bridge actions a random walk can issue (some refused by design: maker = checker, viewer, closed period, unmapped role). */
export function bridgeCandidates(ws: Workspace, r: () => number): { actor: string; action: WorkspaceAction }[] {
  const pick = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
  const out: { actor: string; action: WorkspaceAction }[] = [];
  const b = ws.accounting;
  out.push({ actor: pick(["usr_maya", "usr_maya", "usr_daniel", "usr_alex"])!, action: { type: "propose_journal_entries" } });
  const prop = pick(proposals(ws).filter((p) => p.status === "proposed"));
  if (prop) out.push({ actor: pick(["usr_daniel", "usr_daniel", "usr_daniel", prop.createdBy, "usr_sam"])!, action: { type: "approve_journal_proposal", proposalId: prop.id } });
  const rej = pick(proposals(ws).filter((p) => ["proposed", "approved", "exported"].includes(p.status)));
  if (rej && r() < 0.3) out.push({ actor: pick(["usr_daniel", "usr_maya"])!, action: { type: "reject_journal_proposal", proposalId: rej.id, reason: "Not ours (fictional)" } });
  // rc4 review: rejecting reversals (refused while the reversal is required) and approving rebookings first (refused)
  const rev = pick(proposals(ws).filter((p) => p.ruleCode === "JR_REVERSAL" && ["proposed", "approved"].includes(p.status)));
  if (rev) out.push({ actor: "usr_daniel", action: { type: "reject_journal_proposal", proposalId: rev.id, reason: "Duplicate (fictional)" } });
  const rebook = pick(proposals(ws).filter((p) => p.status === "proposed" && p.ruleCode !== "JR_REVERSAL" && proposals(ws).some((o) => o.sourceKey === p.sourceKey && o.id !== p.id && (o.status === "posted" || o.status === "exported"))));
  if (rebook) for (let k = 0; k < 2; k++) out.push({ actor: "usr_daniel", action: { type: "approve_journal_proposal", proposalId: rebook.id } });
  const open = b?.periods.filter((p) => p.status === "open") ?? [];
  const withApproved = pick(open.filter((p) => proposals(ws).some((x) => x.periodId === p.id && x.status === "approved")));
  if (withApproved) for (let k = 0; k < 2; k++) out.push({ actor: "usr_maya", action: { type: "export_journal", periodId: withApproved.id } });
  const exp = pick(proposals(ws).filter((p) => p.status === "exported"));
  if (exp) for (let k = 0; k < 2; k++) out.push({ actor: pick(["usr_maya", "usr_daniel"])!, action: { type: "record_posting", proposalId: exp.id, externalReference: `JNL-${ws.seq}` } });
  const closable = pick(open);
  if (closable && r() < 0.3) out.push({ actor: "usr_daniel", action: { type: "close_accounting_period", periodId: closable.id } });
  if (b && r() < 0.2) {
    const last = [...b.periods].sort((x, y) => (x.to < y.to ? 1 : -1))[0];
    const from = last?.to ?? "2026-11-01";
    const d = new Date(Date.parse(from + "T00:00:00Z"));
    d.setUTCMonth(d.getUTCMonth() + 1);
    out.push({ actor: "usr_maya", action: { type: "open_accounting_period", name: `P-${from}`, from, to: d.toISOString().slice(0, 10) } });
  }
  if (b?.mapping && r() < 0.1) {
    const drop = r() < 0.5 ? "provider_clearing" : "";
    out.push({ actor: "usr_maya", action: { type: "set_account_mapping", expectedRevision: b.mapping.revision, entries: b.mapping.entries.filter((e) => e.accountKey !== drop).concat(drop ? [] : [{ accountKey: "provider_clearing", accountCode: "1300", accountName: "Provider clearing (fictional)" }].filter((e) => !b.mapping!.entries.some((x) => x.accountKey === e.accountKey))) } });
  }
  if (r() < 0.1) out.push({ actor: "usr_daniel", action: { type: "record_reconciliation_export", from: "2026-11-01", to: "2026-12-01" } });
  return out;
}
