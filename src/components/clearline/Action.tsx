"use client";
/**
 * Action buttons that only ever go through the engine. Before a click the engine is asked (dry run,
 * `preview`) whether the action would be accepted; a refused action is disabled and shows the
 * engine's reason in plain words. After a click the message reports what the engine recorded.
 */
import { useId, useState, type ReactNode } from "react";
import type { ActionResult, Workspace, WorkspaceAction } from "@/lib/clearline";
import { describeError, label } from "./human";
import { useWorkspace } from "./workspace";
import { Btn, ui } from "./ui";

export type Gate = { ok: true } | { ok: false; reason: string; code?: string };
export type Msg = { text: string; error?: boolean } | null;

/** Gate from a dry run. `need` is a missing-input reason checked first (e.g. "Write a note first."). */
export function gateOf(r: ActionResult | null, ws: Workspace, need?: string | false): Gate {
  if (need) return { ok: false, reason: need };
  if (!r) return { ok: true };
  if (r.ok) return { ok: true };
  const h = describeError(r.error, ws);
  return { ok: false, reason: h.text, code: h.reasonCode ? `${r.error.code} · ${h.reasonCode}` : r.error.code };
}

/** Dispatches through the engine and words the result. No success message unless the engine recorded it. */
export function useRun() {
  const { ws, dispatch } = useWorkspace();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (what: string, action: WorkspaceAction, opts?: { actorId?: string; onOk?: (r: Extract<ActionResult, { ok: true }>) => void }) => {
    const r = dispatch(action, opts?.actorId ? { actorId: opts.actorId } : undefined);
    if (r.ok) {
      setMsg({ text: `${what} — recorded by the engine (${label("actionOutcome", r.value.outcome)}).` });
      opts?.onOk?.(r);
    } else {
      const h = describeError(r.error, ws);
      setMsg({ text: `${what} — not applied. ${h.text} (${r.error.code})`, error: true });
    }
    return r;
  };
  return { msg, setMsg, run };
}

export function ActionButton({ children, gate, onClick, kind, size, type = "button", name, ariaLabel }: {
  children: ReactNode; gate: Gate; onClick?: () => void; kind?: "primary" | "ghost"; size?: "small"; type?: "button" | "submit"; name?: string; ariaLabel?: string;
}) {
  const rid = useId();
  return (
    <>
      <Btn type={type} kind={kind} size={size} onClick={onClick} disabled={!gate.ok} data-action={name ?? (typeof children === "string" ? children : "action")}
        aria-label={ariaLabel} aria-describedby={gate.ok ? undefined : rid}>{children}</Btn>
      {!gate.ok && (
        <p className={ui.reason} id={rid} data-testid="action-reason">
          {gate.reason}{gate.code && <> <code className={ui.apiValue}>{gate.code}</code></>}
        </p>
      )}
    </>
  );
}
