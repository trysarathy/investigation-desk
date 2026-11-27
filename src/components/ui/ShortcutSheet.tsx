"use client";

import { useEffect, useRef, useState } from "react";
import { SHORTCUTS, isShortcutSheetKey } from "./logic";
import u from "./ui.module.css";

/** "?" opens a dialog listing the keyboard shortcuts (ignored while typing in a field). Escape or the button closes it. */
export function ShortcutSheet() {
  const [open, setOpen] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcutSheetKey(e)) { e.preventDefault(); back.current = document.activeElement as HTMLElement | null; setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) requestAnimationFrame(() => closeBtn.current?.focus()); }, [open]);
  if (!open) return null;
  const close = () => { setOpen(false); back.current?.focus?.(); };
  return (
    <div className={u.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={u.dialog} role="dialog" aria-modal="true" aria-labelledby="cl-shortcuts-title" onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); if (e.key === "Escape") close(); } }}>
        <div className={u.dialogHead}>
          <h2 id="cl-shortcuts-title" style={{ flex: 1, margin: 0, fontSize: 16 }}>Keyboard shortcuts</h2>
          <button type="button" ref={closeBtn} className={u.button} onClick={close}>Close</button>
        </div>
        <div className={u.sheet}>
          <dl className={u.sheetList}>
            {SHORTCUTS.map((s) => (
              <div key={s.does} style={{ display: "contents" }}>
                <dt>{s.keys.map((k) => <kbd key={k} className={u.kbd}>{k}</kbd>)}</dt>
                <dd>{s.does}</dd>
              </div>
            ))}
          </dl>
          <p style={{ fontSize: 13, color: "var(--cl-muted)" }}>Approving has no shortcut: it always takes a click and a confirmation.</p>
        </div>
      </div>
    </div>
  );
}
