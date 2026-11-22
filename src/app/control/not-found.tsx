import s from "@/components/control/control.module.css";

export default function ControlNotFound() {
  return (
    <main className={s.narrow}>
      <h1 className={s.title}>Not found</h1>
      <p className={s.lede}>This page does not exist in your organisation, or you do not have access to it.</p>
      <p><a href="/control">Go to the overview</a></p>
    </main>
  );
}
