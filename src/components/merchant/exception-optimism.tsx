"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Chip } from "./ui";
import s from "@/components/control/control.module.css";

/**
 * Optimistic UI on an exception page: assigning, adding a note or evidence and proposing a resolution show at once,
 * marked as being saved, while the request goes to the server through the unchanged forms (same API calls and
 * idempotency keys). The server stays the authority: on success the page reloads with the stored state; on a refusal
 * the change is rolled back and the form shows the server's own message (role=alert).
 */
interface PendingNote { key: number; kind: "note" | "evidence"; body: string; reference: string | null }
interface Optimism {
  owner: { name: string | null } | null;
  notes: PendingNote[];
  proposal: { note: string } | null;
  /** Each returns its rollback. */
  assign: (name: string | null) => () => void;
  addNote: (n: Omit<PendingNote, "key">) => () => void;
  propose: (note: string) => () => void;
}

const Ctx = createContext<Optimism | null>(null);
/** The page's optimism, or null outside an exception page (the forms then behave as before). */
export const useExceptionOptimism = () => useContext(Ctx);

export function ExceptionOptimism({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<Optimism["owner"]>(null);
  const [notes, setNotes] = useState<PendingNote[]>([]);
  const [proposal, setProposal] = useState<Optimism["proposal"]>(null);
  const seq = useRef(0);
  const assign = useCallback((name: string | null) => { setOwner({ name }); return () => setOwner(null); }, []);
  const addNote = useCallback((n: Omit<PendingNote, "key">) => {
    const key = ++seq.current;
    setNotes((xs) => [...xs, { ...n, key }]);
    return () => setNotes((xs) => xs.filter((x) => x.key !== key));
  }, []);
  const propose = useCallback((note: string) => { setProposal({ note }); return () => setProposal(null); }, []);
  const v = useMemo(() => ({ owner, notes, proposal, assign, addNote, propose }), [owner, notes, proposal, assign, addNote, propose]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

const Saving = () => <span className={s.small} data-testid="optimistic-saving"> · saving…</span>;

/** The exception's owner: the stored one, or the one just chosen while the server confirms it. */
export function OwnerName({ stored }: { stored: string | null }) {
  const o = useExceptionOptimism()?.owner;
  return <><span data-testid="exception-owner">{(o ? o.name : stored) ?? "Unassigned"}</span>{o ? <Saving /> : null}</>;
}

/** Notes and evidence just added, shown under the stored ones until the server confirms them. */
export function PendingNotes() {
  const notes = useExceptionOptimism()?.notes ?? [];
  if (!notes.length) return null;
  return (
    <ol className={s.timeline} aria-label="Being saved" data-testid="pending-notes">
      {notes.map((n) => (
        <li key={n.key} aria-busy="true">
          <p className={s.small}><strong>Now</strong> · You · {n.kind === "evidence" ? <Chip>Evidence attached by a person — not independent</Chip> : "Note"}<Saving /></p>
          <p>{n.body}{n.reference ? <> <span className={s.mono}>[{n.reference}]</span></> : null}</p>
        </li>
      ))}
    </ol>
  );
}

/** A proposal just sent, shown above the stored requests until the server confirms its version. */
export function PendingProposal() {
  const p = useExceptionOptimism()?.proposal;
  if (!p) return null;
  return (
    <div className={s.panel} aria-busy="true" data-testid="pending-proposal">
      <p className={s.small}><Chip tone="amber">Sending for approval</Chip><Saving /></p>
      <p>{p.note}</p>
      <p className={s.small}>A different person with the Approver role decides it once the server has recorded its version.</p>
    </div>
  );
}
