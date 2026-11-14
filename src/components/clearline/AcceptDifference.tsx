"use client";
/**
 * Explicit acceptance of a bank debit that does not match its payout exactly (engine re-review R-M2 / R2-M2).
 * The engine decides everything; the console only offers the step, asks the engine first (dry run) and shows
 * its words when refused:
 *  - an exact-amount debit dated late (RC_OUTSIDE_TIME_WINDOW): one staff person, `acceptLateDate`;
 *  - an over-amount (RC_OVERPAYMENT) up to 1%: one staff person, `acceptDifference` (+ `acceptLateDate` if late);
 *  - an over-amount above 1% (up to 50%): accepted the same way, then a DIFFERENT staff person approves it
 *    (`approve_acceptance`) before the case can close;
 *  - a currency mismatch (RC_CURRENCY_MISMATCH): never acceptable; the engine says why.
 * Acceptances are console-only; the v1 test API does not take these flags (known limitation).
 */
import { useState } from "react";
import type { ActionResult, ReconciliationException, Workspace, WorkspaceAction } from "@/lib/clearline";
import { formatMinor } from "@/lib/clearline";
import { useWorkspace } from "./workspace";
import { ActionButton, useRun, useSettled, type Gate } from "./Action";
import { describeError } from "./human";
import { SIMULATED_ROLE_NOTE } from "./nav";
import { Field, Status, fmtTime, ui } from "./ui";

type Flags = { acceptDifference?: true; acceptLateDate?: true };
type Kind = { codes: string[]; label: string; field: string; hint: string; candidates: Flags[] };

/** Which acceptance a person may try for an exception, by the engine's explanation code. */
export const ACCEPTANCE_KINDS: Kind[] = [
  {
    codes: ["RC_OVERPAYMENT"], label: "Accept the over-amount", field: "Why the over-amount is accepted",
    hint: "Up to 1% over the payment: one staff person accepts it. Over 1% and up to 50%: one staff person accepts it, then a different staff person must approve before the case can close. Over 50% cannot be accepted. The debit must carry this payout's reference and currency; if it is also dated late (up to 60 days after submission), the late date is accepted with it.",
    candidates: [{ acceptDifference: true }, { acceptDifference: true, acceptLateDate: true }],
  },
  {
    codes: ["RC_OUTSIDE_TIME_WINDOW"], label: "Accept the late-dated debit", field: "Why the late date is accepted",
    hint: "An exact-amount debit carrying this payout's reference and currency, dated after the matching window but no more than 60 days after submission, can be accepted by one staff person.",
    candidates: [{ acceptLateDate: true }, { acceptDifference: true, acceptLateDate: true }],
  },
  {
    // Never acceptable: offered so the person sees the engine's reason instead of a missing option.
    codes: ["RC_CURRENCY_MISMATCH"], label: "Accept the debit in another currency", field: "Why it is accepted",
    hint: "A debit in another currency cannot be accepted without FX evidence.",
    candidates: [{ acceptDifference: true }],
  },
];

const resolveWith = (e: ReconciliationException, note: string, f: Flags): WorkspaceAction =>
  ({ type: "resolve", target: { kind: "exception", id: e.id }, note, ...f });

/** The engine's refusal, keeping its own code (e.g. DIFFERENCE_NOT_ACCEPTABLE) and its detail visible. */
function refusal(r: Extract<ActionResult, { ok: false }>, ws: Workspace): Gate {
  const h = describeError(r.error, ws);
  const m = /^([A-Z_]+): (.*)$/.exec(r.error.message);
  return { ok: false, reason: m ? `${h.text} ${m[2]}` : h.text, code: m ? `${r.error.code} · ${m[1]}` : r.error.code };
}

export function AcceptDifference({ exception, idPrefix, onRun }: {
  exception: ReconciliationException; idPrefix: string;
  onRun: (what: string, action: WorkspaceAction, opts?: { onOk?: () => void }) => unknown;
}) {
  const { ws, preview } = useWorkspace();
  const [note, setNote] = useState("");
  const settled = useSettled(note);
  const kind = ACCEPTANCE_KINDS.find((k) => k.codes.includes(exception.explanationCode));
  if (!kind) return null;
  // The first set of flags the engine accepts (e.g. an over-amount that is also late needs both).
  const probe = settled.trim() ? settled : kind.label;
  const tries = kind.candidates.map((f) => ({ f, r: preview(resolveWith(exception, probe, f)) }));
  const chosen = tries.find((t) => t.r.ok) ?? tries[0];
  const gate: Gate = !chosen.r.ok ? refusal(chosen.r, ws) : note.trim() ? { ok: true } : { ok: false, reason: "Write why you accept the difference first." };
  return (
    <form data-testid="accept-difference" onSubmit={(e) => { e.preventDefault(); onRun(kind.label, resolveWith(exception, note, chosen.f), { onOk: () => setNote("") }); }}>
      <Field label={kind.field} hint={kind.hint}>
        <textarea id={`${idPrefix}-accept`} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gate} name={kind.label}>{kind.label}</ActionButton></div>
    </form>
  );
}

/**
 * What a person accepted on a resolved exception, and the second approval when the engine requires one:
 * pending (with an approval step for a different staff person) or approved (who and when).
 */
export function AcceptanceStatus({ exception, idPrefix }: { exception: ReconciliationException; idPrefix: string }) {
  const { ws, preview, actors, actorName } = useWorkspace();
  const { msg, run } = useRun();
  const acc = exception.resolution?.acceptedDifference;
  const acceptor = exception.resolution?.actorId;
  const staff = actors.filter((a) => a.role !== "viewer");
  const [approver, setApprover] = useState(staff.find((a) => a.id !== acceptor)?.id ?? staff[0]?.id ?? "");
  const [note, setNote] = useState("");
  const settled = useSettled(note);
  if (!acc) return null;
  const second = acc.secondApproval;
  const pending = Boolean(second?.required && !second.approvedBy);
  const action = { type: "approve_acceptance", exceptionId: exception.id, note: settled.trim() ? settled : "Approval" } as const;
  const dry = pending ? preview(action, { actorId: approver }) : null;
  const gate: Gate = !dry ? { ok: true } : !dry.ok ? refusal(dry, ws) : note.trim() ? { ok: true } : { ok: false, reason: "Write an approval note first." };
  return (
    <div className={ui.panelBody} data-testid="acceptance-status" data-pending={pending ? "true" : "false"} style={{ borderTop: "1px solid var(--cl-line)" }}>
      <p style={{ margin: "0 0 4px" }}>
        <strong>Accepted by {actorName(acceptor)}</strong>{exception.resolution ? `, ${fmtTime(exception.resolution.at)}` : ""}:{" "}
        {acc.differenceMinor > 0 && <>an over-amount of <span className="mono">{formatMinor(acc.differenceMinor, acc.currency)}</span></>}
        {acc.differenceMinor > 0 && acc.lateValueDate && " and "}
        {acc.lateValueDate && <>a late value date <span className="mono">{acc.lateValueDate}</span></>}
        {acc.differenceMinor <= 0 && !acc.lateValueDate && "the bank debit"} <span className={ui.apiValue}>{acc.statementLineId}</span>
      </p>
      {second && (second.approvedBy
        ? <p style={{ margin: 0 }} data-testid="second-approval">Second approval: <strong>{actorName(second.approvedBy)}</strong>{second.approvedAt ? `, ${fmtTime(second.approvedAt)}` : ""}{second.note ? ` — ${second.note}` : ""}</p>
        : (
          <form data-testid="second-approval" onSubmit={(e) => { e.preventDefault(); run("Approve the acceptance", { type: "approve_acceptance", exceptionId: exception.id, note }, { actorId: approver, onOk: () => setNote("") }); }}>
            <p className={ui.reason} style={{ marginTop: 0 }}>Second approval pending: a staff person other than {actorName(acceptor)} must approve before the case can close.</p>
            <div className={ui.formGrid}>
              <div data-testid="role-switch">
                <Field label="Approver" hint={SIMULATED_ROLE_NOTE}>
                  <select id={`${idPrefix}-approver`} value={approver} onChange={(e) => setApprover(e.target.value)}>
                    {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Approval note"><textarea id={`${idPrefix}-approval-note`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </div>
            <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gate} name="Approve the acceptance">Approve the acceptance</ActionButton></div>
          </form>
        ))}
      <Status msg={msg} />
    </div>
  );
}
