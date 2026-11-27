"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import s from "./control.module.css";

/**
 * Small client components for Clearline Control mutations. Each one sends the request to /api/control (which checks
 * the session, the organisation, the Origin, the Idempotency-Key and the role), then shows the server's answer:
 * on success it reloads the page, so what is shown is what the database now holds, and then shows the server's
 * confirmation next to the control that was used; on refusal it shows the server's message. Nothing is shown as done
 * before the server has said so.
 *
 * (A full reload rather than router.refresh(): in production builds a refresh after a client state change did not
 * re-render the server components under the root loading boundary, which would have left stale state on screen.)
 */

type Outcome = { kind: "idle" } | { kind: "pending" } | { kind: "reloading" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

function newKey(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return `ui-${c.randomUUID()}`;
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return `ui-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export async function send(method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "idempotency-key": newKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, data };
}

export function serverMessage(status: number, data: Record<string, unknown> | null): string {
  const e = data?.error as { message?: string; issues?: { path: string; message: string }[] } | undefined;
  const detail = e?.issues?.length ? ` (${e.issues.map((i) => `${i.path || "request"}: ${i.message}`).join("; ")})` : "";
  return `${e?.message ?? `The server refused this (HTTP ${status}).`}${detail}`;
}

const FLASH = "clearline.control.flash";
const FLASH_MAX_AGE_MS = 30_000;

/** The confirmation for `key` saved just before the reload, if any (read once). Storage may be unavailable. */
function takeFlash(key: string): string | null {
  try {
    const raw = sessionStorage.getItem(FLASH);
    if (!raw) return null;
    const f = JSON.parse(raw) as { key?: string; message?: string; at?: number };
    if (typeof f.at !== "number" || Date.now() - f.at > FLASH_MAX_AGE_MS) { sessionStorage.removeItem(FLASH); return null; }
    if (f.key !== key || typeof f.message !== "string") return null;
    sessionStorage.removeItem(FLASH);
    return f.message;
  } catch { return null; }
}
function putFlash(key: string, message: string) {
  try { sessionStorage.setItem(FLASH, JSON.stringify({ key, message, at: Date.now() })); } catch { /* the new state still shows */ }
}

function useFlash(key: string, onFlash: (message: string) => void) {
  useEffect(() => {
    const m = takeFlash(key);
    if (m) onFlash(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Shows the server's confirmation for `flashKey` after the reload, where the control itself is no longer shown. */
export function FlashMessage({ flashKey }: { flashKey: string }) {
  const [message, setMessage] = useState<string | null>(null);
  useFlash(flashKey, setMessage);
  return <p role="status" className={`${s.result} ${s.resultOk}`}>{message ?? ""}</p>;
}

export function useMutation(flashKey: string) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  useFlash(flashKey, (message) => setOutcome({ kind: "ok", message }));
  async function run(method: string, url: string, body: unknown, success: (data: Record<string, unknown> | null) => string) {
    setOutcome({ kind: "pending" });
    let r;
    try { r = await send(method, url, body); } catch {
      setOutcome({ kind: "error", message: "The server could not be reached. Nothing was confirmed." });
      return false;
    }
    if (!r.ok) { setOutcome({ kind: "error", message: serverMessage(r.status, r.data) }); return false; }
    // The server has confirmed the change: reload so every part of the page shows the stored state, then confirm.
    putFlash(flashKey, success(r.data));
    setOutcome({ kind: "reloading" });
    window.location.reload();
    return true;
  }
  const busy = outcome.kind === "pending" || outcome.kind === "reloading";
  return { outcome, run, busy };
}

export function Result({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "error") return <p role="alert" className={`${s.result} ${s.resultError}`}>Refused: {outcome.message}</p>;
  return (
    <p role="status" className={`${s.result} ${s.resultOk}`}>
      {outcome.kind === "pending" ? "Sending to the server…" : outcome.kind === "reloading" ? "Saved by the server. Loading the stored state…" : outcome.kind === "ok" ? outcome.message : ""}
    </p>
  );
}

export function Submit({ busy, children, variant }: { busy: boolean; children: ReactNode; variant?: "secondary" | "danger" }) {
  return (
    <button type="submit" className={`${s.button} ${variant === "secondary" ? s.buttonSecondary : variant === "danger" ? s.buttonDanger : ""}`} disabled={busy} aria-disabled={busy}>
      {children}
    </button>
  );
}

type Target = { kind: "case" | "exception"; id: string };

// --------------------------------------------------------------------------------------------- sign-in / sign-out

export function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(f.get("email") ?? ""), password: String(f.get("password") ?? "") }),
      });
      if (res.ok) {
        // v1 1.2: an account with MFA gets the second step (Better Auth's signed two_factor cookie is now set).
        const body = (await res.json().catch(() => null)) as { twoFactorRedirect?: boolean } | null;
        window.location.assign(body?.twoFactorRedirect ? "/control/sign-in/two-factor" : "/control");
        return;
      }
      // One generic answer for a wrong password, an unknown user or a disabled account.
      setError(res.status === 429 ? "Too many sign-in attempts. Wait a few minutes, then try again." : "Sign-in failed. Check your email and password and try again.");
    } catch {
      setError("Sign-in failed. Check your email and password and try again.");
    }
    setBusy(false);
  }
  return (
    <form className={s.form} autoComplete="off" onSubmit={onSubmit}>
      <div className={s.field}>
        <label className={s.label} htmlFor="email">Email</label>
        <input className={s.input} id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="password">Password</label>
        <input className={s.input} id="password" name="password" type="password" autoComplete="current-password" required minLength={12} />
      </div>
      <div><Submit busy={busy}>{busy ? "Signing in…" : "Sign in"}</Submit></div>
      <p role="alert" className={`${s.result} ${s.resultError}`}>{error ?? ""}</p>
      <p className={s.small}><a href="/control/sign-in/forgot">Forgot your password?</a></p>
    </form>
  );
}

export function SignOutButton() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await send("DELETE", "/api/control/org");
      const res = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      if (res.ok) { window.location.assign("/control/sign-in"); return; }
      setError(`Sign-out was refused (HTTP ${res.status}).`);
    } catch { setError("The server could not be reached; you are still signed in."); }
    setBusy(false);
  }
  return (
    <span>
      <button type="button" className={s.linkButton} onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
      {error ? <span role="alert" className={`${s.small} ${s.resultError}`}> {error}</span> : null}
    </span>
  );
}

export function OrgSwitcher({ orgs, current }: { orgs: { slug: string; name: string; role: string }[]; current: string }) {
  const m = useMutation("org");
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const slug = String(new FormData(ev.currentTarget).get("slug") ?? "");
      void m.run("POST", "/api/control/org", { slug }, (d) => `Now working in ${(d?.org as { name?: string } | undefined)?.name ?? slug}.`);
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={id}>Organisation</label>
        <select className={s.select} id={id} name="slug" defaultValue={current}>
          {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name} ({o.role})</option>)}
        </select>
      </div>
      <div><Submit busy={m.busy}>Switch organisation</Submit></div>
      <Result outcome={m.outcome} />
    </form>
  );
}

// --------------------------------------------------------------------------------------------- investigation

export function AssignToMe({ target, ownerName, isMine, label }: { target: Target; ownerName: string | null; isMine: boolean; label: string }) {
  const m = useMutation(`assign:${target.kind}:${target.id}`);
  return (
    <div>
      <p className={s.small}>Owner: <strong>{ownerName ?? "Unassigned"}</strong>{isMine ? " (you)" : ""}</p>
      {!isMine ? (
        <form autoComplete="off" onSubmit={(ev) => { ev.preventDefault(); void m.run("POST", "/api/control/actions", { type: "assign_owner", target }, () => "Saved: you are now the owner."); }}>
          <Submit busy={m.busy} variant="secondary">{label}</Submit>
        </form>
      ) : null}
      <Result outcome={m.outcome} />
    </div>
  );
}

export function NoteForm({ target }: { target: Target }) {
  const m = useMutation(`note:${target.kind}:${target.id}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const text = String(new FormData(form).get("text") ?? "");
      await m.run("POST", "/api/control/actions", { type: "add_note", target, text }, () => "Saved: the note is recorded.");
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={id}>Add a note</label>
        <textarea className={s.textarea} id={id} name="text" required maxLength={1000} />
      </div>
      <div><Submit busy={m.busy}>Add note</Submit></div>
      <Result outcome={m.outcome} />
    </form>
  );
}

export function EvidenceForm({ target }: { target: Target }) {
  const m = useMutation(`evidence:${target.kind}:${target.id}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const f = new FormData(form);
      await m.run("POST", "/api/control/actions", {
        type: "attach_evidence", target,
        evidence: { kind: String(f.get("kind")), description: String(f.get("description") ?? ""), reference: String(f.get("reference") ?? "") || undefined },
      }, () => "Saved: the evidence is attached (recorded as attached by a person, not as independent evidence).");
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-kind`}>Evidence type</label>
        <select className={s.select} id={`${id}-kind`} name="kind" defaultValue="funds_returned_confirmation">
          <option value="funds_returned_confirmation">Funds-returned confirmation</option>
          <option value="beneficiary_correction">Beneficiary correction</option>
          <option value="document_metadata">Document (metadata only)</option>
        </select>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-description`}>Description</label>
        <input className={s.input} id={`${id}-description`} name="description" required maxLength={300} />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-reference`}>Reference</label>
        <input className={s.input} id={`${id}-reference`} name="reference" maxLength={80} />
        <span className={s.hint}>For example the provider&rsquo;s confirmation number. No file is stored.</span>
      </div>
      <div><Submit busy={m.busy}>Attach evidence</Submit></div>
      <Result outcome={m.outcome} />
    </form>
  );
}

export function CaseDetailsForm({ caseId, priority, nextAction, dueDate }: { caseId: string; priority: string; nextAction: string | null; dueDate: string | null }) {
  const m = useMutation(`case:${caseId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const na = String(f.get("nextAction") ?? "").trim();
      const due = String(f.get("dueDate") ?? "");
      void m.run("PUT", `/api/control/cases/${encodeURIComponent(caseId)}`, { priority: String(f.get("priority")), nextAction: na || null, dueDate: due || null }, () => "Saved: priority, next action and due date updated.");
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-priority`}>Priority</label>
        <select className={s.select} id={`${id}-priority`} name="priority" defaultValue={priority}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-next`}>Next action</label>
        <input className={s.input} id={`${id}-next`} name="nextAction" defaultValue={nextAction ?? ""} maxLength={500} />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-due`}>Due date</label>
        <input className={s.input} id={`${id}-due`} name="dueDate" type="date" defaultValue={dueDate ?? ""} />
      </div>
      <div><Submit busy={m.busy}>Save case details</Submit></div>
      <Result outcome={m.outcome} />
    </form>
  );
}

export function ResolutionForm({ target, evidence }: { target: Target; evidence: { id: string; label: string }[] }) {
  const m = useMutation(`resolution:${target.kind}:${target.id}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const evidenceRefs = f.getAll("evidence").map(String);
      void m.run("POST", "/api/control/approvals", { target, note: String(f.get("note") ?? ""), evidenceRefs }, (d) => `Sent for approval: version ${String(d?.version ?? "?")} is waiting for an approver.`);
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-note`}>Proposed resolution</label>
        <textarea className={s.textarea} id={`${id}-note`} name="note" required minLength={10} maxLength={2000} aria-describedby={`${id}-note-hint`} />
        <span className={s.hint} id={`${id}-note-hint`}>At least 10 characters. A second person (an approver) must approve it before anything is resolved.</span>
      </div>
      <fieldset className={s.fieldset}>
        <legend>Evidence this resolution relies on</legend>
        {evidence.length === 0 ? <p className={s.small}>No evidence is recorded for this payment yet.</p> : evidence.map((e) => (
          <div className={s.check} key={e.id}>
            <input type="checkbox" id={`${id}-${e.id}`} name="evidence" value={e.id} />
            <label htmlFor={`${id}-${e.id}`}>{e.label} <span className={s.mono}>({e.id})</span></label>
          </div>
        ))}
      </fieldset>
      <div><Submit busy={m.busy}>Request approval</Submit></div>
      <Result outcome={m.outcome} />
    </form>
  );
}

/** After a decision the request is closed and this form is gone: the page shows the confirmation with FlashMessage `decision:<id>`. */
export function DecisionForm({ requestId, payloadSha256, version }: { requestId: string; payloadSha256: string; version: number }) {
  const m = useMutation(`decision:${requestId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const submitter = (ev.nativeEvent as SubmitEvent).submitter;
      const f = new FormData(ev.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
      const decision = f.get("decision") === "reject" ? "reject" : "approve";
      void m.run("POST", `/api/control/approvals/${encodeURIComponent(requestId)}/decision`, { decision, reason: String(f.get("reason") ?? ""), payloadSha256: String(f.get("payloadSha256") ?? "") },
        () => decision === "approve" ? `Approved version ${version}. The server applied the resolution.` : `Rejected version ${version}. Nothing was resolved.`);
    }}>
      <input type="hidden" name="payloadSha256" value={payloadSha256} />
      <p className={s.small}>You are deciding version {version}. Its SHA-256, sent with your decision so that a changed proposal is refused:</p>
      <p className={s.mono} data-testid="approval-hash">{payloadSha256}</p>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-reason`}>Reason for your decision</label>
        <textarea className={s.textarea} id={`${id}-reason`} name="reason" required minLength={3} maxLength={1000} />
      </div>
      <div className={s.row}>
        <button type="submit" name="decision" value="approve" className={s.button} disabled={m.busy}>Approve version {version}</button>
        <button type="submit" name="decision" value="reject" className={`${s.button} ${s.buttonDanger}`} disabled={m.busy}>Reject</button>
      </div>
      <Result outcome={m.outcome} />
    </form>
  );
}
