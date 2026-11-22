import s from "@/components/control/control.module.css";

/** Shown while a Control page loads (instead of the legacy app's skeleton from src/app/loading.tsx). */
export default function ControlLoading() {
  return <main className={s.main} aria-busy="true"><p className={s.muted}>Loading…</p></main>;
}
