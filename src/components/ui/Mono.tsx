"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { explorerUrl, shortenMiddle, type HashKind } from "./logic";
import { IconCopy, IconExternal } from "./icons";
import u from "./ui.module.css";

/** Monospace text for hashes, addresses, references and ids (tabular figures). */
export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return <span className={[u.mono, className ?? ""].filter(Boolean).join(" ")} title={title}>{children}</span>;
}

/** A copy button: labelled, with "Copied" announced through aria-live. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // older browsers or a refused permission: select-and-copy fallback
      const t = document.createElement("textarea");
      t.value = value; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch { /* nothing more to try */ }
      t.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <button type="button" className={u.iconButton} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); void copy(); }}><IconCopy /></button>
      <span aria-live="polite" className={copied ? u.copied : u.srOnly}>{copied ? "Copied" : ""}</span>
    </>
  );
}

export interface HashLinkProps {
  /** The full hash or address. */
  value: string;
  /** The network id (tron, ethereum, polygon, base, arbitrum_one…); an explorer link appears only for known networks. */
  network?: string | null;
  kind?: HashKind;
  /** Characters kept at each end (default 6 and 4). */
  head?: number;
  tail?: number;
  /** Show the whole value instead of shortening it. */
  full?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * A shortened hash or address (the middle elided; the full value in title and in the accessible name), a copy button,
 * and a block-explorer link for the networks the code knows.
 */
export function HashLink({ value, network, kind = "tx", head = 6, tail = 4, full = false, className, ...rest }: HashLinkProps) {
  const short = full ? value : shortenMiddle(value, head, tail);
  const what = kind === "tx" ? "transaction hash" : "address";
  const href = explorerUrl(network, kind, value);
  return (
    <span className={[u.hash, className ?? ""].filter(Boolean).join(" ")} data-testid={rest["data-testid"]} data-value={value}>
      <span className={u.hashText} title={value}>
        <span aria-hidden={short !== value ? true : undefined}>{short}</span>
        {short !== value ? <span className={u.srOnly}>{value}</span> : null}
      </span>
      <CopyButton value={value} label={`Copy ${what} ${value}`} />
      {href ? (
        <a className={u.explorer} href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${what} in the ${network} block explorer (new tab)`} title="Open in block explorer"><IconExternal /></a>
      ) : null}
    </span>
  );
}
