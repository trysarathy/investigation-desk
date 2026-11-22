/** rc6 merchant reconciliation entry point. Pure: same input, same output; no I/O, no clock, no randomness. */
import { matchPayments, type MatchOutput } from "./match";
import { TEST_MODE_LABEL, type ReconcileInput, type TestModeLabel } from "./types";

export interface ReconcileResult extends MatchOutput { label: TestModeLabel; entityId: string }

export function reconcile(input: ReconcileInput): ReconcileResult {
  const matched = matchPayments(input);
  return { label: TEST_MODE_LABEL, entityId: input.entity.id, ...matched };
}
