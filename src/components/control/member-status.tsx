import type { ReactNode } from "react";
import { IconAlert, IconCheck, IconClock } from "@/components/ui/icons";
import u from "@/components/ui/ui.module.css";

/**
 * A member's or an invitation's state, as colour + icon + word (the same badge shape as StatusBadge, on the status
 * tokens already checked for contrast in both themes). Words are fixed: Active, Deactivated, Pending invitation,
 * Expired; a caller may pass its own label where a page already says more ("Revoked 2026-11-20 10:00 UTC").
 */
export type MemberState = "active" | "deactivated" | "pending" | "expired";

const IconBlocked = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="5.8" /><path d="M4 12L12 4" />
  </svg>
);

const LOOK: Record<MemberState, { cls: string; word: string; icon: () => ReactNode }> = {
  active: { cls: u["st-matched"], word: "Active", icon: () => <IconCheck /> },
  deactivated: { cls: u["ev-none"], word: "Deactivated", icon: () => <IconBlocked /> },
  pending: { cls: u["st-awaiting"], word: "Pending invitation", icon: () => <IconClock /> },
  expired: { cls: u["st-exception"], word: "Expired", icon: () => <IconAlert /> },
};

export function MemberStatus({ state, label, testId, wrap }: { state: MemberState; label?: ReactNode; testId?: string; wrap?: boolean }) {
  const l = LOOK[state];
  return <span className={`${u.badge} ${wrap ? u.badgeWrap : ""} ${l.cls}`} data-member-state={state} data-testid={testId}>{l.icon()}<span>{label ?? l.word}</span></span>;
}

/** The product mark: a small square with a check-and-line glyph (decorative; the name is always written next to it). */
export function ProductMark({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M2.5 11.5h11" /><path d="M4 7.2l2.2 2.2L12 3.8" />
      </svg>
    </span>
  );
}
