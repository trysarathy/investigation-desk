"use client";

import { useId } from "react";
import { Result, Submit, useMutation } from "@/components/control/forms";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";

/**
 * Client forms for the merchant screens. Same contract as the rc5 Control forms: each sends the request to
 * /api/control/merchant (session, organisation, exact Origin, Idempotency-Key and role checked there), then reloads
 * the page on success so what is shown is what the database holds, and shows the server's confirmation; a refusal
 * shows the server's message. Nothing is shown as done before the server has said so.
 */

const API = "/api/control/merchant";

export function RunReconciliation({ entityId, entityName }: { entityId: string; entityName: string }) {
  const x = useMutation(`reconcile:${entityId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      void x.run("POST", `${API}/reconcile`, { entityId }, (d) => d?.changed
        ? `Reconciled ${String(d.records ?? "?")} payments for ${entityName}: ${String(d.exceptions ?? 0)} exceptions, ${String(d.journals ?? 0)} journal proposals pending sign-off.`
        : `Nothing changed for ${entityName}: the same data was already reconciled (input sha256 ${String(d?.inputSha256 ?? "").slice(0, 12)}…).`);
    }}>
      <Submit busy={x.busy} variant="secondary">Run reconciliation for {entityId}</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function AssignForm({ exceptionId, members, current }: { exceptionId: string; members: { userId: string; name: string; role: string }[]; current: string | null }) {
  const x = useMutation(`assign:${exceptionId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const v = String(new FormData(ev.currentTarget).get("owner") ?? "");
      void x.run("POST", `${API}/exceptions/${encodeURIComponent(exceptionId)}/assign`, { ownerUserId: v || null }, (d) => (d?.ownerName ? `Saved: ${String(d.ownerName)} owns this exception.` : "Saved: the exception is unassigned."));
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={id}>Owner</label>
        <select className={s.select} id={id} name="owner" defaultValue={current ?? ""}>
          <option value="">Unassigned</option>
          {members.map((p) => <option key={p.userId} value={p.userId}>{p.name} ({p.role === "finance" ? "Finance" : "Payment Operations"})</option>)}
        </select>
      </div>
      <div><Submit busy={x.busy} variant="secondary">Save owner</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function ExceptionNoteForm({ exceptionId, kind }: { exceptionId: string; kind: "note" | "evidence" }) {
  const x = useMutation(`${kind}:${exceptionId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const reference = String(f.get("reference") ?? "").trim();
      void x.run("POST", `${API}/exceptions/${encodeURIComponent(exceptionId)}/notes`, { kind, body: String(f.get("body") ?? ""), ...(reference ? { reference } : {}) },
        () => (kind === "evidence" ? "Saved: the evidence is attached (recorded as attached by a person, not as independent evidence)." : "Saved: the note is recorded."));
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-body`}>{kind === "evidence" ? "Evidence description" : "Note"}</label>
        <textarea className={s.textarea} id={`${id}-body`} name="body" required minLength={3} maxLength={2000} />
      </div>
      {kind === "evidence" ? (
        <div className={s.field}>
          <label className={s.label} htmlFor={`${id}-ref`}>Reference (optional)</label>
          <input className={s.input} id={`${id}-ref`} name="reference" maxLength={120} aria-describedby={`${id}-ref-hint`} />
          <span className={s.hint} id={`${id}-ref-hint`}>For example a provider ticket or a payment-link id. No file is stored.</span>
        </div>
      ) : null}
      <div><Submit busy={x.busy}>{kind === "evidence" ? "Attach evidence" : "Add note"}</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function ProposeResolutionForm({ exceptionId, evidence }: { exceptionId: string; evidence: { id: string; label: string }[] }) {
  const x = useMutation(`resolution:${exceptionId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      void x.run("POST", `${API}/resolutions`, { exceptionId, note: String(f.get("note") ?? ""), evidenceIds: f.getAll("evidence").map(String) },
        (d) => `Sent for approval: version ${String(d?.version ?? "?")} (sha256 ${String(d?.payloadSha256 ?? "").slice(0, 12)}…) is waiting for a different approver.`);
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-note`}>Proposed resolution</label>
        <textarea className={s.textarea} id={`${id}-note`} name="note" required minLength={10} maxLength={2000} aria-describedby={`${id}-hint`} />
        <span className={s.hint} id={`${id}-hint`}>At least 10 characters. A different person with the Approver role must approve this exact version before the exception is resolved.</span>
      </div>
      <fieldset className={s.fieldset}>
        <legend>Evidence this resolution relies on (at least one)</legend>
        {evidence.length === 0 ? <p className={s.small}>Attach evidence above first; a resolution must cite at least one item.</p> : evidence.map((e) => (
          <div className={s.check} key={e.id}>
            <input type="checkbox" id={`${id}-${e.id}`} name="evidence" value={e.id} defaultChecked />
            <label htmlFor={`${id}-${e.id}`}>{e.label}</label>
          </div>
        ))}
      </fieldset>
      <div><Submit busy={x.busy}>Propose resolution for approval</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function SubmitWriteoff({ writeoffId, amount }: { writeoffId: string; amount: string }) {
  const x = useMutation(`writeoff:${writeoffId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      void x.run("POST", `${API}/writeoffs/${encodeURIComponent(writeoffId)}/propose`, {}, (d) => `Sent for approval: write-off ${amount} v${String(d?.version ?? "?")} (sha256 ${String(d?.payloadSha256 ?? "").slice(0, 12)}…) is waiting for a different approver.`);
    }}>
      <Submit busy={x.busy} variant="secondary">Submit write-off of {amount} for approval</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

/**
 * The approver reviews the payload, sees its SHA-256 and submits it with the decision: the server and the database
 * refuse a decision on any other version, by the person who prepared it, or by anyone who is not an Approver.
 */
export function MerchantDecisionForm({ requestId, payloadSha256, version, what }: { requestId: string; payloadSha256: string; version: number; what: string }) {
  const x = useMutation(`decision:${requestId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const submitter = (ev.nativeEvent as SubmitEvent).submitter;
      const f = new FormData(ev.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
      const decision = f.get("decision") === "reject" ? "reject" : "approve";
      void x.run("POST", `${API}/approvals/${encodeURIComponent(requestId)}/decision`, { decision, reason: String(f.get("reason") ?? ""), payloadSha256: String(f.get("payloadSha256") ?? "") },
        () => (decision === "approve" ? `Approved ${what} version ${version}. The server recorded your decision.` : `Rejected ${what} version ${version}. Nothing was resolved or written off.`));
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-hash`}>SHA-256 of the version you reviewed (sent with your decision)</label>
        <input className={`${s.input} ${m.hash}`} id={`${id}-hash`} name="payloadSha256" defaultValue={payloadSha256} readOnly data-testid="approval-hash" aria-describedby={`${id}-hash-hint`} />
        <span className={s.hint} id={`${id}-hash-hint`}>If the proposal changes after you reviewed it, this hash no longer matches and the server refuses the decision.</span>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-reason`}>Reason for your decision</label>
        <textarea className={s.textarea} id={`${id}-reason`} name="reason" required minLength={3} maxLength={1000} />
      </div>
      <div className={s.row}>
        <button type="submit" name="decision" value="approve" className={s.button} disabled={x.busy}>Approve version {version}</button>
        <button type="submit" name="decision" value="reject" className={`${s.button} ${s.buttonDanger}`} disabled={x.busy}>Reject</button>
      </div>
      <Result outcome={x.outcome} />
    </form>
  );
}
