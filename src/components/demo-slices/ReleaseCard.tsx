// S1 (DEMO ONLY): one "Paid / not yet / problem" card for a person deciding whether to release goods.
// The headline and lines come from releaseHeadline(); this only lays them out. States only checks that ran.

import { StatusIcon } from "@/components/Status";
import type { CheckState } from "@/lib/demo-slices/release-adapter";
import type { ReleaseCard as Card } from "@/lib/demo-slices/release";

const TONE = { paid: { box: "paid", eyebrow: "Paid" }, not_yet: { box: "progress", eyebrow: "Not yet" }, problem: { box: "blocked", eyebrow: "Problem" } } as const;
const STATE: Record<CheckState, { icon: "pass" | "fail" | "info"; word: string }> = {
  passed: { icon: "pass", word: "Checked" }, failed: { icon: "fail", word: "Problem" }, not_run: { icon: "info", word: "Not checked" },
};
const ROWS: { key: keyof Card["checks"]; label: string }[] = [
  { key: "finality", label: "Final" }, { key: "token", label: "Token" }, { key: "amount", label: "Amount" },
  { key: "sanctions", label: "Sender on sanctions list" }, { key: "freeze", label: "Frozen by issuer" },
];

export function ReleaseCard({ card, live = false, headingLevel = 2 }: { card: Card; live?: boolean; headingLevel?: 2 | 3 }) {
  const t = TONE[card.result.tone];
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={`verdict tone-box-${t.box}`} data-testid="release-card" data-tone={card.result.tone} aria-label={`${card.invoiceId}: ${t.eyebrow}`}>
      <div className="eyebrow">{t.eyebrow} · {card.invoiceId} · {card.invoiceAmount}</div>
      <H data-testid="release-headline" {...(live ? { role: "status", "aria-live": "polite" } : {})}>{card.result.headline}</H>
      <ul className="release-checks">
        {ROWS.map((r) => {
          const c = card.checks[r.key], s = STATE[c.state];
          // "Final: not yet", not "not checked": the check ran and the transfer isn't final yet.
          const word = r.key === "finality" && c.state === "not_run" ? "Not yet" : s.word;
          return (
            <li key={r.key} className={`status s-${s.icon}`} data-check={r.key} data-state={c.state}>
              <StatusIcon status={s.icon} />
              <span><strong>{r.label}: {word}.</strong> <span className="muted">{c.detail}</span></span>
            </li>
          );
        })}
      </ul>
      <p className="muted" style={{ fontSize: 13 }}>
        {card.customerRef} · transfer <span className="mono" title={card.hash}>{card.shortHash}</span> on {card.network}
      </p>
      <p className="demo-badge" style={{ alignSelf: "flex-start" }}>{card.label}</p>
    </section>
  );
}
