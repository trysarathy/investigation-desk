"use client";
import { useState, type FormEvent } from "react";
import { EMAIL, mailto } from "@/lib/site";

const id = process.env.NEXT_PUBLIC_FORMSPREE_ID;
/** The form renders only when a real Formspree ID is configured. Otherwise: email only, no fake success. */
export const FORM_ENABLED = !!id && id !== "FORM_ID" && /^[a-zA-Z0-9]+$/.test(id);

export function EmailPanel() {
  return (
    <div className="panel">
      <p className="label">Email the founder</p>
      <p><a className="text-link big-link" href={mailto("Clearline: our payment workflow")}>{EMAIL}</a></p>
      <p className="caption">Describe the workflow in a few sentences: what breaks, who owns it, what you use today. Do not attach payment records, beneficiary details, statements or credentials.</p>
      <p className="caption">There is no web form on this site yet, so nothing is collected here.</p>
    </div>
  );
}

export default function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState("");
  if (!FORM_ENABLED) return <EmailPanel />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const data = new FormData(form);
    if (String(data.get("_gotcha") || "").trim()) return;
    setState("sending"); setError("");
    try {
      const response = await fetch("https://formspree.io/f/" + id, { method: "POST", headers: { Accept: "application/json" }, body: data });
      if (!response.ok) throw new Error("Your message was not sent. Please email " + EMAIL + " instead.");
      setState("sent"); form.reset();
    } catch (ex) { setState("failed"); setError(ex instanceof Error ? ex.message : "Message not sent."); }
  }
  if (state === "sent") return <div className="toast toast-success" role="status"><b>Message sent.</b> Thank you. The founder replies by email.</div>;
  return (
    <form onSubmit={submit} className="form" aria-label="Contact the founder">
      <p className="caption">Do not include payment records, beneficiary details, statements or credentials.</p>
      <label className="field">Name<input name="name" required maxLength={120} autoComplete="name" /></label>
      <label className="field">Work email<input name="email" required type="email" maxLength={180} autoComplete="email" /></label>
      <label className="field">Company<input name="company" maxLength={140} autoComplete="organization" /></label>
      <label className="field">Which workflow is hardest today?<textarea name="message" rows={4} maxLength={1500} required /></label>
      <div hidden aria-hidden="true"><input name="_gotcha" tabIndex={-1} autoComplete="off" /></div>
      {state === "failed" && <div className="toast toast-error" role="alert">{error}</div>}
      <button disabled={state === "sending"} type="submit" className="btn btn-primary">{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}
