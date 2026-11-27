"use client";

import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import s from "./control.module.css";
import { Submit, useMutation, Result } from "./forms";

/**
 * Sign-in security forms (v1 phase 1.2): the second step of sign-in, password reset, e-mail verification, MFA set-up,
 * step-up, passkeys, recovery codes and sessions. Every outcome shown is the server's answer; nothing is shown as
 * done before the server has said so. One-time links carry their token in the URL fragment, read here and removed
 * from the address bar at once.
 */

type Json = Record<string, unknown> | null;
function key(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `ui-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
async function post(url: string, body: unknown = {}): Promise<{ ok: boolean; status: number; data: Json }> {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": key() }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => null)) as Json };
}
const message = (r: { status: number; data: Json }, fallback: string) => {
  if (r.status === 429) return "Too many attempts. Wait a few minutes, then try again.";
  const e = (r.data?.error as { message?: string } | undefined)?.message ?? (r.data?.message as string | undefined);
  return e && r.status !== 401 ? e : fallback;
};
function fragmentToken(): string | null {
  const m = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
  if (!m) return null;
  history.replaceState(null, "", window.location.pathname); // the token never stays in the address bar or history
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

// ---- WebAuthn (browser side). The server (src/server/webauthn.ts) verifies everything. --------------------------
const toBuf = (v: string) => { const b = atob(v.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(v.length / 4) * 4, "=")); return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer; };
const toB64 = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null);
type Desc = { type: "public-key"; id: string; transports?: string[] };
const descs = (d: unknown) => ((d as Desc[] | undefined) ?? []).map((c) => ({ type: "public-key" as const, id: toBuf(c.id), transports: c.transports as AuthenticatorTransport[] | undefined }));

async function getAssertion(optionsUrl: string): Promise<unknown> {
  const o = await post(optionsUrl);
  if (!o.ok || !o.data) throw new Error(message(o, "No passkey is available for this account."));
  const d = o.data as { challenge: string; rpId: string; timeout: number; allowCredentials: unknown };
  const cred = (await navigator.credentials.get({ publicKey: { challenge: toBuf(d.challenge), rpId: d.rpId, timeout: d.timeout, userVerification: "required", allowCredentials: descs(d.allowCredentials) } })) as PublicKeyCredential | null;
  if (!cred) throw new Error("The passkey was not used.");
  const r = cred.response as AuthenticatorAssertionResponse;
  return { id: cred.id, rawId: toB64(cred.rawId), type: cred.type, response: { clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature), userHandle: toB64(r.userHandle) } };
}

// ---- sign-in, second step ------------------------------------------------------------------------------------------
export function TwoFactorChallenge() {
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function done(r: { ok: boolean; status: number; data: Json }) {
    if (r.ok) { window.location.assign("/control/home"); return; }
    setError(r.status === 401 && /COOKIE/.test(JSON.stringify(r.data)) ? "This sign-in has expired. Sign in with your password again." : message(r, "That code is not right. Try again."));
    setBusy(false);
  }
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const code = String(new FormData(ev.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true); setError(null);
    try { await done(await post(mode === "totp" ? "/api/auth/two-factor/verify-totp" : "/api/auth/two-factor/verify-backup-code", { code })); }
    catch { setError("The server could not be reached."); setBusy(false); }
  }
  async function passkey() {
    setBusy(true); setError(null);
    try { await done(await post("/api/auth/clearline/passkey/sign-in", { credential: await getAssertion("/api/auth/clearline/passkey/sign-in-options") })); }
    catch (e) { setError(e instanceof Error ? e.message : "The passkey was not used."); setBusy(false); }
  }
  return (
    <>
      <form method="post" className={s.form} autoComplete="off" onSubmit={onSubmit}>
        <div className={s.field}>
          <label className={s.label} htmlFor="code">{mode === "totp" ? "6-digit code from your authenticator app" : "Recovery code"}</label>
          <input className={s.input} id="code" name="code" required autoComplete="one-time-code" {...(mode === "totp" ? { inputMode: "numeric" as const, pattern: "[0-9 ]{6,7}", maxLength: 7 } : { maxLength: 20 })} />
        </div>
        <div><Submit busy={busy}>{busy ? "Checking…" : "Continue"}</Submit></div>
        <p role="alert" className={`${s.result} ${s.resultError}`}>{error ?? ""}</p>
      </form>
      <p className={s.row}>
        <button type="button" className={s.linkButton} onClick={() => { setMode(mode === "totp" ? "recovery" : "totp"); setError(null); }}>{mode === "totp" ? "Use a recovery code instead" : "Use the authenticator app instead"}</button>
        <span aria-hidden="true">·</span>
        <button type="button" className={s.linkButton} onClick={passkey} disabled={busy}>Use a passkey</button>
      </p>
    </>
  );
}

// ---- password reset ------------------------------------------------------------------------------------------------
export function ForgotPasswordForm() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true); setNote(null);
    try {
      const r = await post("/api/auth/request-password-reset", { email: String(new FormData(ev.currentTarget).get("email") ?? "") });
      setNote(r.ok ? { ok: true, text: String(r.data?.message ?? "If this address belongs to an account, a reset link is on its way.") } : { ok: false, text: message(r, "The request was refused.") });
    } catch { setNote({ ok: false, text: "The server could not be reached." }); }
    setBusy(false);
  }
  return (
    <form method="post" className={s.form} onSubmit={onSubmit}>
      <div className={s.field}>
        <label className={s.label} htmlFor="email">Email</label>
        <input className={s.input} id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div><Submit busy={busy}>{busy ? "Sending…" : "Send reset link"}</Submit></div>
      <p role={note && !note.ok ? "alert" : "status"} className={`${s.result} ${note?.ok ? s.resultOk : s.resultError}`}>{note?.text ?? ""}</p>
    </form>
  );
}

export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setToken(fragmentToken()); }, []);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const pw = String(f.get("password") ?? ""), again = String(f.get("confirm") ?? "");
    if (pw !== again) { setNote({ ok: false, text: "The two passwords are not the same." }); return; }
    setBusy(true); setNote(null);
    try {
      const r = await post("/api/auth/reset-password", { token, newPassword: pw });
      setNote(r.ok ? { ok: true, text: "Your password is changed and you are signed out everywhere. Sign in with the new password." } : { ok: false, text: r.status === 429 ? message(r, "") : "This link is not valid. It may have been used already or expired; ask for a new one." });
      if (r.ok) setToken(null);
    } catch { setNote({ ok: false, text: "The server could not be reached." }); }
    setBusy(false);
  }
  if (token === undefined) return null;
  if (!token) return <p role={note ? "status" : "alert"} className={`${s.result} ${note?.ok ? s.resultOk : s.resultError}`}>{note?.text ?? "This page needs the link from your reset e-mail."} <a href="/control/sign-in">Sign in</a></p>;
  return (
    <form method="post" className={s.form} onSubmit={onSubmit}>
      <div className={s.field}>
        <label className={s.label} htmlFor="password">New password</label>
        <input className={s.input} id="password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="pw-hint" />
        <span className={s.hint} id="pw-hint">At least 12 characters.</span>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="confirm">New password again</label>
        <input className={s.input} id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </div>
      <div><Submit busy={busy}>{busy ? "Saving…" : "Set new password"}</Submit></div>
      <p role={note && !note.ok ? "alert" : "status"} className={`${s.result} ${note?.ok ? s.resultOk : s.resultError}`}>{note?.text ?? ""}</p>
    </form>
  );
}

export function VerifyEmailForm() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setToken(fragmentToken()); }, []);
  async function verify() {
    setBusy(true); setNote(null);
    try {
      const r = await post("/api/control/security/verify-email", { token });
      setNote(r.ok ? { ok: true, text: "Your e-mail address is verified." } : { ok: false, text: message(r, "This link is not valid.") });
      if (r.ok) setToken(null);
    } catch { setNote({ ok: false, text: "The server could not be reached." }); }
    setBusy(false);
  }
  if (token === undefined) return null;
  return (
    <>
      {token ? <p><button type="button" className={s.button} onClick={verify} disabled={busy}>{busy ? "Verifying…" : "Verify my e-mail address"}</button></p>
        : !note ? <p role="alert" className={`${s.result} ${s.resultError}`}>This page needs the link from your verification e-mail.</p> : null}
      <p role={note && !note.ok ? "alert" : "status"} className={`${s.result} ${note?.ok ? s.resultOk : s.resultError}`}>{note?.text ?? ""}</p>
    </>
  );
}

// ---- the Security page ---------------------------------------------------------------------------------------------
function Codes({ codes }: { codes: string[] }) {
  return (
    <div className={s.panel} data-testid="recovery-codes">
      <p><strong>Your recovery codes.</strong> Each works once if you lose your authenticator. Save them somewhere safe now; they are not shown again.</p>
      <ul className={s.mono}>{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <button type="button" className={s.button} onClick={() => window.location.reload()}>I have saved them</button>
    </div>
  );
}

export function EnrolTotp() {
  const [step, setStep] = useState<{ uri: string; secret: string; qr: string; codes: string[] } | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function start(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await post("/api/auth/two-factor/enable", { password: String(new FormData(ev.currentTarget).get("password") ?? "") });
      if (!r.ok) { setError(/PASSWORD/.test(JSON.stringify(r.data)) ? "That password is not right." : message(r, "Set-up was refused.")); setBusy(false); return; }
      const uri = String(r.data?.totpURI ?? "");
      setStep({ uri, secret: new URL(uri).searchParams.get("secret") ?? "", qr: await QRCode.toDataURL(uri, { margin: 1, width: 200 }), codes: (r.data?.backupCodes as string[]) ?? [] });
    } catch { setError("The server could not be reached."); }
    setBusy(false);
  }
  async function confirm(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await post("/api/auth/two-factor/verify-totp", { code: String(new FormData(ev.currentTarget).get("code") ?? "").replace(/\s/g, "") });
      if (r.ok) { setSaved(step?.codes ?? []); setBusy(false); return; }
      setError(message(r, "That code is not right. Check the time on your phone and try again."));
    } catch { setError("The server could not be reached."); }
    setBusy(false);
  }
  if (saved) return <Codes codes={saved} />;
  if (!step) return (
    <form method="post" className={s.form} onSubmit={start} aria-label="Set up an authenticator app">
      <div className={s.field}>
        <label className={s.label} htmlFor="enrol-password">Your password</label>
        <input className={s.input} id="enrol-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div><Submit busy={busy}>{busy ? "Starting…" : "Set up an authenticator app"}</Submit></div>
      <p role="alert" className={`${s.result} ${s.resultError}`}>{error ?? ""}</p>
    </form>
  );
  return (
    <form method="post" className={s.form} onSubmit={confirm} aria-label="Confirm the authenticator app">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={step.qr} width={200} height={200} alt="QR code to scan with your authenticator app" />
      <p className={s.small}>Can’t scan it? Enter this key in the app: <code className={s.mono} data-testid="totp-secret">{step.secret}</code></p>
      <div className={s.field}>
        <label className={s.label} htmlFor="enrol-code">6-digit code from the app</label>
        <input className={s.input} id="enrol-code" name="code" required inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} autoComplete="one-time-code" />
      </div>
      <div><Submit busy={busy}>{busy ? "Checking…" : "Turn on"}</Submit></div>
      <p role="alert" className={`${s.result} ${s.resultError}`}>{error ?? ""}</p>
    </form>
  );
}

/** Confirm it is you: a second factor if you have one, otherwise your password. */
export function StepUp({ mfaEnrolled, hasPasskey }: { mfaEnrolled: boolean; hasPasskey: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  async function finish(r: { ok: boolean; status: number; data: Json }) {
    if (r.ok) { window.location.reload(); return; }
    setError(message(r, mfaEnrolled ? "That code is not right." : "That password is not right.")); setBusy(false);
  }
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = String(new FormData(ev.currentTarget).get("secret") ?? "");
    setBusy(true); setError(null);
    try {
      await finish(!mfaEnrolled ? await post("/api/control/security/step-up", { password: v })
        : await post(recovery ? "/api/auth/two-factor/verify-backup-code" : "/api/auth/two-factor/verify-totp", { code: v.replace(/\s/g, "") }));
    } catch { setError("The server could not be reached."); setBusy(false); }
  }
  async function passkey() {
    setBusy(true); setError(null);
    try { await finish(await post("/api/auth/clearline/passkey/step-up", { credential: await getAssertion("/api/auth/clearline/passkey/step-up-options") })); }
    catch (e) { setError(e instanceof Error ? e.message : "The passkey was not used."); setBusy(false); }
  }
  const label = !mfaEnrolled ? "Your password" : recovery ? "Recovery code" : "6-digit code from your authenticator app";
  return (
    <form method="post" className={s.form} onSubmit={onSubmit} aria-label="Confirm it is you">
      <div className={s.field}>
        <label className={s.label} htmlFor="step-up">{label}</label>
        <input className={s.input} id="step-up" name="secret" required {...(!mfaEnrolled ? { type: "password", autoComplete: "current-password" } : { autoComplete: "one-time-code", inputMode: recovery ? undefined : ("numeric" as const) })} />
      </div>
      <div className={s.row}>
        <Submit busy={busy}>{busy ? "Checking…" : "Confirm"}</Submit>
        {mfaEnrolled ? <button type="button" className={s.linkButton} onClick={() => setRecovery(!recovery)}>{recovery ? "Use the app instead" : "Use a recovery code"}</button> : null}
        {mfaEnrolled && hasPasskey ? <button type="button" className={s.linkButton} onClick={passkey} disabled={busy}>Use a passkey</button> : null}
      </div>
      <p role="alert" className={`${s.result} ${s.resultError}`}>{error ?? ""}</p>
    </form>
  );
}

export function RegenerateCodes() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await post("/api/auth/two-factor/generate-backup-codes", { password: String(new FormData(ev.currentTarget).get("password") ?? "") });
      if (r.ok) setCodes((r.data?.backupCodes as string[]) ?? []);
      else setError(/PASSWORD/.test(JSON.stringify(r.data)) ? "That password is not right." : message(r, "Refused."));
    } catch { setError("The server could not be reached."); }
    setBusy(false);
  }
  if (codes) return <Codes codes={codes} />;
  return (
    <form method="post" className={s.form} onSubmit={onSubmit} aria-label="New recovery codes">
      <div className={s.field}>
        <label className={s.label} htmlFor="codes-password">Your password</label>
        <input className={s.input} id="codes-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div><Submit busy={busy} variant="secondary">{busy ? "Working…" : "Replace my recovery codes"}</Submit></div>
      <p role="alert" className={`${s.result} ${s.resultError}`}>{error ?? ""}</p>
    </form>
  );
}

export function AddPasskey() {
  const m = useMutation("passkey-add");
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const name = String(new FormData(ev.currentTarget).get("name") ?? "").trim();
    setError(null);
    try {
      const o = await post("/api/auth/clearline/passkey/register-options");
      if (!o.ok || !o.data) { setError(message(o, "Refused.")); return; }
      const d = o.data as { challenge: string; rp: { id: string; name: string }; user: { id: string; name: string; displayName: string }; pubKeyCredParams: PublicKeyCredentialParameters[]; timeout: number; excludeCredentials: unknown };
      const cred = (await navigator.credentials.create({ publicKey: { challenge: toBuf(d.challenge), rp: d.rp, user: { ...d.user, id: toBuf(d.user.id) }, pubKeyCredParams: d.pubKeyCredParams, timeout: d.timeout, attestation: "none", authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, excludeCredentials: descs(d.excludeCredentials) } })) as PublicKeyCredential | null;
      if (!cred) { setError("The passkey was not created."); return; }
      const r = cred.response as AuthenticatorAttestationResponse;
      await m.run("POST", "/api/auth/clearline/passkey/register", { name, credential: { id: cred.id, rawId: toB64(cred.rawId), type: cred.type, response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject), transports: r.getTransports?.() ?? [] } } }, () => `Passkey “${name}” added.`);
    } catch { setError("The passkey was not created."); }
  }
  return (
    <form method="post" className={s.form} onSubmit={onSubmit} aria-label="Add a passkey">
      <div className={s.field}>
        <label className={s.label} htmlFor="pk-name">Name for this passkey</label>
        <input className={s.input} id="pk-name" name="name" required maxLength={60} placeholder="Work laptop" />
      </div>
      <div><Submit busy={m.busy} variant="secondary">Add a passkey</Submit></div>
      {error ? <p role="alert" className={`${s.result} ${s.resultError}`}>{error}</p> : <Result outcome={m.outcome} />}
    </form>
  );
}

export function ActionButton({ url, body, label, done, flashKey, variant, confirmText }: { url: string; body?: unknown; label: string; done: string; flashKey: string; variant?: "secondary" | "danger"; confirmText?: string }) {
  const m = useMutation(flashKey);
  return (
    <span>
      <button type="button" className={`${s.button} ${variant === "danger" ? s.buttonDanger : variant === "secondary" ? s.buttonSecondary : ""}`} disabled={m.busy}
        onClick={() => { if (confirmText && !window.confirm(confirmText)) return; void m.run("POST", url, body ?? {}, () => done); }}>{label}</button>
      <Result outcome={m.outcome} />
    </span>
  );
}

export function OrgMfaPolicyForm({ requireAll }: { requireAll: boolean }) {
  const m = useMutation("org-mfa-policy");
  const [value, setValue] = useState(requireAll);
  return (
    <form method="post" className={s.form} onSubmit={(ev) => { ev.preventDefault(); void m.run("POST", "/api/control/security/org-mfa-policy", { requireMfaAll: value }, () => (value ? "Every member now needs multi-factor sign-in." : "Only Admins and Approvers now need multi-factor sign-in.")); }}>
      <label className={s.check}><input type="checkbox" checked={value} onChange={(e) => setValue(e.target.checked)} /> Require multi-factor sign-in for every member (Admins and Approvers always need it)</label>
      <div><Submit busy={m.busy} variant="secondary">Save sign-in policy</Submit></div>
      <Result outcome={m.outcome} />
    </form>
  );
}
