import { STATE_LABELS, STATE_MEANING, type RequestState } from "@/lib/requests/types";

export function StatePill({ state }: { state: RequestState }) {
  return <span className={`pill pill-${state}`} title={STATE_MEANING[state]}>{STATE_LABELS[state]}</span>;
}
