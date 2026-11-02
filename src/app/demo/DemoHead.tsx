// The heading every demo slice page shares: what it is, and the labels that must always be visible.

import Link from "next/link";
import { DEMO_WATCH_LABEL } from "@/lib/demo-slices/release";
import { TRANSFER_LABEL } from "@/lib/demo-slices/replay";

const PAGES = [
  { href: "/demo/release", label: "Release check" },
  { href: "/demo/notify", label: "Message preview" },
];

export function DemoHead({ title, current }: { title: string; current: string }) {
  return (
    <>
      <div className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <span className="demo-badge" data-testid="demo-slice-label">{DEMO_WATCH_LABEL}</span>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Demo only. Every transfer is a real public transfer, recorded once and replayed offline; every invoice is a sample.
        {" "}<span className="demo-badge">{TRANSFER_LABEL}</span>{" "}Nothing is looked up live and nothing is sent.
      </p>
      <nav className="chips" aria-label="Demo slices">
        {PAGES.map((p) => <Link key={p.href} href={p.href} className="chip" aria-current={p.href === current ? "page" : undefined}>{p.label}</Link>)}
      </nav>
    </>
  );
}
