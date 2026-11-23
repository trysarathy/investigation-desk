"use client";

import { useId, useState } from "react";
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

// --------------------------------------------------------------------------------------------- phase 8

/** A check made in the browser before anything is sent (nothing reached the server). */
function LocalError({ message }: { message: string | null }) {
  return message ? <p role="alert" className={`${s.result} ${s.resultError}`}>Not sent: {message}</p> : null;
}

export function MappingEditor({ merchantOrgId, revision, initial }: { merchantOrgId: string; revision: number; initial: string }) {
  const x = useMutation(`mapping:${merchantOrgId}`);
  const id = useId();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const text = String(new FormData(ev.currentTarget).get("mapping") ?? "");
      let mapping: unknown;
      try { mapping = JSON.parse(text); } catch { setErr("This is not valid JSON, so nothing was sent. Check the quotes and commas."); return; }
      setErr(null);
      void x.run("POST", `${API}/provider/onboarding/${encodeURIComponent(merchantOrgId)}/mapping`, { mapping, expectedRevision: revision }, (d) => `Saved: ${String(d?.columns ?? "?")} columns mapped (revision ${String(d?.revision ?? "?")}). Configuration only; nothing is connected.`);
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-m`}>Column mapping (JSON)</label>
        <textarea className={`${s.textarea} ${m.code}`} id={`${id}-m`} name="mapping" required rows={14} defaultValue={initial} spellCheck={false} aria-describedby={`${id}-h`} />
        <span className={s.hint} id={`${id}-h`}>{"Each key is a column header in the provider's export; each value is the Clearline field it fills (orderId, orderAmount, orderCurrency and quoteId are required). The server checks it against the export adapter's schema."}</span>
      </div>
      <div><Submit busy={x.busy}>Save column mapping</Submit></div>
      <LocalError message={err} />
      <Result outcome={x.outcome} />
    </form>
  );
}

type Defaults = { toleranceBps: number; toleranceAbsMinor: string; writeoffThresholdMinor: string; allowImportedBankLinesAsVerified: boolean };
const minorOf = (v: string) => { const t = v.trim(); if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null; const [w, f = ""] = t.split("."); return String(BigInt(w) * 100n + BigInt((f + "00").slice(0, 2))); };
const major = (minor: string) => `${BigInt(minor) / 100n}.${String(BigInt(minor) % 100n).padStart(2, "0")}`;

function PolicyFields({ id, v }: { id: string; v: Defaults }) {
  return (
    <>
      <div className={s.field}><label className={s.label} htmlFor={`${id}-bps`}>Tolerance (basis points of the invoice)</label><input className={s.input} id={`${id}-bps`} name="bps" inputMode="numeric" pattern="[0-9]*" required defaultValue={v.toleranceBps} aria-describedby={`${id}-bps-h`} /><span className={s.hint} id={`${id}-bps-h`}>50 = 0.5%. The band is the larger of this and the fixed amount below (founder decision, rc7).</span></div>
      <div className={s.field}><label className={s.label} htmlFor={`${id}-abs`}>Tolerance cap (entity currency)</label><input className={s.input} id={`${id}-abs`} name="abs" inputMode="decimal" required defaultValue={major(v.toleranceAbsMinor)} /></div>
      <div className={s.field}><label className={s.label} htmlFor={`${id}-wo`}>Largest write-off the engine may propose</label><input className={s.input} id={`${id}-wo`} name="wo" inputMode="decimal" required defaultValue={major(v.writeoffThresholdMinor)} /></div>
      <div className={s.check}><input type="checkbox" id={`${id}-imp`} name="imp" defaultChecked={v.allowImportedBankLinesAsVerified} /><label htmlFor={`${id}-imp`}>Allow imported (not bank-authenticated) bank lines to verify settlement</label></div>
    </>
  );
}
function readPolicy(f: FormData): Defaults | string {
  const bps = Number(f.get("bps"));
  const abs = minorOf(String(f.get("abs") ?? ""));
  const wo = minorOf(String(f.get("wo") ?? ""));
  if (!Number.isInteger(bps) || bps < 0 || bps > 1000) return "Tolerance must be a whole number of basis points from 0 to 1000.";
  if (abs === null || wo === null) return "Amounts must be written like 5.00.";
  return { toleranceBps: bps, toleranceAbsMinor: abs, writeoffThresholdMinor: wo, allowImportedBankLinesAsVerified: f.get("imp") === "on" };
}

export function DefaultsForm({ merchantOrgId, revision, current }: { merchantOrgId: string; revision: number; current: Defaults }) {
  const x = useMutation(`defaults:${merchantOrgId}`);
  const id = useId();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const d = readPolicy(new FormData(ev.currentTarget));
      if (typeof d === "string") { setErr(d); return; }
      setErr(null);
      void x.run("POST", `${API}/provider/onboarding/${encodeURIComponent(merchantOrgId)}/defaults`, { defaults: d, expectedRevision: revision }, (r) => `Proposed (revision ${String(r?.revision ?? "?")}). The merchant's Admin decides whether to adopt it.`);
    }}>
      <PolicyFields id={id} v={current} />
      <div><Submit busy={x.busy}>Propose these defaults</Submit></div>
      <LocalError message={err} />
      <Result outcome={x.outcome} />
    </form>
  );
}

export function PolicyForm({ entityId, revision, current }: { entityId: string; revision: number; current: Defaults }) {
  const x = useMutation(`policy:${entityId}`);
  const id = useId();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const d = readPolicy(new FormData(ev.currentTarget));
      if (typeof d === "string") { setErr(d); return; }
      setErr(null);
      void x.run("POST", `${API}/policy/${encodeURIComponent(entityId)}`, { patch: d, expectedRevision: revision }, (r) => `Saved: the matching policy of ${entityId} is now revision ${String(r?.revision ?? "?")}. It applies from the next reconciliation.`);
    }}>
      <PolicyFields id={id} v={current} />
      <div><Submit busy={x.busy}>Save policy for {entityId}</Submit></div>
      <LocalError message={err} />
      <Result outcome={x.outcome} />
    </form>
  );
}

export function InviteForm({ merchantOrgId }: { merchantOrgId: string }) {
  const x = useMutation(`invite:${merchantOrgId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      void x.run("POST", `${API}/provider/onboarding/${encodeURIComponent(merchantOrgId)}/invitations`, { email: String(f.get("email") ?? ""), role: String(f.get("role") ?? "") },
        (d) => `Invitation recorded for ${String(d?.email ?? "")} (no email sent). An operator accepts it with the command shown in the list.`);
    }}>
      <div className={s.field}><label className={s.label} htmlFor={`${id}-e`}>Email</label><input className={s.input} id={`${id}-e`} name="email" type="email" required maxLength={254} /></div>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-r`}>Role at the merchant</label>
        <select className={s.select} id={`${id}-r`} name="role" defaultValue="viewer" aria-describedby={`${id}-rh`}>
          <option value="viewer">Viewer</option>
        </select>
        <p className={s.hint} id={`${id}-rh`}>A provider can invite read-only Viewers. Roles with authority (Admin, Payment Operations, Finance, Approver) are granted by the merchant&apos;s own Admin.</p>
      </div>
      <div><Submit busy={x.busy}>Record invitation</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function GrantForm({ scope }: { scope: "full" | "aggregates" }) {
  const x = useMutation("grant");
  const next = scope === "full" ? "aggregates" : "full";
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      void x.run("POST", `${API}/grant`, { scope: next }, () => (next === "full" ? "Saved: your provider can now read this merchant's rows." : "Saved: your provider sees aggregates only again."));
    }}>
      <Submit busy={x.busy} variant={next === "full" ? "secondary" : "danger"}>{next === "full" ? "Grant the provider full read access" : "Revoke full access (aggregates only)"}</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function ReviewButtons({ orderId, current }: { orderId: string; current: "correct" | "wrong" | null }) {
  const x = useMutation(`review:${orderId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const submitter = (ev.nativeEvent as SubmitEvent).submitter;
      const verdict = submitter instanceof HTMLButtonElement && submitter.value === "wrong" ? "wrong" : "correct";
      void x.run("POST", `${API}/reviews/${encodeURIComponent(orderId)}`, { verdict }, () => `Saved: you marked ${orderId} ${verdict}.`);
    }}>
      <div className={s.row}>
        <button type="submit" name="verdict" value="correct" className={`${s.button} ${s.buttonSecondary}`} disabled={x.busy} aria-pressed={current === "correct"} aria-label={`Mark ${orderId} correct`}>Correct</button>
        <button type="submit" name="verdict" value="wrong" className={`${s.button} ${s.buttonSecondary}`} disabled={x.busy} aria-pressed={current === "wrong"} aria-label={`Mark ${orderId} wrong`}>Wrong</button>
      </div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function MinutesForm({ today }: { today: string }) {
  const x = useMutation("minutes");
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const note = String(f.get("note") ?? "").trim();
      void x.run("POST", `${API}/minutes`, { day: String(f.get("day") ?? ""), minutes: Number(f.get("minutes")), ...(note ? { note } : {}) }, () => "Saved: your minutes are logged.");
    }}>
      <div className={m.inline}>
        <div className={s.field}><label className={s.label} htmlFor={`${id}-d`}>Day</label><input className={s.input} id={`${id}-d`} name="day" type="date" required defaultValue={today} /></div>
        <div className={s.field}><label className={s.label} htmlFor={`${id}-m`}>Minutes spent on reconciliation</label><input className={s.input} id={`${id}-m`} name="minutes" type="number" min={0} max={1440} step={1} required /></div>
        <div className={s.field}><label className={s.label} htmlFor={`${id}-n`}>Note (optional)</label><input className={s.input} id={`${id}-n`} name="note" maxLength={500} /></div>
      </div>
      <div><Submit busy={x.busy}>Log minutes</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}
