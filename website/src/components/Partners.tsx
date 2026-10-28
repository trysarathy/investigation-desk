"use client";
import { useState } from "react";
import { Eyebrow, Reveal, SectionTitle } from "./ui";
import { readUtm } from "./UtmCapture";
import { site } from "@/lib/site";

const perks = [
  ["Early access", "Use Clearline on your own payments before anyone else."],
  ["A direct line to the founder", "Your problems shape what gets built next."],
  ["Free during the pilot", "No cost, no commitment. Leave whenever you like."],
];

const field = "mt-2 block w-full rounded-xl border border-line-strong bg-ink px-4 py-3 text-[15px] text-fg placeholder:text-faint focus:border-accent focus:outline-none";

type Status = "idle" | "sending" | "sent" | "error";

export function Partners() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (data.get("_gotcha")) return; // a bot filled the hidden field
    for (const [k, v] of Object.entries(readUtm())) data.set(k, v);
    data.set("_subject", `Design partner: ${data.get("company") || "new request"}`);
    if (!site.formspreeId) {
      setStatus("error");
      setError("The form isn't connected yet. Please use the LinkedIn link below.");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(`https://formspree.io/f/${site.formspreeId}`, { method: "POST", body: data, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
      form.reset();
    } catch {
      setStatus("error");
      setError("Something went wrong sending the form. Please try again, or reach out on LinkedIn.");
    }
  }

  return (
    <section id="design-partners" className="scroll-mt-24 border-y border-line bg-panel/40">
      <div className="mx-auto grid max-w-6xl gap-14 px-5 py-20 sm:px-8 sm:py-24 md:grid-cols-[1fr_1.1fr] md:gap-16">
        <Reveal>
          <Eyebrow>Design partners</Eyebrow>
          <SectionTitle>Help shape Clearline.</SectionTitle>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-muted">
            We're working with a small number of early teams that receive stablecoin payments. Prefer to write rather than book a call? Tell us a little about yours here.
          </p>
          <ul className="mt-10 space-y-6">
            {perks.map(([t, b]) => (
              <li key={t} className="flex gap-4">
                <span className="mt-1 grid h-6 w-6 flex-none place-items-center rounded-full bg-accent/15 text-accent">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <div>
                  <p className="font-semibold">{t}</p>
                  <p className="mt-1 text-[15px] text-muted">{b}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.1}>
          {status === "sent" ? (
            <div role="status" className="rounded-2xl border border-good/30 bg-good/[0.06] p-8">
              <p className="text-[20px] font-semibold">Thank you. We'll be in touch within two working days.</p>
              <p className="mt-3 text-muted">If you'd rather talk sooner, book 15 minutes from the button at the top of the page.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="rounded-2xl border border-line-strong bg-panel p-6 sm:p-8" noValidate={false}>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-[14px] font-medium">Name
                  <input name="name" required autoComplete="name" className={field} />
                </label>
                <label className="block text-[14px] font-medium">Company
                  <input name="company" required autoComplete="organization" className={field} />
                </label>
              </div>
              <label className="mt-5 block text-[14px] font-medium">Work email
                <input name="email" type="email" required autoComplete="email" className={field} />
              </label>
              <fieldset className="mt-5">
                <legend className="text-[14px] font-medium">How do customers pay you in stablecoins?</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {["Checkout page", "Direct transfer", "Both", "Not sure"].map((o, i) => (
                    <label key={o} className="flex cursor-pointer items-center justify-center rounded-xl border border-line-strong px-3 py-3 text-center text-[14px] text-muted has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:text-fg">
                      <input type="radio" name="how_customers_pay" value={o} required={i === 0} className="sr-only" />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="mt-5 block text-[14px] font-medium">Stablecoin payments received a month (US$)
                <select name="monthly_volume" required defaultValue="" className={field}>
                  <option value="" disabled>Choose a range</option>
                  <option>Under 10,000</option>
                  <option>10,000 – 100,000</option>
                  <option>100,000 – 1 million</option>
                  <option>Over 1 million</option>
                  <option>Prefer not to say</option>
                </select>
              </label>
              <label className="mt-5 block text-[14px] font-medium">Anything else? <span className="font-normal text-faint">(optional)</span>
                <textarea name="note" rows={3} className={field} placeholder="e.g. what goes wrong most often" />
              </label>
              <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
              <label className="mt-5 flex gap-3 text-[13.5px] leading-relaxed text-muted">
                <input type="checkbox" name="consent" value="yes" required className="mt-1 h-4 w-4 flex-none accent-[#8ea2ff]" />
                <span>I agree that Clearline can use these details to contact me about the design-partner programme, as described in the <a href="/privacy/" className="text-accent underline-offset-2 hover:underline">privacy notice</a>.</span>
              </label>
              <button type="submit" disabled={status === "sending"} className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-full bg-fg text-[15px] font-semibold text-ink transition hover:bg-white disabled:opacity-60">
                {status === "sending" ? "Sending…" : "Apply to be a design partner"}
              </button>
              {status === "error" && <p role="alert" className="mt-4 text-[14px] text-bad">{error}</p>}
            </form>
          )}
        </Reveal>
      </div>
    </section>
  );
}
