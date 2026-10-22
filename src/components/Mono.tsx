"use client";

import { useState } from "react";
import { truncateMiddle } from "@/lib/format";

/** Long value truncated in the middle; full value on hover or focus; click copies. */
export function Mono({ value, head = 6, tail = 6 }: { value: string; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false);
  const short = truncateMiddle(value, head, tail);
  return (
    <button
      type="button"
      className="mono-btn"
      title={value}
      aria-label={`${value}. Click to copy.`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }, () => {});
      }}
    >
      <span className="mono-short">{short}</span>
      <span className="mono-full">{value}</span>
      {copied && <span className="faint" role="status"> copied</span>}
    </button>
  );
}
