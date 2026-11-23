"use client";

import { useId, useState } from "react";
import { Result, Submit, useMutation } from "@/components/control/forms";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";
import { post, reloadWith } from "./upload-forms";

/**
 * rc7 upload review: validate, confirm or decline (bound to the file and report hashes reviewed), bring into
 * reconciliation, delete, retention. Each sends the request to /api/control/merchant/uploads, where the session,
 * organisation, exact Origin, Idempotency-Key, role and the second-person rule for bank statements are enforced.
 * Nothing is shown as done before the server has said so.
 */

const API = "/api/control/merchant/uploads";
const n = (d: Record<string, unknown> | null, k: string) => String(((d?.upload as Record<string, unknown> | undefined)?.counts as Record<string, number> | undefined)?.[k] ?? "?");

export function ValidateUpload({ uploadId, again }: { uploadId: string; again: boolean }) {
  const x = useMutation(`validate:${uploadId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      void x.run("POST", `${API}/${encodeURIComponent(uploadId)}/validate`, {}, (d) =>
        `Validated ${n(d, "rows")} rows: ${n(d, "accepted")} accepted, ${n(d, "warning")} with warnings, ${n(d, "rejected")} rejected, ${n(d, "duplicate")} duplicates.`);
    }}>
      <Submit busy={x.busy} variant={again ? "secondary" : undefined}>{again ? "Validate again" : "Validate every row"}</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function UploadDecisionForm({ uploadId, contentSha256, rowsSha256, importable, bank }: { uploadId: string; contentSha256: string; rowsSha256: string; importable: number; bank: boolean }) {
  const x = useMutation(`decision:${uploadId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const submitter = (ev.nativeEvent as SubmitEvent).submitter;
      const f = new FormData(ev.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
      const decision = f.get("decision") === "decline" ? "decline" : "confirm";
      void x.run("POST", `${API}/${encodeURIComponent(uploadId)}/decision`, { decision, reason: String(f.get("reason") ?? ""), contentSha256, rowsSha256 },
        () => (decision === "confirm" ? `Confirmed${bank ? " by a second person" : ""}: ${importable} row(s) can now be brought into reconciliation.` : "Declined: nothing from this file is imported."));
    }}>
      <p className={s.small}>Your decision is bound to the file and to the validation report you reviewed; if either changed, the server refuses it.</p>
      <dl className={m.facts}>
        <dt>File SHA-256</dt><dd className={s.mono} data-testid="content-hash">{contentSha256}</dd>
        <dt>Report SHA-256</dt><dd className={s.mono} data-testid="report-hash">{rowsSha256}</dd>
      </dl>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-reason`}>Reason for your decision</label>
        <textarea className={s.textarea} id={`${id}-reason`} name="reason" required minLength={3} maxLength={1000} aria-describedby={`${id}-hint`} />
        <span className={s.hint} id={`${id}-hint`}>For example what you checked the file against. At least 3 characters.</span>
      </div>
      <div className={s.row}>
        <button type="submit" name="decision" value="confirm" className={s.button} disabled={x.busy}>Confirm upload</button>
        <button type="submit" name="decision" value="decline" className={`${s.button} ${s.buttonDanger}`} disabled={x.busy}>Decline</button>
      </div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function NormaliseUpload({ uploadId }: { uploadId: string }) {
  const x = useMutation(`normalise:${uploadId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      void x.run("POST", `${API}/${encodeURIComponent(uploadId)}/normalise`, {}, (d) => {
        const c = (d?.counts ?? {}) as Record<string, number>;
        return d?.changed === false ? "Already in reconciliation: nothing changed." : `Brought into reconciliation: ${c.created ?? 0} row(s) added, ${c.existing ?? 0} already present, ${c.skipped ?? 0} skipped, ${c.conflict ?? 0} in conflict.`;
      });
    }}>
      <Submit busy={x.busy}>Bring into reconciliation</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function DeleteUpload({ uploadId, name }: { uploadId: string; name: string }) {
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  return (
    <div className={s.form}>
      {!asked ? <div><button type="button" className={`${s.button} ${s.buttonDanger}`} onClick={() => setAsked(true)}>Delete upload</button></div> : (
        <div role="group" aria-labelledby={`${id}-q`} className={m.issues}>
          <p id={`${id}-q`}><strong>Delete “{name}”?</strong> The stored file and its validation report are removed now; this cannot be undone.</p>
          <div className={s.row}>
            <button type="button" className={`${s.button} ${s.buttonDanger}`} disabled={busy} autoFocus onClick={async () => {
              setBusy(true); setError("");
              const r = await post(`${API}/${encodeURIComponent(uploadId)}/delete`, {});
              if (!r.ok) { setBusy(false); setError(r.message); return; }
              reloadWith("upload:deleted", `Deleted “${name}”: its file and validation report were removed.`, "/control/merchant/uploads");
            }}>Yes, delete it</button>
            <button type="button" className={`${s.button} ${s.buttonSecondary}`} disabled={busy} onClick={() => setAsked(false)}>Keep it</button>
          </div>
        </div>
      )}
      <p role={error ? "alert" : "status"} className={`${s.result} ${error ? s.resultError : s.resultOk}`}>{error ? `Refused: ${error}` : busy ? "Deleting…" : ""}</p>
    </div>
  );
}

export function RetentionForm({ days }: { days: number }) {
  const x = useMutation("retention");
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const v = Number(new FormData(ev.currentTarget).get("days"));
      void x.run("POST", `${API}/retention`, { days: v }, (d) => `Saved: new uploads are deleted after ${String(d?.retentionDays ?? v)} days.`);
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-days`}>Keep uploads for (days)</label>
        <input className={s.input} id={`${id}-days`} name="days" type="number" inputMode="numeric" min={1} max={3650} step={1} required defaultValue={days} aria-describedby={`${id}-hint`} />
        <span className={s.hint} id={`${id}-hint`}>1 to 3,650 days; 90 by default. Applies to files uploaded from now on; each upload keeps the delete-after date it was given.</span>
      </div>
      <div><Submit busy={x.busy}>Save retention</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}
