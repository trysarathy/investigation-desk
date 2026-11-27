import type { ReactNode } from "react";
import { IconAlert, IconBank, IconCheck, IconCheckDiff, IconCircleDash, IconClock, IconEye, IconFile, IconSeal, IconTwoPerson } from "./icons";
import { BANK_EVIDENCE_RANK, BANK_EVIDENCE_SHORT, type BankEvidenceLevel } from "@/lib/clearline/merchant/types";
import u from "./ui.module.css";

/** The six states. The engine's decision names are accepted as they are stored ("suggested_for_review" = needs review). */
export type StatusKind = "matched" | "matched_with_difference" | "needs_review" | "suggested_for_review" | "exception" | "approved" | "awaiting_evidence";

const STATUS: Record<StatusKind, { cls: string; word: string; icon: () => ReactNode }> = {
  matched: { cls: u["st-matched"], word: "Matched", icon: () => <IconCheck /> },
  matched_with_difference: { cls: u["st-diff"], word: "Matched with difference", icon: () => <IconCheckDiff /> },
  needs_review: { cls: u["st-review"], word: "Needs review", icon: () => <IconEye /> },
  suggested_for_review: { cls: u["st-review"], word: "Needs review", icon: () => <IconEye /> },
  exception: { cls: u["st-exception"], word: "Exception", icon: () => <IconAlert /> },
  approved: { cls: u["st-approved"], word: "Approved", icon: () => <IconSeal /> },
  awaiting_evidence: { cls: u["st-awaiting"], word: "Awaiting evidence", icon: () => <IconClock /> },
};

export const STATUS_WORDS: Readonly<Record<StatusKind, string>> = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.word])) as Record<StatusKind, string>;

export interface BadgeProps {
  /** Replaces the default word (keep the page's existing wording where tests read it). */
  label?: ReactNode;
  /** Let a long label wrap instead of widening the page at 390 px. */
  wrap?: boolean;
  title?: string;
  className?: string;
  "data-testid"?: string;
}

/** A status: colour + icon + word, the same everywhere. */
export function StatusBadge({ kind, label, wrap, title, className, ...rest }: BadgeProps & { kind: StatusKind }) {
  const s = STATUS[kind];
  return <span className={[u.badge, s.cls, wrap ? u.badgeWrap : "", className ?? ""].filter(Boolean).join(" ")} title={title} data-status={kind} data-testid={rest["data-testid"]}>{s.icon()}<span>{label ?? s.word}</span></span>;
}

/**
 * Bank evidence levels (src/lib/clearline/merchant/types.ts BankEvidenceLevel, ranked by BANK_EVIDENCE_RANK) plus
 * "imported" (an imported line not yet confirmed by a second person). The top level (rank 2, bank-authenticated) is
 * RESERVED: nothing produces it yet, so this file only derives its badge from the level's own definitions.
 */
export type EvidenceLevel = BankEvidenceLevel | "imported";

type Look = { cls: string; word: string; icon: () => ReactNode };
const BY_RANK: Record<number, Omit<Look, "word">> = {
  0: { cls: u["ev-none"], icon: () => <IconCircleDash /> },
  1: { cls: u["ev-two-person"], icon: () => <IconTwoPerson /> },
  2: { cls: u["ev-bank"], icon: () => <IconBank /> },
};
const EVIDENCE = Object.fromEntries([
  ...(Object.keys(BANK_EVIDENCE_RANK) as BankEvidenceLevel[]).map((l) => [l, { ...BY_RANK[BANK_EVIDENCE_RANK[l]], word: BANK_EVIDENCE_SHORT[l] }]),
  ["imported", { cls: u["ev-imported"], word: "Bank evidence: imported, not yet confirmed", icon: () => <IconFile /> }],
]) as Record<EvidenceLevel, Look>;

export const EVIDENCE_WORDS: Readonly<Record<EvidenceLevel, string>> = Object.fromEntries(Object.entries(EVIDENCE).map(([k, v]) => [k, v.word])) as Record<EvidenceLevel, string>;

/** An evidence level: a distinct colour, icon and word per level. */
export function EvidenceBadge({ level, label, wrap, title, className, ...rest }: BadgeProps & { level: EvidenceLevel }) {
  const e = EVIDENCE[level];
  return <span className={[u.badge, e.cls, wrap ? u.badgeWrap : "", className ?? ""].filter(Boolean).join(" ")} title={title} data-evidence={level} data-testid={rest["data-testid"]}>{e.icon()}<span>{label ?? e.word}</span></span>;
}
