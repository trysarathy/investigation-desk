"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isPaletteKey, matchItems, type PaletteItem } from "./logic";
import { IconSearch } from "./icons";
import u from "./ui.module.css";

export interface PaletteLink { href: string; label: string }

/** What the search route returns: ids the signed-in member may read in their own organisation (RLS). */
export interface PaletteSearchResult { payments: string[]; exceptions: string[]; batches: string[] }

export interface CommandPaletteProps {
  /** The nav pages for this member's role (the same filtered list the nav shows). */
  pages: readonly PaletteLink[];
  /** Actions this role may take (links only; never approve). */
  actions?: readonly PaletteLink[];
  /** Server search (GET ?q=); omit to search pages only. */
  searchUrl?: string;
  /** Builds the link for a search result. */
  hrefFor?: (kind: keyof PaletteSearchResult, id: string) => string;
  /** Label of the trigger button (default "Search"). */
  buttonLabel?: string;
  buttonClassName?: string;
}

const MERCHANT_HREF = (kind: keyof PaletteSearchResult, id: string) =>
  kind === "payments" ? `/control/merchant/payments/${encodeURIComponent(id)}` : kind === "exceptions" ? `/control/merchant/exceptions/${encodeURIComponent(id)}` : `/control/merchant/batches/${encodeURIComponent(id)}`;

const GROUP: Record<keyof PaletteSearchResult, string> = { payments: "Payments", exceptions: "Exceptions", batches: "Batches" };

/**
 * ⌘K / Ctrl+K command palette: a modal dialog with a combobox and a listbox. Sources: the member's nav pages, the
 * actions their role allows, and a server search of payment references, exception ids and batch ids (their own
 * organisation only, through the tenant read path). It only navigates; it never approves anything.
 */
export function CommandPalette({ pages, actions = [], searchUrl, hrefFor = MERCHANT_HREF, buttonLabel = "Search", buttonClassName }: CommandPaletteProps) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<PaletteItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const local = useMemo<PaletteItem[]>(() => [
    ...pages.map((p) => ({ id: `page:${p.href}`, label: p.label, group: "Pages", href: p.href })),
    ...actions.map((a) => ({ id: `action:${a.href}:${a.label}`, label: a.label, group: "Actions", href: a.href })),
  ], [pages, actions]);
  const items = useMemo(() => [...matchItems(local.filter((i) => i.group === "Pages"), q), ...matchItems(local.filter((i) => i.group === "Actions"), q), ...remote], [local, q, remote]);

  const close = useCallback(() => { setOpen(false); setQ(""); setRemote([]); setSel(0); requestAnimationFrame(() => trigger.current?.focus()); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (isPaletteKey(e)) { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) requestAnimationFrame(() => input.current?.focus()); }, [open]);
  useEffect(() => { setSel(0); }, [q]);

  useEffect(() => {
    if (!open || !searchUrl) return;
    const term = q.trim();
    if (term.length < 2) { setRemote([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`${searchUrl}?q=${encodeURIComponent(term)}`, { signal: ctl.signal, headers: { accept: "application/json" } });
        if (!res.ok) { setRemote([]); return; }
        const r = (await res.json()) as Partial<PaletteSearchResult>;
        setRemote((Object.keys(GROUP) as (keyof PaletteSearchResult)[]).flatMap((k) => (r[k] ?? []).map((v) => ({ id: `${k}:${v}`, label: v, group: GROUP[k], href: hrefFor(k, v), hint: GROUP[k].replace(/s$/, "") }))));
      } catch { /* aborted or offline: keep the local results */ } finally { setBusy(false); }
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open, searchUrl, hrefFor]);

  const go = (i: PaletteItem | undefined) => { if (!i) return; close(); router.push(i.href); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setSel(0); }
    else if (e.key === "Enter") { e.preventDefault(); go(items[sel]); }
    else if (e.key === "Tab") {
      // focus stays in the dialog
      const f = dialog.current?.querySelectorAll<HTMLElement>("input, button");
      if (f && f.length) { const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }
  };

  useEffect(() => { document.getElementById(`${id}-o${sel}`)?.scrollIntoView({ block: "nearest" }); }, [sel, id]);

  const groups: { name: string; items: { it: PaletteItem; i: number }[] }[] = [];
  items.forEach((it, i) => { const g = groups.find((x) => x.name === it.group); if (g) g.items.push({ it, i }); else groups.push({ name: it.group, items: [{ it, i }] }); });
  return (
    <>
      <button type="button" ref={trigger} className={buttonClassName ?? u.button} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" data-testid="command-palette-button">
        <IconSearch /> {buttonLabel} <span className={u.kbd} aria-hidden="true">⌘K</span>
      </button>
      {open ? (
        <div className={u.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className={u.dialog} role="dialog" aria-modal="true" aria-label="Command palette" ref={dialog} onKeyDown={onKeyDown}>
            <div className={u.dialogHead}>
              <IconSearch size={16} />
              <input ref={input} className={u.paletteInput} role="combobox" aria-expanded={items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
                aria-activedescendant={items[sel] ? `${id}-o${sel}` : undefined} aria-label="Search pages, payments, exceptions and batches" placeholder="Search pages, payment references, exception or batch ids…"
                value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
              <button type="button" className={u.iconButton} aria-label="Close" onClick={close}>Esc</button>
            </div>
            <div className={u.listbox} id={`${id}-list`} role="listbox" aria-label="Results">
              {groups.map((g) => (
                <div key={g.name} role="group" aria-labelledby={`${id}-g-${g.name}`}>
                  <div className={u.groupLabel} id={`${id}-g-${g.name}`}>{g.name}</div>
                  {g.items.map(({ it, i }) => (
                    <div key={it.id} id={`${id}-o${i}`} role="option" aria-selected={i === sel} className={u.option} onMouseMove={() => setSel(i)} onClick={() => go(it)}>
                      <span>{it.label}</span>{it.hint ? <span className={u.optionHint}>{it.hint}</span> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {items.length === 0 ? <p className={u.empty}>{busy ? "Searching…" : "No matches."}</p> : null}
            <div className={u.dialogFoot} aria-hidden="true"><span><span className={u.kbd}>↑</span> <span className={u.kbd}>↓</span> move</span><span><span className={u.kbd}>Enter</span> open</span><span><span className={u.kbd}>Esc</span> close</span></div>
            <span className={u.srOnly} aria-live="polite">{busy ? "Searching" : `${items.length} results`}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
