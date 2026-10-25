import type { Tone } from "@/lib/requests/present";
import { STATE_LABELS, STATE_MEANING, type RequestState } from "@/lib/requests/types";

export function StatePill({ state }: { state: RequestState }) {
  return <span className={`pill pill-${state}`} title={STATE_MEANING[state]}>{STATE_LABELS[state]}</span>;
}

const TONE_MEANING: Record<Tone, string> = {
  paid: "Paid: nothing to do.",
  progress: "On its way: nothing to do yet.",
  waiting: "Waiting for the customer.",
  attention: "Needs a person: open it for the cause, evidence and a drafted reply.",
  blocked: "Blocked: this transfer can never count (counterfeit token or failed transaction).",
};

/** One status colour system everywhere: paid green, in progress blue, waiting grey, needs attention amber, blocked red. */
export function TonePill({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`pill tone-${tone}`} title={TONE_MEANING[tone]}>{label}</span>;
}

export function DemoBadge() {
  return <span className="demo-badge" title="Fictional business, customers, messages, addresses and transactions. Transfers are simulated.">Demo data</span>;
}
