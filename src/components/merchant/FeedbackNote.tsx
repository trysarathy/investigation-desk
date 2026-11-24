"use client";

import { useId, useRef, useState } from "react";
import m from "./merchant.module.css";

/**
 * Demo build only: "Note feedback" on every screen. Saves the screen's name and route, the signed-in member's role
 * (the server takes it from the session) and the note to the demo-only table demo_feedback
 * (POST /api/control/demo/feedback; 404 in any other build, refused for a non-demo organisation).
 * `npm run demo:feedback` writes them to docs/demo/FEEDBACK_<date>.md. Demo · fictional data.
 */
export function FeedbackNote() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const toggle = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const show = (v: boolean) => { setOpen(v); window.setTimeout(() => (v ? box.current?.focus() : toggle.current?.focus()), 0); };

  async function save(note: string) {
    const screen = (document.querySelector("main h1")?.textContent ?? document.title).trim().slice(0, 200) || "Untitled screen";
    const route = `${window.location.pathname}${window.location.search}`.slice(0, 500);
    setState({ busy: true, message: "Saving the note…" });
    try {
      const res = await fetch("/api/control/demo/feedback", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ screen, route, note }) });
      const body = (await res.json().catch(() => null)) as { saved?: { screen: string; role: string }; error?: { message?: string } } | null;
      if (res.ok) {
        setState({ busy: false, message: `Feedback saved for “${body?.saved?.screen ?? screen}” (${body?.saved?.role ?? "your role"}).` });
        if (box.current) box.current.value = "";
        setOpen(false);
        window.setTimeout(() => toggle.current?.focus(), 0);
        return;
      }
      setState({ busy: false, message: body?.error?.message ?? `The note was not saved (HTTP ${res.status}).` });
    } catch { setState({ busy: false, message: "The server could not be reached. The note was not saved." }); }
  }

  return (
    <span className={m.feedbackWrap} data-testid="feedback">
      <button ref={toggle} type="button" className={m.demoButton} aria-expanded={open} aria-controls={`${id}-form`} onClick={() => show(!open)} data-testid="feedback-toggle">Note feedback</button>
      <form
        id={`${id}-form`}
        className={m.feedbackForm}
        hidden={!open}
        aria-label="Feedback note"
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); show(false); } }}
        onSubmit={(ev) => { ev.preventDefault(); const note = String(new FormData(ev.currentTarget).get("note") ?? "").trim(); if (note) void save(note); else setState({ busy: false, message: "Write a note first." }); }}
        data-testid="feedback-form"
      >
        <label htmlFor={`${id}-note`}>Feedback on this screen (saved with the screen, its address, your role and the time)</label>
        <textarea ref={box} id={`${id}-note`} name="note" rows={3} maxLength={2000} disabled={state.busy} />
        <span className={m.feedbackActions}>
          <button type="submit" className={m.demoButton} disabled={state.busy} data-testid="feedback-save">Save note</button>
          <button type="button" className={m.demoButton} onClick={() => show(false)}>Cancel</button>
        </span>
      </form>
      {state.message ? <span role="status" data-testid="feedback-status"> {state.message}</span> : null}
    </span>
  );
}
