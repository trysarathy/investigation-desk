"use client";

import { useId, useState, type ReactNode } from "react";
import { Result, useMutation } from "@/components/control/forms";
import { StatusBadge } from "@/components/ui";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";
import g from "./screens-g2.module.css";

/**
 * A request waiting for a decision, with the decision shown optimistically. The approver still reviews the payload,
 * writes a reason and presses Approve or Reject (a deliberate click on a form that cannot be sent without the reason;
 * there is no keyboard shortcut). Only then is the card marked "Approving…" / "Rejecting…" while the request is
 * sent. The request is exactly the one MerchantDecisionForm sends (same endpoint, body, hash and Idempotency-Key, via
 * useMutation). The server decides: on success the page reloads and shows what the database holds; on a refusal the
 * card goes back to how it was and the server's message is shown (role="alert"). Nothing is shown as approved before
 * the server has recorded it.
 */

const API = "/api/control/merchant";

export function ApprovalCard({ requestId, labelledBy, decide, children }: {
  requestId: string; labelledBy: string; children: ReactNode;
  /** Present when this person may decide: the version under review. */
  decide?: { payloadSha256: string; version: number; what: string } | null;
}) {
  const x = useMutation(`decision:${requestId}`);
  const id = useId();
  const [phase, setPhase] = useState<"approve" | "reject" | null>(null);
  return (
    <article className={`${s.panel} ${g.card} ${phase ? g.cardPending : ""}`} aria-labelledby={labelledBy} data-testid="approval-request" data-optimistic={phase ?? undefined} aria-busy={phase ? true : undefined}>
      {children}
      {decide ? (
        <form className={s.form} autoComplete="off" onSubmit={async (ev) => {
          ev.preventDefault();
          const submitter = (ev.nativeEvent as SubmitEvent).submitter;
          const f = new FormData(ev.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
          const decision = f.get("decision") === "reject" ? "reject" : "approve";
          setPhase(decision);
          const ok = await x.run("POST", `${API}/approvals/${encodeURIComponent(requestId)}/decision`, { decision, reason: String(f.get("reason") ?? ""), payloadSha256: String(f.get("payloadSha256") ?? "") },
            () => (decision === "approve" ? `Approved ${decide.what} version ${decide.version}. The server recorded your decision.` : `Rejected ${decide.what} version ${decide.version}. Nothing was resolved or written off.`));
          if (!ok) setPhase(null); // refused: roll back; the server's message is shown below
        }}>
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-hash`}>SHA-256 of the version you reviewed (sent with your decision)</label>
            <input className={`${s.input} ${m.hash}`} id={`${id}-hash`} name="payloadSha256" defaultValue={decide.payloadSha256} readOnly data-testid="approval-hash" aria-describedby={`${id}-hash-hint`} />
            <span className={s.hint} id={`${id}-hash-hint`}>If the proposal changes after you reviewed it, this hash no longer matches and the server refuses the decision.</span>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-reason`}>Reason for your decision</label>
            <textarea className={s.textarea} id={`${id}-reason`} name="reason" required minLength={3} maxLength={1000} />
          </div>
          <div className={s.row}>
            <button type="submit" name="decision" value="approve" className={s.button} disabled={x.busy}>Approve version {decide.version}</button>
            <button type="submit" name="decision" value="reject" className={`${s.button} ${s.buttonDanger}`} disabled={x.busy}>Reject</button>
          </div>
          {phase ? (
            <p className={g.optimistic} data-testid="approval-optimistic">
              {phase === "approve" ? <StatusBadge kind="approved" label={`Approving version ${decide.version}…`} /> : <StatusBadge kind="exception" label={`Rejecting version ${decide.version}…`} />}
              <span>Sent. The server has not recorded it yet; if it refuses, this goes back and says why.</span>
            </p>
          ) : null}
          <Result outcome={x.outcome} />
        </form>
      ) : null}
    </article>
  );
}
