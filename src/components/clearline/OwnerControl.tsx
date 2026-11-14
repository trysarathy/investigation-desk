"use client";
/**
 * Owner of a case or exception, with an inline "Change owner" through the engine's assign_owner
 * action. The engine is asked first (dry run); a refused change is disabled and its reason shown.
 */
import { useId, useState } from "react";
import type { TargetRef } from "@/lib/clearline";
import { useWorkspace } from "./workspace";
import { ActionButton, gateOf, useRun } from "./Action";
import { Status, ui } from "./ui";

export function OwnerControl({ target, ownerId }: { target: TargetRef; ownerId?: string }) {
  const { ws, preview, actors, actorName } = useWorkspace();
  const { msg, run } = useRun();
  const [next, setNext] = useState(ownerId ?? actors[0]?.id ?? "");
  const id = useId();
  const action = { type: "assign_owner", target, ownerId: next } as const;
  const gate = gateOf(preview(action), ws, next === ownerId && "Choose a different person first.");
  return (
    <div data-testid="owner-control" data-owner={ownerId ?? ""}>
      <span data-testid="owner-name">{ownerId ? actorName(ownerId) : <em>Unassigned</em>}</span>
      <details className={ui.ownerDetails}>
        <summary>Change owner<span className={ui.srOnly}> of {target.id}</span></summary>
        <form onSubmit={(e) => { e.preventDefault(); run(`Owner of ${target.id} set to ${actorName(next)}`, action); }}>
          <label className={ui.field} htmlFor={id}>
            <span>New owner</span>
            <select id={id} value={next} onChange={(e) => setNext(e.target.value)}>
              {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gate} name="Change owner">Save owner</ActionButton></div>
        </form>
      </details>
      <Status msg={msg} />
    </div>
  );
}
