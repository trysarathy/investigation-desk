import type { ReactNode } from "react";
import { formatMinor, HUMAN_LABELS, type CurrencyCode, type EvidenceTimelineEntry } from "@/lib/clearline";
import s from "./control.module.css";

/** Presentational pieces for Clearline Control (server components; no client workspace). */

export const money = (amountMinor: number, currency: CurrencyCode | string) => formatMinor(amountMinor, currency as CurrencyCode);

const own = <T,>(o: Readonly<Record<string, T>>, k: string): T | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
export const executionLabel = (v: string) => own(HUMAN_LABELS.execution, v) ?? v;
export const settlementLabel = (v: string) => own(HUMAN_LABELS.settlement, v) ?? v;
export const reconciliationLabel = (v: string) => own(HUMAN_LABELS.reconciliation, v) ?? v;
export const categoryLabel = (v: string) => own(HUMAN_LABELS.exceptionCategory, v) ?? v;
export const exceptionStatusLabel = (v: string) => own(HUMAN_LABELS.exceptionStatus, v) ?? v;
export const caseStatusLabel = (v: string) => own(HUMAN_LABELS.caseStatus, v) ?? v;
export const severityLabel = (v: string) => own(HUMAN_LABELS.severity, v) ?? v;
export const evidenceKindLabel = (v: string) => own(HUMAN_LABELS.evidenceKind, v) ?? v;
export const timelineKindLabel = (v: string) => own(HUMAN_LABELS.timelineKind, v) ?? v;
export const priorityLabel = (v: string) => ({ low: "Low", normal: "Normal", high: "High", urgent: "Urgent" } as Record<string, string>)[v] ?? v;

/** "2026-11-13 02:27 UTC": deterministic, unambiguous, the same on every device. */
export function when(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export type Tone = "verified" | "warn" | "plain";
export function Tag({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`${s.tag} ${tone === "verified" ? s.tagVerified : tone === "warn" ? s.tagWarn : ""}`}>{children}</span>;
}

/** Green only for a state backed by independent evidence; oxblood for states that need attention. */
export const settlementTone = (v: string): Tone => (v === "verified" ? "verified" : v === "contradicted" ? "warn" : "plain");
export const executionTone = (v: string): Tone => (["returned", "failed", "on_hold", "awaiting_information", "cancelled", "expired"].includes(v) ? "warn" : "plain");
export const reconciliationTone = (v: string): Tone => (v === "exception" || v === "partially_matched" ? "warn" : "plain");

/**
 * The evidence class of one timeline entry: whether the record is independent evidence (a bank statement line or a
 * synthetic chain observation), a provider's claim, something a person recorded or attached, a Clearline rule, or
 * evidence that is still missing.
 */
export function evidenceClass(e: Pick<EvidenceTimelineEntry, "kind" | "independent" | "provenance">): { label: string; tone: Tone } {
  if (e.kind === "missing_evidence") return { label: "Missing evidence", tone: "warn" };
  if (e.independent) return { label: "Independent evidence", tone: "verified" };
  if (e.provenance.startsWith("provider_")) return { label: "Provider claim — not independent", tone: "plain" };
  if (e.provenance === "user_attached_metadata") return { label: "Attached by a person — not independent", tone: "plain" };
  if (e.provenance === "clearline_user_action") return { label: "Recorded action by a person", tone: "plain" };
  if (e.provenance === "engine_rule" || e.provenance === "matching_decision") return { label: "Clearline rule", tone: "plain" };
  return { label: "Recorded", tone: "plain" };
}

/** A table inside a keyboard-scrollable region, so a wide table never widens the page on a phone. */
export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div className={s.tableWrap} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function PageTitle({ title, lede }: { title: string; lede?: ReactNode }) {
  return (
    <>
      <h1 className={s.title}>{title}</h1>
      {lede ? <p className={s.lede}>{lede}</p> : null}
    </>
  );
}
