"use client";

import { useId, useState } from "react";
import { Result, Submit, useMutation } from "@/components/control/forms";
import s from "@/components/control/control.module.css";

/**
 * v1 phase 3: month-end sign-off. Finance or an Admin asks for the month to be locked; another Admin locks or rejects
 * it. The server and the database refuse the preparer as approver; nothing is shown as locked before the server says so.
 */
const API = "/api/control/merchant/periods";

export function RequestPeriodLock({ entityId, period }: { entityId: string; period: string }) {
  const x = useMutation(`period-request:${entityId}:${period}`);
  const [reason, setReason] = useState("");
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => { ev.preventDefault(); void x.run("POST", `${API}/${encodeURIComponent(entityId)}`, { period, reason }, () => `Sign-off of ${period} requested. Another Admin locks it.`); }}>
      <label htmlFor={id}>Why the month is ready to close</label>
      <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required />
      <Submit busy={x.busy}>Ask to lock {period}</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function DecidePeriodLock({ entityId, period }: { entityId: string; period: string }) {
  const x = useMutation(`period-decide:${entityId}:${period}`);
  const [reason, setReason] = useState("");
  const id = useId();
  const send = (decision: "lock" | "reject") => void x.run("POST", `${API}/${encodeURIComponent(entityId)}/${period}`, { decision, reason }, () => (decision === "lock" ? `${period} is locked.` : `The sign-off of ${period} was rejected.`));
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => { ev.preventDefault(); send("lock"); }}>
      <label htmlFor={id}>Your reason</label>
      <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required />
      <Submit busy={x.busy}>Lock {period}</Submit>
      <button type="button" className={s.button} disabled={x.busy} onClick={() => send("reject")}>Reject</button>
      <Result outcome={x.outcome} />
    </form>
  );
}
