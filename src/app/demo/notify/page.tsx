// S1b (DEMO ONLY): the release result as an email and a Slack-style message. Preview only: nothing is sent.

import Link from "next/link";
import { notFound } from "next/navigation";
import { NotificationPreview, QuietNote } from "@/components/demo-slices/NotificationPreview";
import { ReleaseCard } from "@/components/demo-slices/ReleaseCard";
import { demoSlicesOn } from "@/lib/demo-slices/gate";
import { card, notificationFor } from "@/lib/demo-slices/release";
import { scenario } from "@/lib/demo-slices/replay";
import { DemoHead } from "../DemoHead";

export const dynamic = "force-dynamic";
const PICKS = [{ id: "TRON-01", label: "Paid and final (Tron)" }, { id: "SCN-07", label: "Short" }, { id: "SCN-01", label: "Ethereum, finality not checked" }, { id: "SCN-12", label: "Look-alike token" }, { id: "SCN-16", label: "Look-alike address" }];

export default async function NotifyDemo({ searchParams }: { searchParams: Promise<{ s?: string; wait?: string }> }) {
  if (!demoSlicesOn()) notFound();
  const { s, wait } = await searchParams;
  const id = s && scenario(s) ? s : "TRON-01";
  const c = await card(id, wait ? { asOfConfirmations: Math.max(0, Math.min(11, Number(wait) || 0)) } : {});
  const n = notificationFor(c);
  return (
    <div className="page demo-page">
      <DemoHead title="Message preview" current="/demo/notify" />
      <p style={{ margin: 0 }}>Quiet by default: a message only when a payment is paid and final, or has a problem. Never on every block.</p>
      <nav className="chips" aria-label="Example">
        {PICKS.map((p) => <Link key={p.id} className="chip" href={`/demo/notify?s=${p.id}`} aria-current={!wait && p.id === id ? "page" : undefined}>{p.label}</Link>)}
        <Link className="chip" href="/demo/notify?s=TRON-01&wait=4" aria-current={wait ? "page" : undefined}>Not final yet</Link>
      </nav>
      {n ? <NotificationPreview preview={n} /> : <QuietNote />}
      <ReleaseCard card={c} />
    </div>
  );
}
