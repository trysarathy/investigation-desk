"use client";
/**
 * Explicit acceptance of a statement difference that the engine allows a person to accept (re-review R-M2).
 * Today: a small over-amount (RC_OVERPAYMENT, at most 1%) on a bank debit carrying the payout's reference,
 * accepted by one staff person with `resolve … acceptDifference: true`.
 *
 * Built as a list of acceptance KINDS so further engine rules (accepting an exact debit outside the window,
 * or a larger over-amount proposed by one person and approved by a second) add an entry here, each with its
 * own action and, where needed, a second step. Every step is gated by the engine's dry run and shows the
 * engine's words when refused.
 */
import { useState } from "react";
import type { ActionResult, ReconciliationException, WorkspaceAction } from "@/lib/clearline";
import { useWorkspace } from "./workspace";
import { ActionButton, useSettled, type Gate } from "./Action";
import { describeError } from "./human";
import { Field } from "./ui";

type Kind = {
  /** Which exceptions this acceptance applies to (by the engine's explanation code). */
  applies: (e: ReconciliationException) => boolean;
  label: string;
  hint: string;
  action: (e: ReconciliationException, note: string) => WorkspaceAction;
};

export const ACCEPTANCE_KINDS: Kind[] = [
  {
    applies: (e) => e.explanationCode === "RC_OVERPAYMENT",
    label: "Accept the over-amount",
    hint: "Only a small over-amount (up to 1%) on a bank debit carrying this payout's reference, currency and window can be accepted. The accepted difference is recorded.",
    action: (e, note) => ({ type: "resolve", target: { kind: "exception", id: e.id }, note, acceptDifference: true }),
  },
];

/** Gate from a dry run, keeping the engine's own refusal code (e.g. DIFFERENCE_NOT_ACCEPTABLE) visible. */
function acceptanceGate(r: ActionResult, ws: Parameters<typeof describeError>[1], note: string): Gate {
  if (!r.ok) {
    const h = describeError(r.error, ws);
    const m = /^([A-Z_]+): (.*)$/.exec(r.error.message);
    return { ok: false, reason: m && m[1] === "DIFFERENCE_NOT_ACCEPTABLE" ? `${h.text} ${m[2]}` : h.text, code: m ? `${r.error.code} · ${m[1]}` : r.error.code };
  }
  return note.trim() ? { ok: true } : { ok: false, reason: "Write why you accept the difference first." };
}

export function AcceptDifference({ exception, idPrefix, onRun }: {
  exception: ReconciliationException; idPrefix: string;
  onRun: (what: string, action: WorkspaceAction, opts?: { onOk?: () => void }) => unknown;
}) {
  const { ws, preview } = useWorkspace();
  const [note, setNote] = useState("");
  const settled = useSettled(note);
  const kind = ACCEPTANCE_KINDS.find((k) => k.applies(exception));
  if (!kind) return null;
  const gate = acceptanceGate(preview(kind.action(exception, settled.trim() ? settled : kind.label)), ws, note);
  return (
    <form data-testid="accept-over-amount" onSubmit={(e) => { e.preventDefault(); onRun(kind.label, kind.action(exception, note), { onOk: () => setNote("") }); }}>
      <Field label="Why the over-amount is accepted" hint={kind.hint}>
        <textarea id={`${idPrefix}-accept`} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gate} name={kind.label}>{kind.label}</ActionButton></div>
    </form>
  );
}
