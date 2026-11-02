// S1 (DEMO ONLY): one "Paid / not yet / problem" card for a person deciding whether to release goods.
// The headline and every line come from releaseHeadline() (crypto-protocol-engineer); this only lays them out.

import { StatusIcon } from "@/components/Status";
import type { ReleaseCard as Card } from "@/lib/demo-slices/release";
import { checkChips, ranSummary, statusLabel, technicalLines, type ChipTone } from "@/lib/demo-slices/present";

const BOX = { paid: "paid", not_yet: "progress", problem: "blocked" } as const;
const ICON: Record<ChipTone, "pass" | "fail" | "warn" | "info"> = { pass: "pass", fail: "fail", warn: "warn", wait: "info" };

/** The five checks as chips, icon + words (never colour alone). Not checked = amber warning. */
export function CheckChips({ card }: { card: Card }) {
  return (
    <ul className="release-checks" aria-label="Checks" data-testid="check-chips">
      {checkChips(card.checks, { paidOn: card.network, invoiceOn: card.invoiceNetwork }).map((c) => (
        <li key={c.key} className={`status s-${ICON[c.tone]}`} data-check={c.key} data-tone={c.tone}>
          <StatusIcon status={ICON[c.tone]} /><span>{c.label}: {c.word}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReleaseCard({ card, live = false, headingLevel = 2 }: { card: Card; live?: boolean; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const label = statusLabel(card.checks, card.result.tone);
  return (
    <section className={`verdict tone-box-${BOX[card.result.tone]}`} data-testid="release-card" data-tone={card.result.tone} aria-label={`${card.invoiceId}: ${label}`}>
      <div className="eyebrow" data-testid="release-status">{label} · {card.invoiceId} · {card.invoiceAmount}</div>
      <H data-testid="release-headline" {...(live ? { role: "status", "aria-live": "polite" } : {})}>{card.result.headline}</H>
      <p style={{ margin: 0, fontWeight: 500 }} data-testid="ran-summary">{ranSummary(card.checks, card.result.tone)}</p>
      <CheckChips card={card} />
      <ul className="release-lines" data-testid="release-lines">
        {card.result.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      {technicalLines(card.checks).length > 0 && (
        <details className="tech" data-testid="technical">
          <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>Technical details</summary>
          <ul className="release-lines" style={{ fontSize: 12 }}>{technicalLines(card.checks).map((l, i) => <li key={i} className="mono">{l}</li>)}</ul>
        </details>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        {card.customerRef} · transfer <span className="mono" title={card.hash}>{card.shortHash}</span> on {card.network}
      </p>
    </section>
  );
}
