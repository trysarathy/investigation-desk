import type { ReactNode } from "react";
import { fmtFiat, fmtToken, type FiatCurrency } from "@/lib/clearline/merchant";
import type { PartsSummary } from "@/server/merchant-ui";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";

/** Presentational pieces for the merchant reconciliation screens (server components). Test mode · illustrative data. */

export const DEMO_LABEL = "Test mode · illustrative data";
export const PENDING_SIGN_OFF = "Posting rules pending sign-off";

const TZ_ABBR: Record<string, string> = { "Asia/Singapore": "SGT", "Asia/Dubai": "GST" };
const utcOffset = (min: number) => `UTC${min >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
/**
 * An instant in an entity's own time zone ("2026-11-24 10:15 SGT"), from the entity's stored offset; without an
 * entity, UTC ("2026-11-24 02:15 UTC") as everywhere else.
 */
export function whenIn(v: string | Date | null | undefined, z?: { timezone: string; utcOffsetMinutes: number } | null): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  const tz = z ?? { timezone: "UTC", utcOffsetMinutes: 0 };
  const l = new Date(d.getTime() + tz.utcOffsetMinutes * 60_000).toISOString();
  return `${l.slice(0, 10)} ${l.slice(11, 16)} ${tz.timezone === "UTC" ? "UTC" : TZ_ABBR[tz.timezone] ?? utcOffset(tz.utcOffsetMinutes)}`;
}
const NETWORK_LABELS: Record<string, string> = { tron: "TRON", ethereum: "Ethereum" };
export const networkLabel = (n: string) => NETWORK_LABELS[n] ?? n;

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

/** rc7: the organisation's data label: the demo label for sample data, "Your data" for a live merchant (never both). */
export function DataChip({ label }: { label: string }) {
  if (label === DEMO_LABEL) return <DemoChip />;
  return <span className={m.liveChip} data-testid="data-label">{label}</span>;
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
  price_token_mismatch: "Paid in another token", price_token_amount: "Token amount differs",
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
  return <><Chip tone={tone}>{bankStatusLabel(p.bank.status)}{p.bank.tied ? " · tied" : ""}{p.bank.imported ? " · imported" : ""}</Chip> <EvidenceChip level={p.bank.evidence} label={p.bank.evidenceLabel} /></>;
}
/** v1 Phase 0.5: the bank evidence level, always shown beside (never inside) the match decision. */
export function EvidenceChip({ level, label }: { level: string; label: string }) {
  return <Chip tone={level === "none" ? "plain" : "info"} testId="bank-evidence">{label}</Chip>;
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
