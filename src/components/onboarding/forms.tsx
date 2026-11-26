"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Result, Submit, useMutation } from "@/components/control/forms";
import s from "@/components/control/control.module.css";

/**
 * v1 phase 1.1 onboarding forms: the platform console, the invitation acceptance and the setup wizard. Same contract
 * as the other Control forms: the server checks the session, the Origin, the role (and the database checks it again
 * through the provisioning role); the page reloads on success so what is shown is what the database holds; a refusal
 * shows the server's message. Nothing is shown as done before the server has said so.
 */

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "email" | "select" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  defaultValue?: string;
  autoComplete?: string;
  maxLength?: number;
  pattern?: string;
}

/** One declarative form posting its fields as JSON (empty optional fields are left out). */
export function JsonForm({ flashKey, url, fields, submit, success, extra, variant }: {
  flashKey: string; url: string; fields: FieldDef[]; submit: string; success: string; extra?: Record<string, string>; variant?: "secondary";
}) {
  const x = useMutation(flashKey);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const body: Record<string, string> = { ...extra };
      for (const d of fields) {
        const v = String(f.get(d.name) ?? "").trim();
        if (v !== "" || d.required) body[d.name] = v;
      }
      void x.run("POST", url, body, () => success);
    }}>
      {fields.map((d) => {
        const fid = `${id}-${d.name}`;
        const hint = d.hint ? `${fid}-hint` : undefined;
        const common = { id: fid, name: d.name, required: d.required, defaultValue: d.defaultValue, "aria-describedby": hint };
        return (
          <div className={s.field} key={d.name}>
            <label className={s.label} htmlFor={fid}>{d.label}{d.required ? "" : " (optional)"}</label>
            {d.type === "select" ? (
              <select className={s.select} {...common}>{(d.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            ) : d.type === "textarea" ? (
              <textarea className={s.textarea} rows={3} maxLength={d.maxLength} {...common} />
            ) : (
              <input className={s.input} type={d.type ?? "text"} autoComplete={d.autoComplete ?? "off"} maxLength={d.maxLength} pattern={d.pattern} {...common} />
            )}
            {d.hint ? <p className={`${s.small} ${s.muted}`} id={hint}>{d.hint}</p> : null}
          </div>
        );
      })}
      <div><Submit busy={x.busy} variant={variant}>{submit}</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

/** A single-button action (mark a step done, finish setup, revoke an invitation). */
export function ActionButton({ flashKey, url, body, label, success, variant }: { flashKey: string; url: string; body: Record<string, string>; label: string; success: string; variant?: "secondary" | "danger" }) {
  const x = useMutation(flashKey);
  return (
    <form autoComplete="off" onSubmit={(ev) => { ev.preventDefault(); void x.run("POST", url, body, () => success); }}>
      <Submit busy={x.busy} variant={variant}>{label}</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

/**
 * The invitation page's form. The one-time token is read from the link's #fragment (never sent to the server with
 * the page request) and removed from the address bar once accepted.
 */
export function AcceptInvitationForm() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "error"; message: string } | { kind: "done"; existing: boolean; role: string }>({ kind: "idle" });
  useEffect(() => {
    const m = /(?:^|[#&])token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
    setToken(m ? m[1] : "");
  }, []);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const password = String(f.get("password") ?? ""), confirm = String(f.get("confirm") ?? "");
    if (password && password !== confirm) { setState({ kind: "error", message: "The two passwords are not the same." }); return; }
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/control/invitations/accept", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: String(f.get("name") ?? "").trim() || undefined, password: password || undefined }),
      });
      const data = (await res.json().catch(() => null)) as { role?: string; existingUser?: boolean; error?: { message?: string } } | null;
      if (!res.ok) { setState({ kind: "error", message: data?.error?.message ?? `The server refused this (HTTP ${res.status}).` }); return; }
      window.history.replaceState(null, "", window.location.pathname);
      setState({ kind: "done", existing: !!data?.existingUser, role: String(data?.role ?? "") });
    } catch { setState({ kind: "error", message: "The server could not be reached. Nothing was confirmed." }); }
  }
  if (token === null) return <p className={s.small} role="status">Reading the invitation link…</p>;
  if (token === "") return <p role="alert" className={`${s.result} ${s.resultError}`}>This page needs the invitation link from your email. Open the link from the email again.</p>;
  if (state.kind === "done") {
    return (
      <div role="status" data-testid="invite-accepted">
        <p className={`${s.result} ${s.resultOk}`}>Invitation accepted. {state.existing ? "You already had an account: sign in with your existing password." : "Your account is ready."}</p>
        <p><a href="/control/sign-in">Sign in</a></p>
      </div>
    );
  }
  return (
    <form className={s.form} autoComplete="off" onSubmit={onSubmit}>
      <div className={s.field}>
        <label className={s.label} htmlFor="invite-name">Your name</label>
        <input className={s.input} id="invite-name" name="name" type="text" autoComplete="name" maxLength={200} aria-describedby="invite-name-hint" />
        <p className={`${s.small} ${s.muted}`} id="invite-name-hint">Leave the name and password empty if you already have a Clearline account.</p>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="invite-password">Choose a password</label>
        <input className={s.input} id="invite-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} aria-describedby="invite-password-hint" />
        <p className={`${s.small} ${s.muted}`} id="invite-password-hint">At least 12 characters.</p>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="invite-confirm">Repeat the password</label>
        <input className={s.input} id="invite-confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} />
      </div>
      <div><Submit busy={state.kind === "busy"}>{state.kind === "busy" ? "Accepting…" : "Accept invitation"}</Submit></div>
      <p role="alert" className={`${s.result} ${s.resultError}`}>{state.kind === "error" ? state.message : ""}</p>
    </form>
  );
}
