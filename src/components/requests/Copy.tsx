"use client";

import { useState } from "react";

/** Copies `text`; says so for a moment. Works without the clipboard API by selecting nothing and failing quietly. */
export function CopyButton({ text, label = "Copy", className = "btn btn-sm" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className} aria-live="polite"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }, () => {})}>
      {done ? "Copied" : label}
    </button>
  );
}
