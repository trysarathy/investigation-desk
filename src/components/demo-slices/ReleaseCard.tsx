// S1 (DEMO ONLY): one "Paid / not yet / problem" card for a person deciding whether to release goods.
// The headline and every line come from releaseHeadline() (crypto-protocol-engineer); this only lays them out.

import { StatusIcon } from "@/components/Status";
import type { CheckState } from "@/lib/requests/release-checks";
import type { ReleaseCard as Card } from "@/lib/demo-slices/release";

const TONE = { paid: { box: "paid", eyebrow: "Paid" }, not_yet: { box: "progress", eyebrow: "Not yet" }, problem: { box: "blocked", eyebrow: "Problem" } } as const;
const STATE: Record<CheckState | "pending", { icon: "pass" | "fail" | "info"; word: string }> = {
  passed: { icon: "pass", word: "checked" }, failed: { icon: "fail", word: "problem" }, not_run: { icon: "info", word: "NOT checked" }, pending: { icon: "info", word: "not yet" },
};
const ROWS: { key: keyof Card["checks"]; label: string }[] = [
  { key: "finality", label: "Final" }, { key: "token", label: "Token" }, { key: "amount", label: "Amount" },
  { key: "sanctions", label: "Sanctions list" }, { key: "freeze", label: "Issuer freeze" },
];

export function ReleaseCard({ card, live = false, headingLevel = 2 }: { card: Card; live?: boolean; headingLevel?: 2 | 3 }) {
  const t = TONE[card.result.tone];
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={`verdict tone-box-${t.box}`} data-testid="release-card" data-tone={card.result.tone} aria-label={`${card.invoiceId}: ${t.eyebrow}`}>
      <div className="eyebrow">{t.eyebrow} · {card.invoiceId} · {card.invoiceAmount}</div>
      <H data-testid="release-headline" {...(live ? { role: "status", "aria-live": "polite" } : {})}>{card.result.headline}</H>
      <ul className="release-lines" data-testid="release-lines">
        {card.result.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <ul className="release-checks" aria-label="Checks">
        {ROWS.map((r) => {
          const c = card.checks[r.key], s = STATE[c.state];
          return (
            <li key={r.key} className={`status s-${s.icon}`} data-check={r.key} data-state={c.state}>
              <StatusIcon status={s.icon} /><span>{r.label}: {s.word}</span>
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
