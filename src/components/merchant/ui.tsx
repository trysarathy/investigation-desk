import type { ReactNode } from "react";
import { fmtFiat, fmtToken, type FiatCurrency } from "@/lib/clearline/merchant";
import type { PartsSummary } from "@/server/merchant-ui";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";

/** Presentational pieces for the merchant reconciliation screens (server components). Test mode · illustrative data. */

export const DEMO_LABEL = "Test mode · illustrative data";
export const PENDING_SIGN_OFF = "Posting rules pending sign-off";

export const fiat = (minor: string | bigint | number | null | undefined, cur: string) => (minor === null || minor === undefined ? "—" : fmtFiat(BigInt(minor), cur as FiatCurrency));
export const token = (base: string, decimals: number, symbol: string) => fmtToken(BigInt(base), decimals, symbol);

export type ChipTone = "ok" | "warn" | "info" | "amber" | "plain";
export function Chip({ tone = "plain", children, testId }: { tone?: ChipTone; children: ReactNode; testId?: string }) {
  const c = tone === "ok" ? m.chipOk : tone === "warn" ? m.chipWarn : tone === "info" ? m.chipInfo : tone === "amber" ? m.chipAmber : "";
  return <span className={`${m.chip} ${c}`} data-testid={testId}>{children}</span>;
}

export function DemoChip() {
  return <span className={m.demoChip} data-testid="demo-label">{DEMO_LABEL}</span>;
}

export function PendingSignOff() {
  return <Chip tone="amber" testId="pending-sign-off">{PENDING_SIGN_OFF}</Chip>;
}

const DECISION: Record<string, { label: string; tone: ChipTone }> = {
  matched: { label: "Matched", tone: "ok" },
  matched_with_difference: { label: "Matched with difference", tone: "info" },
  suggested_for_review: { label: "Suggested for review", tone: "amber" },
  exception: { label: "Exception", tone: "warn" },
};
export const decisionLabel = (d: string) => DECISION[d]?.label ?? d;
export function DecisionChip({ decision }: { decision: string }) {
  const x = DECISION[decision] ?? { label: decision, tone: "plain" as const };
  return <Chip tone={x.tone} testId="decision-chip">{x.label}</Chip>;
}

export const DIFFERENCE_LABELS: Record<string, string> = {
  sender_side_fee: "Sender-side fee", underpayment: "Underpayment", overpayment: "Overpayment", requote_after_expiry: "Re-quote after expiry",
  rate_difference: "Rate difference", provider_fee: "Provider fee", refund_netted: "Refund netted", timing_prior_batch: "Timing: prior batch",
  timing_next_batch: "Timing: next batch", held_by_provider: "Held by provider", partial_payment_open: "Partial payment open", unexplained: "Unexplained",
};
export const differenceLabel = (t: string) => DIFFERENCE_LABELS[t] ?? t;

const BANK: Record<string, string> = { not_in_batch: "Not in a batch", in_batch: "In a batch", held_by_provider: "Held by provider", proposed_grouping: "Grouping proposed" };
export const bankStatusLabel = (v: string) => BANK[v] ?? v;
export const STEP_NAMES: Record<number, string> = { 1: "Identity", 2: "Reference", 3: "Checks", 4: "Explained tolerance", 5: "Grouping" };

/* The four record parts as separate chips; the fifth part, the explanation, is the decision chip. Never merged. */
export function ChainChip({ p }: { p?: PartsSummary }) {
  if (!p) return <span className={s.muted}>—</span>;
  if (p.chain.transfers === 0) return <Chip tone="warn">No transfer</Chip>;
  return <Chip tone={p.chain.pending ? "amber" : "ok"}>{p.chain.transfers} final{p.chain.pending ? ` · ${p.chain.pending} pending` : ""}</Chip>;
}
export function ProviderChip({ p }: { p?: PartsSummary }) {
  if (!p) return <span className={s.muted}>—</span>;
  if (!p.provider.records) return <Chip tone="warn">No record</Chip>;
  return <Chip tone="plain">Claims {p.provider.claims.join(", ").replace(/_/g, " ")}</Chip>;
}
export function BankChip({ p }: { p?: PartsSummary }) {
  if (!p) return <span className={s.muted}>—</span>;
  const tone: ChipTone = p.bank.verified ? "ok" : p.bank.status === "held_by_provider" || p.bank.status === "not_in_batch" ? "warn" : "plain";
  return <Chip tone={tone}>{bankStatusLabel(p.bank.status)}{p.bank.tied ? " · tied" : ""}{p.bank.imported ? " · imported" : ""}</Chip>;
}
export function LedgerChip({ p }: { p?: PartsSummary }) {
  if (!p) return <span className={s.muted}>—</span>;
  const tone: ChipTone = p.ledger.state === "fully_credited" ? "ok" : p.ledger.state === "over_credited" || p.ledger.state === "short_paid" || p.ledger.state === "part_paid" ? "amber" : "warn";
  return <Chip tone={tone}>{p.ledger.label.charAt(0).toUpperCase() + p.ledger.label.slice(1)}</Chip>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className={m.empty} role="status">{children}</div>;
}

/** "3 h", "2 d": how long something has been open, from a reference instant. */
export function age(from: string, ref: number): string {
  const ms = Math.max(0, ref - Date.parse(from));
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function q(params: Record<string, string | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const x = u.toString();
  return x ? `?${x}` : "";
}

/** A Next searchParams value as one string. */
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;
