"use client";
import { useWorkspace } from "./workspace";
import s from "./ui.module.css";

/** Chooses which fictional user performs the next action. Sandbox only: there is no login. */
export function ActorSelect({ id, label = "Acting as" }: { id: string; label?: string }) {
  const { actors, actorId, setActorId } = useWorkspace();
  return (
    <div className={s.actorSel}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={actorId} onChange={(e) => setActorId(e.target.value)}>
        {actors.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}
      </select>
      <span className={s.hint}>Simulated role — sandbox only</span>
    </div>
  );
}
