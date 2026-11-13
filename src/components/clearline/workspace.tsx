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

const KEY = "clearline.console.workspace.v1";
const ACTOR_KEY = "clearline.console.actor.v1";

type Ctx = {
  ws: Workspace;
  hydrated: boolean;
  storage: "available" | "unavailable";
  actorId: string;
  actor: Actor | undefined;
  actors: Actor[];
  setActorId: (id: string) => void;
  /** Applies an engine action at the next simulated instant. */
  dispatch: (action: WorkspaceAction, opts?: { actorId?: string }) => ActionResult;
  reset: (kind?: "sample" | "empty") => void;
  actorName: (id?: string) => string;
};

const WorkspaceContext = createContext<Ctx | null>(null);

function readStored(): { ws: Workspace | null; actor: string | null; ok: boolean } {
  try {
    const raw = window.localStorage.getItem(KEY);
    const actor = window.localStorage.getItem(ACTOR_KEY);
    if (!raw) return { ws: null, actor, ok: true };
    const parsed = parseWorkspace(raw);
    return { ws: parsed.ok ? parsed.value : null, actor, ok: true };
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
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const stored = readStored();
    if (stored.ws) setWs(stored.ws);
    if (stored.actor && SAMPLE_ACTORS.some((a) => a.id === stored.actor)) setActor(stored.actor);
    setStorage(stored.ok ? "available" : "unavailable");
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Workspace) => {
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

  const reset = useCallback((kind: "sample" | "empty" = "sample") => {
    const next = kind === "empty" ? emptyWorkspace() : sampleWorkspace();
    wsRef.current = next;
    setWs(next);
    persist(next);
  }, [persist]);

  const setActorId = useCallback((id: string) => {
    setActor(id);
    write(ACTOR_KEY, id);
  }, []);

  const actors = ws.actors?.length ? ws.actors : SAMPLE_ACTORS;
  const value = useMemo<Ctx>(() => ({
    ws, hydrated, storage, actorId, actors,
    actor: actors.find((a) => a.id === actorId),
    setActorId, dispatch, reset,
    actorName: (id?: string) => {
      if (!id) return "Unassigned";
      const a = actors.find((x) => x.id === id);
      return a ? `${a.name} (${a.role})` : id;
    },
  }), [ws, hydrated, storage, actorId, actors, setActorId, dispatch, reset]);

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

/** Plain-English rendering of an engine error, keeping its code visible. */
export function errorText(r: ActionResult): string {
  return r.ok ? "" : `${r.error.message} (${r.error.code})`;
}
