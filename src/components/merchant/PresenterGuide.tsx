"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GUIDE_LOGINS, GUIDE_STEPS, type GuideStep } from "@/lib/clearline/demo/guide";
import m from "./merchant.module.css";

/**
 * Demo build only: the presenter guide, a side panel with the 13 steps of the demo journey, each with "Go there" and
 * two or three talking points. The layout imports it only inside the demo-build branch (DemoBar) and renders it only
 * for a demo organisation (Demo · fictional data). "Go there" for a step that needs another seeded user signs in as
 * them through the demo role switcher first (a real session for that user; every rule still applies), then opens the
 * step's screen. Keyboard: the toggle opens the panel and moves focus into it; Escape or "Close" closes it and returns
 * focus to the toggle. Whether the panel is open is remembered for this tab only (sessionStorage), so it stays open
 * across "Go there".
 */
const KEY = "clearline-demo-guide-open";
const remembered = () => { try { return window.sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = (open: boolean) => { try { window.sessionStorage.setItem(KEY, open ? "1" : "0"); } catch { /* private window: not remembered */ } };

export function PresenterGuide({ current }: { current: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => { if (remembered()) setOpen(true); }, []);
  const show = (v: boolean, focus = true) => {
    setOpen(v); remember(v);
    if (focus) window.setTimeout(() => (v ? panel.current?.focus() : toggle.current?.focus()), 0);
  };

  async function go(step: GuideStep) {
    const who = GUIDE_LOGINS[step.as];
    if (who.email === current) { window.location.assign(step.path); return; }
    setBusy(true);
    setMessage(`Signing in as ${who.label} (${who.email})…`);
    try {
      const res = await fetch("/api/control/demo/switch", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: who.email }) });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) { window.location.assign(step.path); return; }
      setMessage(body?.error?.message ?? `The switch was refused (HTTP ${res.status}). Nothing changed.`);
    } catch { setMessage("The server could not be reached. Nothing changed."); }
    setBusy(false);
  }

  return (
    <span className={m.guideWrap} data-testid="presenter-guide" data-demo-build="clearline-demo-guide[demo-build-only]">
      <button ref={toggle} type="button" className={m.demoButton} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => show(!open)} data-testid="guide-toggle">
        Presenter guide
      </button>
      <div
        ref={panel}
        id={`${id}-panel`}
        className={m.guidePanel}
        role="region"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        hidden={!open}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); show(false); } }}
        data-testid="guide-panel"
      >
        <div className={m.guideHead}>
          <p className={m.guideTitle} id={`${id}-title`}>Presenter guide · 13 steps</p>
          <button type="button" className={m.demoButton} onClick={() => show(false)} data-testid="guide-close">Close</button>
        </div>
        <p className={m.guideNote}>Demo · fictional data. &ldquo;Go there&rdquo; signs in as the step&rsquo;s user through the switcher when needed; every rule still applies.</p>
        {message ? <p className={m.guideNote} role="status">{message}</p> : null}
        <ol className={m.guideList}>
          {GUIDE_STEPS.map((s) => {
            const who = GUIDE_LOGINS[s.as];
            const other = who.email !== current;
            return (
              <li key={s.n} className={m.guideStep} data-testid={`guide-step-${s.n}`}>
                <p className={m.guideStepTitle}><span className={m.guideNum}>{s.n}</span> {s.title}</p>
                <ul className={m.guidePoints}>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
                <button type="button" className={m.demoButton} disabled={busy} onClick={() => void go(s)} aria-label={`Go there${other ? ` (as ${who.label})` : ""}: step ${s.n}, ${s.title}`} data-testid={`guide-go-${s.n}`}>
                  Go there{other ? ` (as ${who.label})` : ""}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </span>
  );
}
