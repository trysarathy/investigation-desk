"use client";
/**
 * Browser-held sandbox workspace. The engine (@/lib/clearline) owns every rule, amount and
 * status; this provider only stores the engine's Workspace object, passes actions through
 * applyAction and remembers which simulated user is acting.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SAMPLE_ACTORS, applyAction, emptyWorkspace, parseWorkspace, sampleWorkspace, serializeWorkspace,
  type ActionResult, type Actor, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import { describeError } from "./human";

export const WORKSPACE_KEY = "clearline.console.workspace.v1";
const KEY = WORKSPACE_KEY;
const ACTOR_KEY = "clearline.console.actor.v1";
/** Where an unreadable saved workspace is kept when the person chooses to replace it (review m6). */
export const BACKUP_KEY = "clearline.console.workspace.v1.unreadable-backup";

/** A saved workspace that could not be read. It stays in storage untouched until the person decides. */
export type Discarded = { reason: string; raw: string };

type Ctx = {
  ws: Workspace;
  hydrated: boolean;
  storage: "available" | "unavailable";
  actorId: string;
  actor: Actor | undefined;
  actors: readonly Actor[];
  setActorId: (id: string) => void;
  /** Applies an engine action at the next simulated instant. */
  dispatch: (action: WorkspaceAction, opts?: { actorId?: string }) => ActionResult;
  /** Dry run: asks the engine whether the action would be accepted now, without changing anything. */
  preview: (action: WorkspaceAction, opts?: { actorId?: string }) => ActionResult;
  reset: (kind?: "sample" | "empty") => void;
  /**
   * Set when the saved workspace could not be read. The console shows the sample instead, but the
   * saved copy is NOT overwritten and nothing is saved until the person chooses (review m6).
   */
  discarded: Discarded | null;
  /** Keeps the unreadable copy under BACKUP_KEY, then saves the sample in its place. */
  replaceDiscarded: () => void;
  actorName: (id?: string) => string;
};

const WorkspaceContext = createContext<Ctx | null>(null);

function readStored(): { ws: Workspace | null; actor: string | null; ok: boolean; discarded?: Discarded } {
  try {
    const raw = window.localStorage.getItem(KEY);
    const actor = window.localStorage.getItem(ACTOR_KEY);
    if (!raw) return { ws: null, actor, ok: true };
    const parsed = parseWorkspace(raw);
    if (parsed.ok) return { ws: parsed.value, actor, ok: true };
    // Never discard silently: say what was dropped and why (engine words + exact code).
    const why = describeError(parsed.error);
    return { ws: null, actor, ok: true, discarded: { raw, reason: `${why.text} (${parsed.error.code}${parsed.error.field ? ` · ${parsed.error.field}` : ""})` } };
  } catch {
    return { ws: null, actor: null, ok: false };
  }
}

function write(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The simulated clock moves forward one minute per user action; it never reads wall time for rules. */
function nextInstant(asOf: string): string {
  const t = Date.parse(asOf);
  return new Date((Number.isNaN(t) ? 0 : t) + 60_000).toISOString();
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<Workspace>(() => sampleWorkspace());
  const [actorId, setActor] = useState<string>("usr_maya");
  const [hydrated, setHydrated] = useState(false);
  const [storage, setStorage] = useState<"available" | "unavailable">("available");
  const [discarded, setDiscarded] = useState<Discarded | null>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  // While an unreadable saved copy is waiting for a decision, nothing is written over it.
  const holdWrites = useRef(false);
  const discardedRef = useRef<Discarded | null>(null);
  discardedRef.current = discarded;

  useEffect(() => {
    const stored = readStored();
    if (stored.ws) setWs(stored.ws);
    if (stored.discarded) {
      holdWrites.current = true;
      setDiscarded(stored.discarded);
    }
    if (stored.actor && SAMPLE_ACTORS.some((a) => a.id === stored.actor)) setActor(stored.actor);
    setStorage(stored.ok ? "available" : "unavailable");
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Workspace) => {
    if (holdWrites.current) return;
    setStorage(write(KEY, serializeWorkspace(next)) ? "available" : "unavailable");
  }, []);

  const dispatch = useCallback((action: WorkspaceAction, opts?: { actorId?: string }): ActionResult => {
    const current = wsRef.current;
    const result = applyAction(current, action, { actorId: opts?.actorId ?? actorId, at: nextInstant(current.asOf) });
    if (result.ok) {
      wsRef.current = result.value.workspace;
      setWs(result.value.workspace);
      persist(result.value.workspace);
    }
    return result;
  }, [actorId, persist]);

  // Dry runs are pure functions of (workspace version, actor, action): cache them per workspace object,
  // so re-renders and keystrokes do not re-run the engine for unchanged buttons (review m7).
  const previews = useRef(new WeakMap<Workspace, Map<string, ActionResult>>());
  const preview = useCallback((action: WorkspaceAction, opts?: { actorId?: string }): ActionResult => {
    const current = wsRef.current;
    const who = opts?.actorId ?? actorId;
    let cache = previews.current.get(current);
    if (!cache) { cache = new Map(); previews.current.set(current, cache); }
    const key = who + "\u0000" + JSON.stringify(action);
    const hit = cache.get(key);
    if (hit) return hit;
    const r = applyAction(current, action, { actorId: who, at: nextInstant(current.asOf) });
    cache.set(key, r);
    return r;
  }, [actorId]);

  const reset = useCallback((kind: "sample" | "empty" = "sample") => {
    // An explicit reset is the person's decision: keep any unreadable copy as a backup, then save.
    if (holdWrites.current && discardedRef.current) write(BACKUP_KEY, discardedRef.current.raw);
    holdWrites.current = false;
    setDiscarded(null);
    const next = kind === "empty" ? emptyWorkspace() : sampleWorkspace();
    wsRef.current = next;
    setWs(next);
    persist(next);
  }, [persist]);

  const replaceDiscarded = useCallback(() => reset("sample"), [reset]);

  const setActorId = useCallback((id: string) => {
    setActor(id);
    write(ACTOR_KEY, id);
  }, []);

  const actors = ws.actors?.length ? ws.actors : SAMPLE_ACTORS;
  const value = useMemo<Ctx>(() => ({
    ws, hydrated, storage, actorId, actors,
    actor: actors.find((a) => a.id === actorId),
    setActorId, dispatch, preview, reset, discarded, replaceDiscarded,
    actorName: (id?: string) => {
      if (!id) return "Unassigned";
      const a = actors.find((x) => x.id === id);
      return a ? a.name : id;
    },
  }), [ws, hydrated, storage, actorId, actors, setActorId, dispatch, preview, reset, discarded, replaceDiscarded]);

  return (
    <WorkspaceContext.Provider value={value}>
      <div data-hydrated={hydrated ? "true" : "false"} data-testid="cl-workspace" style={{ display: "contents" }}>
        {children}
      </div>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error("useWorkspace outside WorkspaceProvider");
  return c;
}

/** Plain-English rendering of an engine error (engine describeError), keeping its exact code visible. */
export function errorText(r: ActionResult, ws?: Workspace): string {
  if (r.ok) return "";
  const h = describeError(r.error, ws);
  return `${h.text} (${r.error.code}${h.reasonCode ? ` · ${h.reasonCode}` : ""})`;
}
