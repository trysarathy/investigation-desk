import type { ExecutionState, NormalizedEventType } from "./types";

/**
 * Allowed execution transitions. Settlement evidence and reconciliation are separate
 * dimensions and are NOT changed by these transitions.
 *
 * Note `submitted → provider_reported_completed` is allowed: a provider may report completion
 * without a separate in-transit event, and the engine never invents the missing event.
 */
export const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  created: ["quoted", "cancelled", "expired"],
  quoted: ["quoted", "approved", "cancelled", "expired"],
  approved: ["submitted", "cancelled", "expired"],
  submitted: ["in_transit", "provider_reported_completed", "awaiting_information", "on_hold", "failed", "returned"],
  in_transit: ["provider_reported_completed", "awaiting_information", "on_hold", "failed", "returned"],
  awaiting_information: ["in_transit", "on_hold", "failed", "cancelled"],
  on_hold: ["in_transit", "failed", "returned", "cancelled"],
  provider_reported_completed: ["returned"],
  failed: [],
  returned: [],
  cancelled: [],
  expired: [],
};

export const canTransitionExecution = (from: ExecutionState, to: ExecutionState): boolean => EXECUTION_TRANSITIONS[from].includes(to);

export const isTerminalExecution = (s: ExecutionState): boolean => EXECUTION_TRANSITIONS[s].length === 0;

/** Progress rank used to detect late (out-of-order) events. Terminal outcomes rank highest. */
export const PROGRESS_RANK: Readonly<Record<ExecutionState, number>> = {
  created: 0, quoted: 1, approved: 2, submitted: 3, awaiting_information: 4, on_hold: 4, in_transit: 4,
  provider_reported_completed: 5, failed: 6, returned: 6, cancelled: 6, expired: 6,
};

/** Execution state a provider event type claims, if any. */
export const EVENT_TARGET: Partial<Record<NormalizedEventType, ExecutionState>> = {
  "payout.accepted": "submitted",
  "payout.in_transit": "in_transit",
  "payout.completed": "provider_reported_completed",
  "payout.failed": "failed",
  "payout.returned": "returned",
  "payout.on_hold": "on_hold",
  "payout.information_requested": "awaiting_information",
};
