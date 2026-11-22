"use client";

import s from "@/components/control/control.module.css";

/** A page that could not load: a plain-English message and a retry, never a stack trace or partial data. */
export default function MerchantError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section aria-labelledby="err" role="alert">
      <h1 className={s.title} id="err">This page could not load</h1>
      <p className={s.lede}>The server could not answer just now. Nothing was changed. Try again; if it keeps happening, sign out and back in.</p>
      <button type="button" className={s.button} onClick={() => reset()}>Try again</button>
    </section>
  );
}
