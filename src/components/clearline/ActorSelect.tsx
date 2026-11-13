"use client";
import { useWorkspace } from "./workspace";
import { SIMULATED_ROLE_NOTE } from "./nav";
import s from "./ui.module.css";

/** Chooses which fictional user performs the next action. Sandbox only: there is no login. */
export function ActorSelect({ id, label = "Acting as" }: { id: string; label?: string }) {
  const { actors, actorId, setActorId } = useWorkspace();
  return (
    <div className={s.actorSel} data-testid="role-switch">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={actorId} onChange={(e) => setActorId(e.target.value)} aria-describedby={`${id}-note`}>
        {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <span className={s.hint} id={`${id}-note`} data-testid="simulated-role-note">{SIMULATED_ROLE_NOTE}</span>
    </div>
  );
}
