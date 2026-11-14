"use client";
/**
 * Browser-held sandbox workspace. The engine (@/lib/clearline) owns every rule, amount and
 * status; this provider only stores the engine's Workspace object, passes actions through
 * applyAction and remembers which simulated user is acting.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SAMPLE_ACTORS, applyAction, canResetScenario, emptyWorkspace, loadWorkspace, resetScenario, sampleWorkspace, serializeWorkspace,
  type ResetCheck, type WorkspaceMigration,
  type ActionResult, type Actor, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import { describeError } from "./human";
import { setFullLoadGuard } from "./navguard";

export const WORKSPACE_KEY = "clearline.console.workspace.v1";
const KEY = WORKSPACE_KEY;
const ACTOR_KEY = "clearline.console.actor.v1";
/** Where an unreadable saved workspace is kept when the person chooses to replace it (review m6). */
export const BACKUP_KEY = "clearline.console.workspace.v1.unreadable-backup";
/** Where the error boundary keeps the saved workspace it removes (separate from BACKUP_KEY: review rc3 m3). */
export const BOUNDARY_BACKUP_KEY = "clearline.console.workspace.v1.boundary-backup";
/** Where Settings keeps the current workspace before restoring a backup over it. */
export const RESTORE_BACKUP_KEY = "clearline.console.workspace.v1.before-restore-backup";
/** Where the saved workspace is kept, as it was, before this version's engine migrates it on load. */
export const MIGRATION_BACKUP_KEY = "clearline.console.workspace.v1.before-migration-backup";
/** Where a whole-workspace reset keeps the workspace it replaces (review nit n6). */
export const RESET_BACKUP_KEY = "clearline.console.workspace.v1.before-reset-backup";
const BACKUP_BASES = [BACKUP_KEY, BOUNDARY_BACKUP_KEY, RESTORE_BACKUP_KEY, MIGRATION_BACKUP_KEY, RESET_BACKUP_KEY];

/**
 * Writes a backup and never overwrites a different earlier one: when the slot already holds other
 * content, a timestamped key next to it is used. Returns the key written, or null when the browser
 * refused (blocked storage or a full quota). Callers must not remove the original when this fails.
 */
export function writeBackup(base: string, raw: string): string | null {
  try {
    const ls = window.localStorage;
    const existing = ls.getItem(base);
    let key = base;
    if (existing !== null && existing !== raw) {
      // Timestamped next to the slot; a counter keeps two backups in the same millisecond apart (review nit n4).
      const stamp = `${base}.${new Date().toISOString()}`;
      key = stamp;
      for (let n = 2; ls.getItem(key) !== null && ls.getItem(key) !== raw; n++) key = `${stamp}-${String(n).padStart(3, "0")}`;
    }
    ls.setItem(key, raw);
    pruneBackups(base, key);
    return key;
  } catch {
    return null;
  }
}

/** Backups kept per kind; older ones are removed only after a newer one was written successfully. */
export const BACKUPS_PER_KIND = 3;
function pruneBackups(base: string, justWritten: string) {
  try {
    const ls = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && (k === base || k.startsWith(base + "."))) keys.push(k); }
    // Oldest first: the bare slot is the first backup of its kind, then timestamped keys in time order.
    keys.sort((a, b) => (a === base ? -1 : b === base ? 1 : a.localeCompare(b)));
    const excess = keys.length - BACKUPS_PER_KIND;
    for (const k of keys.slice(0, Math.max(0, excess))) if (k !== justWritten) ls.removeItem(k);
  } catch { /* pruning is best effort; nothing is lost by keeping a backup */ }
}

/** Removes one backup the person chose to delete (Settings). */
export function deleteBackup(key: string): boolean {
  if (!BACKUP_BASES.some((b) => key === b || key.startsWith(b + "."))) return false;
  try { window.localStorage.removeItem(key); return true; } catch { return false; }
}

export type Backup = { key: string; kind: "unreadable" | "boundary" | "before-restore" | "before-migration" | "before-reset"; size: number; savedAt: string | null };
/** Every backup this console has written in this browser, newest key last. Empty when storage is blocked. */
export function listBackups(): Backup[] {
  const out: Backup[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      const base = key ? BACKUP_BASES.find((b) => key === b || key.startsWith(b + ".")) : undefined;
      if (!key || !base) continue;
      const raw = window.localStorage.getItem(key) ?? "";
      out.push({
        key, size: raw.length, savedAt: key === base ? null : key.slice(base.length + 1),
        kind: base === BACKUP_KEY ? "unreadable" : base === BOUNDARY_BACKUP_KEY ? "boundary" : base === MIGRATION_BACKUP_KEY ? "before-migration" : base === RESET_BACKUP_KEY ? "before-reset" : "before-restore",
      });
    }
  } catch { /* storage blocked: nothing to list */ }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Result of a reset: refused when an unreadable copy is waiting and no backup of it could be written. */
/**
 * What the engine changed when it loaded a workspace saved by an earlier version. `saved`: backed up and
 * saved. `held`: the backup of the original could not be written, so NOTHING is saved (the original stays
 * as it was) until the person chooses; `choice` records that choice (review rc3 final m-A).
 */
export type Migrations = { items: WorkspaceMigration[]; saved: boolean; held: boolean; raw: string; choice?: "unsaved" };

export type ResetResult = { ok: true; backupKey?: string } | { ok: false; reason: string };

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
  reset: (kind?: "sample" | "empty", opts?: { withoutBackup?: boolean }) => ResetResult;
  /**
   * Set when the saved workspace could not be read. The console shows the sample instead, but the
   * saved copy is NOT overwritten and nothing is saved until the person chooses (review m6).
   */
  discarded: Discarded | null;
  /**
   * What this version's engine changed when it loaded a workspace saved by an earlier version
   * (loadWorkspace migrations). `saved` says whether the migrated workspace was saved (after a backup).
   */
  migrations: Migrations | null;
  dismissMigrations: () => void;
  /** Migration held (backup failed): the person keeps working without saving until they choose. */
  continueUnsaved: () => void;
  /** Migration held: save the updated workspace over the original, explicitly without a backup. */
  replaceOriginalUnbacked: () => void;
  /** Engine check: may this guided case (scenario key, sample payment id or case id) be reset on its own? */
  canResetCase: (scenario: string) => ResetCheck;
  /** Restores one guided case through the engine (resetScenario); other records stay as they are. */
  resetCase: (scenario: string) => { ok: true; scenario: string; removed: number; restored: number } | { ok: false; reason: string; code: string };
  /** Keeps the unreadable copy as a backup, then saves the sample in its place. Refused if the backup fails. */
  replaceDiscarded: (opts?: { withoutBackup?: boolean }) => ResetResult;
  actorName: (id?: string) => string;
};

const WorkspaceContext = createContext<Ctx | null>(null);

function readStored(): { ws: Workspace | null; actor: string | null; ok: boolean; discarded?: Discarded; migrations?: WorkspaceMigration[]; raw?: string } {
  try {
    const raw = window.localStorage.getItem(KEY);
    const actor = window.localStorage.getItem(ACTOR_KEY);
    if (!raw) return { ws: null, actor, ok: true };
    // loadWorkspace migrates a workspace saved by an earlier version and says what it changed.
    const parsed = loadWorkspace(raw);
    if (parsed.ok) return { ws: parsed.value.workspace, actor, ok: true, migrations: parsed.value.migrations, raw };
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
  const [migrations, setMigrations] = useState<Migrations | null>(null);
  const migrationsRef = useRef<Migrations | null>(null);
  migrationsRef.current = migrations;
  const wsRef = useRef(ws);
  wsRef.current = ws;
  // While an unreadable saved copy is waiting for a decision, nothing is written over it.
  const holdWrites = useRef(false);
  const discardedRef = useRef<Discarded | null>(null);
  discardedRef.current = discarded;

  useEffect(() => {
    const stored = readStored();
    if (stored.ws) setWs(stored.ws);
    if (stored.ws && stored.migrations?.length && stored.raw) {
      // The original is kept as a backup first; only then is the migrated workspace saved over it.
      const backedUp = writeBackup(MIGRATION_BACKUP_KEY, stored.raw) !== null;
      const saved = backedUp && write(KEY, serializeWorkspace(stored.ws));
      // No backup, no overwrite: hold every write until the person decides (review rc3 final m-A).
      if (!saved) holdWrites.current = true;
      setMigrations({ items: stored.migrations, saved, held: !saved, raw: stored.raw });
    }
    if (stored.discarded) {
      holdWrites.current = true;
      setDiscarded(stored.discarded);
    }
    if (stored.actor && SAMPLE_ACTORS.some((a) => a.id === stored.actor)) setActor(stored.actor);
    setStorage(stored.ok ? "available" : "unavailable");
    setHydrated(true);
  }, []);

  const storageRef = useRef(storage);
  storageRef.current = storage;
  useEffect(() => {
    setFullLoadGuard(() => storageRef.current === "unavailable"
      ? "browser storage is unavailable, so nothing in this tab has been saved."
      : discardedRef.current ? "nothing is being saved until you decide about the unreadable saved workspace."
      : migrationsRef.current?.held ? "nothing is being saved until you decide about your updated saved workspace." : null);
    return () => setFullLoadGuard(() => null);
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

  const reset = useCallback((kind: "sample" | "empty" = "sample", opts?: { withoutBackup?: boolean }): ResetResult => {
    // An explicit reset is the person's decision: keep any unreadable copy as a backup, then save.
    // If the backup cannot be written (full quota, blocked storage), nothing is replaced (review rc3 m2).
    let backupKey: string | undefined;
    if (holdWrites.current && discardedRef.current && !opts?.withoutBackup) {
      const k = writeBackup(BACKUP_KEY, discardedRef.current.raw);
      if (!k) return { ok: false, reason: "A backup of the unreadable copy could not be written (browser storage is full or blocked), so nothing was replaced. Download the unreadable copy first, then replace it without a backup if you no longer need it." };
      backupKey = k;
    }
    const held = migrationsRef.current?.held ? migrationsRef.current : null;
    if (held && !opts?.withoutBackup) {
      const k = writeBackup(MIGRATION_BACKUP_KEY, held.raw);
      if (!k) return { ok: false, reason: "A backup of your saved workspace could not be written (browser storage is full or blocked), so nothing was replaced. Download the original from the notice above first." };
      backupKey = k;
    }
    if (!holdWrites.current) {
      // A whole reset keeps what it replaces (review nit n6). Best effort: the message says whether it was kept.
      let current: string | null = null;
      try { current = window.localStorage.getItem(KEY); } catch { /* blocked */ }
      if (current !== null) backupKey = writeBackup(RESET_BACKUP_KEY, current) ?? undefined;
    }
    holdWrites.current = false;
    setDiscarded(null);
    if (held) setMigrations(null);
    const next = kind === "empty" ? emptyWorkspace() : sampleWorkspace();
    wsRef.current = next;
    setWs(next);
    persist(next);
    return { ok: true, backupKey };
  }, [persist]);

  const canResetCase = useCallback((scenario: string) => canResetScenario(wsRef.current, scenario), []);
  const resetCase = useCallback((scenario: string) => {
    const current = wsRef.current;
    const r = resetScenario(current, scenario, { actorId, at: nextInstant(current.asOf) });
    if (!r.ok) return { ok: false as const, reason: describeError(r.error, current).text, code: r.error.code };
    wsRef.current = r.value.workspace;
    setWs(r.value.workspace);
    persist(r.value.workspace);
    return { ok: true as const, scenario: r.value.scenario, removed: r.value.removedIds.length, restored: r.value.restoredIds.length };
  }, [actorId, persist]);

  const dismissMigrations = useCallback(() => { if (!migrationsRef.current?.held) setMigrations(null); }, []);
  const continueUnsaved = useCallback(() => setMigrations((m) => (m ? { ...m, choice: "unsaved" } : m)), []);
  const replaceOriginalUnbacked = useCallback(() => {
    holdWrites.current = false;
    const ok = write(KEY, serializeWorkspace(wsRef.current));
    setStorage(ok ? "available" : "unavailable");
    if (ok) setMigrations(null);
  }, []);
  const replaceDiscarded = useCallback((opts?: { withoutBackup?: boolean }) => reset("sample", opts), [reset]);

  const setActorId = useCallback((id: string) => {
    setActor(id);
    write(ACTOR_KEY, id);
  }, []);

  const actors = ws.actors?.length ? ws.actors : SAMPLE_ACTORS;
  const value = useMemo<Ctx>(() => ({
    ws, hydrated, storage, actorId, actors,
    actor: actors.find((a) => a.id === actorId),
    setActorId, dispatch, preview, reset, canResetCase, resetCase, discarded, replaceDiscarded,
    migrations, dismissMigrations, continueUnsaved, replaceOriginalUnbacked,
    actorName: (id?: string) => {
      if (!id) return "Unassigned";
      const a = actors.find((x) => x.id === id);
      return a ? a.name : id;
    },
  }), [ws, hydrated, storage, actorId, actors, setActorId, dispatch, preview, reset, canResetCase, resetCase, discarded, replaceDiscarded, migrations, dismissMigrations, continueUnsaved, replaceOriginalUnbacked]);

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
