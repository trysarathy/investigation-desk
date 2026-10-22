"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CHAIN_NAMES } from "@/lib/types";
import type { Bucket, CaseRow } from "@/lib/view";
import { ConfidenceLabel, Status } from "./Status";
import { useAssignments, ME } from "./assignments";

type Filter = "all" | Bucket;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_action", label: "Needs action" },
  { key: "waiting", label: "Waiting" },
  { key: "resolved", label: "Resolved" },
  { key: "unknown", label: "Unknown" },
];

export function QueueTable({ rows, empty }: { rows: CaseRow[]; empty: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState(0);
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const { owners, assign } = useAssignments();
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const visible = useMemo(() => rows.filter((r) => filter === "all" || r.bucket === filter), [rows, filter]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, needs_action: 0, waiting: 0, resolved: 0, unknown: 0 };
    rows.forEach((r) => c[r.bucket]++);
    return c;
  }, [rows]);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, visible.length - 1))), [visible.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".cmd")) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setSel((s) => Math.min(s + 1, visible.length - 1)); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter" && visible[sel]) router.push(visible[sel].href ?? `/cases/${visible[sel].id}`);
      else if (e.key === "a" && visible[sel]) assign(visible[sel].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, sel, router, assign]);

  useEffect(() => {
    tbodyRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const params = new URLSearchParams({ q: q.trim(), ...(customer.trim() ? { customer: customer.trim() } : {}) });
    router.push(`/investigate?${params}`);
  };

  return (
    <>
      <div className="page-head">
        <h1>Cases</h1>
        <form onSubmit={submit} style={{ display: "flex", gap: 8, flex: "1 1 520px", maxWidth: 760, flexWrap: "wrap" }}>
          <input
            className="input mono"
            style={{ flex: "3 1 260px" }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Paste a transaction hash, address or customer ref"
            aria-label="Transaction hash, address or customer reference"
          />
          <input
            className="input mono"
            style={{ flex: "1 1 150px" }}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Reporting customer (optional)"
            aria-label="Reporting customer (optional)"
            title="The customer who reported the deposit. Without it, File A's owner of the destination is used, and 'sent to another customer's address' (D17) can't be detected."
          />
          <button className="btn btn-primary" type="submit">New case</button>
        </form>
      </div>

      {!empty && (
        <div className="chips" role="group" aria-label="Filter cases">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} <span className="count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <div className="panel" style={{ padding: 48, textAlign: "center", display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
          <p style={{ margin: 0, fontSize: 14 }}>Paste a transaction hash to investigate your first case.</p>
          <Link className="btn" href="/">Load sample data</Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="panel" style={{ padding: 32, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <p style={{ margin: 0 }}>No cases match these filters.</p>
          <button className="btn" type="button" onClick={() => setFilter("all")}>Clear</button>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table className="table" aria-label="Case queue">
            <thead>
              <tr>
                <th>Case</th><th>Customer</th><th>Chain</th><th style={{ textAlign: "right" }}>Amount</th>
                <th>Verdict</th><th>Confidence</th><th style={{ textAlign: "right" }}>Age</th><th>Owner</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {visible.map((r, i) => {
                const owner = owners[r.id] ?? r.owner;
                return (
                  <tr key={r.id} aria-selected={i === sel} onClick={() => router.push(r.href ?? `/cases/${r.id}`)} onMouseMove={() => sel !== i && setSel(i)}>
                    <td>
                      <Link href={r.href ?? `/cases/${r.id}`} className="mono" style={{ color: "inherit" }} onClick={(e) => e.stopPropagation()}>{r.id}</Link>
                      {r.live && <span className="badge" style={{ marginLeft: 6 }} title="From a bulk run on your uploaded files; opens a live check">Live</span>}
                    </td>
                    <td className="mono muted">{r.customerId}</td>
                    <td>{r.chain ? <span className="badge">{CHAIN_NAMES[r.chain]}</span> : <span className="faint">—</span>}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{r.amount ? `${r.amount} ${r.token}` : <span className="faint">—</span>}</td>
                    <td>
                      {r.paused
                        ? <Status status="warn" label="Check paused" />
                        : <span><span className="code">{r.code}</span> <span>{r.label}</span></span>}
                    </td>
                    <td><ConfidenceLabel confidence={r.confidence} paused={r.paused} /></td>
                    <td className="num muted" style={{ textAlign: "right" }}>{r.age}</td>
                    <td className={owner ? "" : "faint"}>{owner ?? "Unassigned"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!empty && (
        <p className="faint" style={{ margin: 0 }}>
          <span className="kbd">↑</span> <span className="kbd">↓</span> or <span className="kbd">J</span> <span className="kbd">K</span> move ·{" "}
          <span className="kbd">↵</span> open · <span className="kbd">A</span> assign to {ME.toLowerCase()} · <span className="kbd">⌘K</span> search
        </p>
      )}
    </>
  );
}
