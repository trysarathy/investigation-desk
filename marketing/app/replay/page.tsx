import type { Metadata } from "next";
import { ButtonLink } from "@/components/Shared";

/* /replay was the Studio V2 trial page. Its content now lives at /trial. Kept so old links do not break. */
export const metadata: Metadata = {
  title: "Customer trial has moved",
  description: "The customer trial and historical-case evaluation page is now at /trial.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/trial" },
};

export default function Replay() {
  return (
    <main id="main">
      <meta httpEquiv="refresh" content="0; url=/trial" />
      <section className="page-hero">
        <div className="container">
          <p className="eyebrow">Moved</p>
          <h1 className="h1">The customer trial page is now at /trial.</h1>
          <div className="actions"><ButtonLink href="/trial" main>Go to the customer trial</ButtonLink></div>
        </div>
      </section>
    </main>
  );
}
