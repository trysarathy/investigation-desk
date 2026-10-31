import type { Metadata } from "next";
import { DemoVideo } from "@/components/DemoVideo";
import { BrowserFrame, Footer, Header, Motion, PrimaryButton, Shot } from "@/components/ui";

export const metadata: Metadata = { title: "Demo", description: "Watch Clearline in 60 seconds: the real product, running on a fictional company." };

const shots = [
  { name: "request", w: 1036, h: 1252, small: 518, caption: "1 · The customer sees exactly how to pay", alt: "A customer payment page for a fictional invoice: send exactly 860.00 USDC on Ethereum to the address shown." },
  { name: "auto-paid", w: 1504, h: 582, small: 752, caption: "2 · In the demo, a correct payment ticks itself off", alt: "In the demo, a fictional invoice marked paid automatically after the exact USDC amount arrived and reached 12 confirmations." },
  { name: "fake-explained", w: 1504, h: 572, small: 752, caption: "3 · A problem, explained, with the reply drafted", alt: "A fictional case explaining that 7,500 USDT came from a counterfeit contract, so it can't pay the invoice." },
];

export default function DemoPage() {
  return (
    <Motion>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <h1 className="text-center text-[clamp(32px,5vw,52px)] font-semibold tracking-[-0.03em]">Clearline in 60 seconds</h1>
        <p className="mx-auto mt-4 max-w-xl text-center text-[17px] text-muted">The real product, running on a fictional company. Captions are built in.</p>
        <DemoVideo className="mx-auto mt-10 max-w-5xl" />
        <p className="mt-3 text-center text-[13px] text-faint">Film shows steps 1–3; step 4 coming in the next cut.</p>
        <div className="mt-20 grid gap-10 md:grid-cols-3">
          {shots.map((s) => (
            <figure key={s.name}>
              <BrowserFrame label="demo data">
                <Shot name={s.name} w={s.w} h={s.h} small={s.small} sizes="(min-width: 768px) 360px, 90vw" alt={s.alt} className="block h-auto w-full" />
              </BrowserFrame>
              <figcaption className="mt-4 text-[15px] text-muted">{s.caption}</figcaption>
            </figure>
          ))}
        </div>
        <div className="mt-16 flex justify-center">
          <PrimaryButton />
        </div>
      </main>
      <Footer />
    </Motion>
  );
}
