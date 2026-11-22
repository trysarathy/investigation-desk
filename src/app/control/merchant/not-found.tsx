import s from "@/components/control/control.module.css";

/** Inside the white-label layout: a record or a page this person may not see is simply not found (nothing disclosed). */
export default function MerchantNotFound() {
  return (
    <section aria-labelledby="nf">
      <h1 className={s.title} id="nf">Not found</h1>
      <p className={s.lede}>This page does not exist in your organisation, or your role does not give you access to it.</p>
      <p><a href="/control">Go to your start page</a></p>
    </section>
  );
}
