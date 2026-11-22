import type { EntitySummary } from "@/server/merchant-ui";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";

/** A plain GET form choosing an entity and a month (works without JavaScript; full page load). */
export function EntityMonthForm({ action, entities, entity, month, label }: { action: string; entities: EntitySummary[]; entity: EntitySummary; month: string; label: string }) {
  const months = [...new Set(entities.flatMap((e) => e.months))].sort();
  return (
    <form className={m.filters} method="get" action={action} aria-label={label}>
      <div className={s.field}>
        <label className={s.label} htmlFor="em-entity">Entity</label>
        <select className={s.select} id="em-entity" name="entity" defaultValue={entity.id}>{entities.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.id}, {e.currency})</option>)}</select>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="em-month">Month</label>
        <select className={s.select} id="em-month" name="month" defaultValue={month}>{(months.includes(month) ? months : [...months, month].sort()).map((x) => <option key={x} value={x}>{x}</option>)}</select>
      </div>
      <div><button type="submit" className={s.button}>Show</button></div>
    </form>
  );
}

/** The selected entity and month from the query, defaulting to the first entity and its latest month with data. */
export function pickEntityMonth(entities: EntitySummary[], entityParam?: string, monthParam?: string) {
  const entity = entities.find((e) => e.id === entityParam) ?? entities[0];
  if (!entity) return null;
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : entity.months.at(-1) ?? new Date().toISOString().slice(0, 7);
  return { entity, month };
}
