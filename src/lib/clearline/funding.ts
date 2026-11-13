/**
 * Funding Desk linkage — an explicit PROJECTION, not a shared production ledger.
 *
 * It aligns the Connect payment identity with the Funding Desk concepts used in
 * src/lib/mentor-demo/engine.ts and src/lib/funding (read-only reuse of their rules, not their
 * storage): treasury approval by a different person than the preparer (maker ≠ checker),
 * repayments allocated only by explicit reference, outstanding = paid − repaid, and anything
 * unreferenced stays unallocated for a person to review.
 */
import type { Stage as FundingDeskStage } from "@/lib/mentor-demo/engine";
import { orgDate } from "./tx";
import type { AdvanceState, FundingProjection, FundingProjectionRow, Money, Workspace } from "./types";

export const FUNDING_PROJECTION_LABEL =
  "Sandbox projection linking a Connect payment to a Funding Desk advance. Not a shared production ledger; the provider makes every credit decision.";

const STAGE_MAP: Record<AdvanceState, FundingDeskStage> = {
  proposed: "proposed",
  approved: "approved",
  declined: "declined",
  supplier_paid: "supplier_paid",
  partly_repaid: "partly_repaid",
  repaid: "repaid",
  // The original Funding Desk has no "overdue" stage; it derives overdue from due date.
  overdue: "partly_repaid",
};

export function obligationOutstanding(ws: Workspace, obligationId: string): Money {
  const ob = ws.obligations.find((o) => o.id === obligationId);
  if (!ob) return { amountMinor: 0, currency: "SGD" };
  const repaid = ws.repaymentAllocations
    .filter((a) => a.obligationId === obligationId && a.currency === ob.currency)
    .reduce((s, a) => s + a.amountMinor, 0);
  return { amountMinor: Math.max(0, ob.principalMinor - repaid), currency: ob.currency };
}

/** Derived advance state (same rules the Funding Desk uses: repayment by reference, overdue by date). */
export function deriveAdvanceState(ws: Workspace, advanceId: string, at: string = ws.asOf): AdvanceState {
  const adv = ws.advances.find((a) => a.id === advanceId);
  if (!adv) return "proposed";
  const decision = ws.fundingDecisions.find((d) => d.id === adv.decisionId);
  if (!decision) return "proposed";
  if (decision.outcome === "decline") return "declined";
  const ob = ws.obligations.find((o) => o.id === adv.obligationId);
  const intent = ws.intents.find((i) => i.id === adv.intentId);
  if (!ob) return "approved";
  const outstanding = obligationOutstanding(ws, ob.id).amountMinor;
  const repaid = ob.principalMinor - outstanding;
  if (outstanding === 0) return "repaid";
  if (orgDate(at, ws.organization.timezone) > ob.dueDate) return "overdue";
  if (repaid > 0) return "partly_repaid";
  if (intent && ["provider_reported_completed"].includes(intent.status.execution)) return "supplier_paid";
  return "approved";
}

export function fundingProjection(ws: Workspace, at: string = ws.asOf): FundingProjection {
  const rows: FundingProjectionRow[] = ws.advances.map((adv) => {
    const intent = ws.intents.find((i) => i.id === adv.intentId);
    const instr = intent ? ws.instructions.find((x) => x.id === intent.instructionId) : undefined;
    const decision = ws.fundingDecisions.find((d) => d.id === adv.decisionId);
    const ob = ws.obligations.find((o) => o.id === adv.obligationId);
    const allocations = ob ? ws.repaymentAllocations.filter((a) => a.obligationId === ob.id) : [];
    const outstanding = ob ? obligationOutstanding(ws, ob.id) : { amountMinor: 0, currency: adv.currency };
    const state = deriveAdvanceState(ws, adv.id, at);
    return {
      advanceId: adv.id,
      intentId: adv.intentId,
      supplierPayout: {
        execution: intent?.status.execution ?? "created",
        settlement: intent?.status.settlement ?? "none",
        providerPaymentId: instr?.providerPaymentId,
      },
      customerName: adv.customerName,
      supplierName: adv.supplierName,
      invoiceRef: adv.invoiceRef,
      principal: { amountMinor: adv.principalMinor, currency: adv.currency },
      treasuryApproval: decision ? { makerId: decision.makerId, checkerId: decision.checkerId, outcome: decision.outcome, at: decision.at } : undefined,
      obligation: ob ? { id: ob.id, reference: ob.reference, dueDate: ob.dueDate } : undefined,
      allocations,
      repaid: { amountMinor: ob ? ob.principalMinor - outstanding.amountMinor : 0, currency: adv.currency },
      outstanding,
      overdue: state === "overdue",
      state,
      supplierPaidBasis: intent?.status.settlement === "verified" ? "verified_settlement" : intent?.status.execution === "provider_reported_completed" ? "provider_reported" : "none",
      fundingDeskStage: STAGE_MAP[state],
      exceptionIds: ws.exceptions.filter((e) => e.advanceId === adv.id || (e.obligationId && e.obligationId === ob?.id) || e.candidates.includes(ob?.id ?? "\u0000")).map((e) => e.id),
      evidenceIds: ws.evidence.filter((e) => e.advanceId === adv.id).map((e) => e.id),
    };
  });
  const outstandingByCurrency: FundingProjection["outstandingByCurrency"] = {};
  for (const r of rows) outstandingByCurrency[r.outstanding.currency] = (outstandingByCurrency[r.outstanding.currency] ?? 0) + r.outstanding.amountMinor;
  return { label: FUNDING_PROJECTION_LABEL, asOf: at, rows, outstandingByCurrency };
}
