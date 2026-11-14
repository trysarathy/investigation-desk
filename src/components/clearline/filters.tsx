"use client";
/**
 * Table filters kept in the URL query, so a filtered view can be shared and Back/Forward walk through
 * the filters a person chose. A select change is one history entry; typing in search updates the
 * current entry (debounced) so Back does not step through every keystroke.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "./Link";
import s from "./ui.module.css";

export type Option = { value: string; label: string };

/*
 * Filter changes made while an earlier one is still loading must build on it, not on the URL that is
 * still showing (two quick changes would otherwise drop the first). Requested queries wait here until
 * the router commits them; Back/Forward or any other URL clears the queue.
 */
let requested: { path: string; search: string }[] = [];
let lastCommitted: string | null = null;
function noteCommitted(path: string, search: string) {
  const key = `${path}?${search}`;
  if (key === lastCommitted) return;
  lastCommitted = key;
  const i = requested.findIndex((r) => r.path === path && r.search === search);
  requested = i >= 0 ? requested.slice(i + 1) : [];
}

export function useQuery() {
  const params = useSearchParams();
  const pathname = usePathname() ?? "/clearline";
  const navigate = useNavigate();
  const committed = params?.toString() ?? "";
  useEffect(() => { noteCommitted(pathname, committed); }, [pathname, committed]);
  const get = (k: string) => params?.get(k) ?? "";
  const hrefWith = (patch: Record<string, string | null>) => {
    const pendingSame = requested.filter((r) => r.path === pathname).at(-1);
    const next = new URLSearchParams(pendingSame ? pendingSame.search : committed);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const update = (patch: Record<string, string | null>, mode: "push" | "replace" = "push") => {
    const href = hrefWith(patch);
    const search = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    if (search === committed && !requested.some((r) => r.path === pathname)) return; // nothing changes
    requested.push({ path: pathname, search });
    navigate(href, mode, { scroll: false });
  };
  return { get, update, hrefWith };
}

/** Case-insensitive "contains" over every field given; an empty query matches everything. */
export function matchesText(q: string, ...fields: (string | number | undefined | null)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f !== undefined && f !== null && String(f).toLowerCase().includes(needle));
}

export function FilterBar({ label, children, summary, clear, onClear }: { label: string; children: ReactNode; summary: ReactNode; clear?: string[]; onClear?: () => void }) {
  const { update } = useQuery();
  const summaryRef = useRef<HTMLSpanElement>(null);
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setAnnounced(summaryRef.current?.textContent ?? ""), 700);
    return () => window.clearTimeout(t);
  });
  return (
    <form role="search" aria-label={label} className={s.filterBar} onSubmit={(e) => e.preventDefault()}>
      <div className={s.filterFields}>{children}</div>
      <p className={s.filterSummary} data-testid="filter-summary">
        <span ref={summaryRef}>{summary}</span>
        {clear && clear.length > 0 && <> <button type="button" className={`${s.btn} ${s.small} ${s.ghost}`} onClick={() => { onClear?.(); update(Object.fromEntries(clear.map((k) => [k, null]))); }}>Clear filters</button></>}
      </p>
      {/* Announced politely once the person pauses, not on every keystroke (review nit n8). */}
      <p className={s.srOnly} role="status" aria-live="polite">{announced}</p>
    </form>
  );
}

export function SelectFilter({ param, label, options, allLabel = "All" }: { param: string; label: string; options: Option[]; allLabel?: string }) {
  const { get, update } = useQuery();
  const id = useId();
  const fromUrl = get(param);
  // Show the person's choice at once; the URL (and the table) follow when the router commits.
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => setChosen(null), [fromUrl]);
  const value = chosen ?? fromUrl;
  const known = !value || options.some((o) => o.value === value);
  return (
    <label className={s.field} htmlFor={id}>
      <span>{label}</span>
      <select id={id} name={param} value={value} onChange={(e) => { setChosen(e.target.value); update({ [param]: e.target.value || null }); }}>
        <option value="">{allLabel}</option>
        {!known && <option value={value}>Unrecognised: {value}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Search text for a table: filters as the person types; the URL follows (debounced, replacing the
 * current history entry); Back/Forward or a shared link sets the text from the URL.
 */
export function useSearchText(param = "q"): [string, (v: string) => void, () => void, () => void] {
  const { get, update } = useQuery();
  const fromUrl = get(param);
  const [text, setText] = useState(fromUrl);
  const typing = useRef(false);
  useEffect(() => { if (!typing.current) setText(fromUrl); }, [fromUrl]);
  useEffect(() => {
    if (!typing.current) return;
    const t = window.setTimeout(() => { typing.current = false; if (text !== fromUrl) update({ [param]: text.trim() ? text : null }, "replace"); }, 300);
    return () => window.clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string) => { typing.current = true; setText(v); };
  const commit = () => { typing.current = false; if (text !== fromUrl) update({ [param]: text.trim() ? text : null }, "replace"); };
  // Clear filters: drop the typed text at once and cancel any pending debounce, so it cannot come back.
  const clear = () => { typing.current = false; setText(""); };
  return [text, change, commit, clear];
}

export function SearchFilter({ label, placeholder, value, onChange, onCommit }: { label: string; placeholder?: string; value: string; onChange: (v: string) => void; onCommit: () => void }) {
  const id = useId();
  return (
    <label className={`${s.field} ${s.searchField}`} htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="search" name="q" value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => onChange(e.target.value)} onBlur={onCommit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit(); } }} />
    </label>
  );
}
