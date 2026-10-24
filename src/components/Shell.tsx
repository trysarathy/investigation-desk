"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normaliseInput } from "@/lib/normalise";
import type { SearchEntry } from "@/lib/view";

const NAV = [
  { href: "/requests", label: "Requests" },
  { href: "/", label: "Queue" },
  { href: "/inbox", label: "Inbox" },
  { href: "/payments", label: "Payments" },
  { href: "/bulk", label: "Bulk" },
  { href: "/settings", label: "Settings" },
];

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export function Shell({ index, workspace, children }: {
  index: SearchEntry[]; workspace: { name: string; badge: string; title: string }; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // Pasting a hash, address or customer ref anywhere opens it (spec 5.1).
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || window.location.pathname.startsWith("/pay/")) return;
      const text = e.clipboardData?.getData("text")?.trim();
      if (!text) return;
      const kind = normaliseInput(text).kind;
      if (kind === "unrecognised" && text.length > 64) return;
      e.preventDefault();
      router.push(`/investigate?q=${encodeURIComponent(text)}`);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [router]);

  // The sender's payment page is customer-facing: no operator sidebar, search or shortcuts.
  if (pathname.startsWith("/pay/")) return <>{children}</>;

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="workspace">
          <strong>{workspace.name}</strong>
          <span className="badge" title={workspace.title}>{workspace.badge}</span>
        </div>
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" || pathname.startsWith("/cases") : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className="nav-link" aria-current={active ? "page" : undefined}>
              {n.label}
            </Link>
          );
        })}
        <button type="button" className="nav-link" style={{ border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }} onClick={() => setOpen(true)}>
          Search <span className="kbd">⌘K</span>
        </button>
        <div className="sidebar-foot">
          <ThemeToggle />
        </div>
      </nav>
      <main className="main">{children}</main>
      {open && <CommandBar index={index} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string>("system");
  useEffect(() => {
    try { setTheme(localStorage.getItem("desk.theme") ?? "system"); } catch {}
  }, []);
  const apply = (t: string) => {
    setTheme(t);
    try { localStorage.setItem("desk.theme", t); } catch {}
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };
  return (
    <label className="faint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
      Theme
      <select className="input" style={{ height: 26, padding: "0 6px" }} value={theme} onChange={(e) => apply(e.target.value)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

function CommandBar({ index, onClose }: { index: SearchEntry[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^0x(?=[0-9a-f]{64}$)/, "");
    if (!s) return index.slice(0, 8);
    return index.filter((e) => e.terms.some((t) => t.includes(s))).slice(0, 8);
  }, [q, index]);

  const go = useCallback((href: string) => {
    onClose();
    router.push(href);
  }, [onClose, router]);

  const submit = () => {
    if (results[sel]) go(`/cases/${results[sel].id}`);
    else if (q.trim()) go(`/investigate?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="cmd-backdrop" onMouseDown={onClose}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          placeholder="Paste a hash, address or customer reference"
          aria-label="Hash, address or customer reference"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") submit();
          }}
        />
        <ul role="listbox" aria-label="Matching cases">
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(`/cases/${r.id}`)}>
              <span className="mono">{r.id}</span>
              <span className="muted">{r.customerId}</span>
              <span className="code">{r.code}</span>
              <span>{r.label}</span>
            </li>
          ))}
          {results.length === 0 && q.trim() && (
            <li aria-selected onClick={submit}>
              Investigate <span className="mono">{q.trim().slice(0, 48)}</span>
              <span className="faint">({normaliseInput(q).kind.replace("_", " ")})</span>
            </li>
          )}
        </ul>
        <div className="hint"><span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span><span><span className="kbd">↵</span> open</span><span><span className="kbd">esc</span> close</span></div>
      </div>
    </div>
  );
}
