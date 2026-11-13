"use client";
import { useState } from "react";
import type { FailureInjection } from "@/lib/clearline";
import { errorText, useWorkspace } from "./workspace";
import { Btn, Field, Status, ui } from "./ui";

export const INJECTIONS: [FailureInjection, string][] = [
  ["none", "Next scheduled event (no fault)"],
  ["timeout", "Provider timeout"],
  ["duplicate", "Duplicate delivery"],
  ["out_of_order", "Out-of-order (late) event"],
  ["contradictory", "Contradictory event"],
  ["bad_signature", "Invalid webhook signature"],
];

/** Asks the sandbox provider adapter for its next event, optionally with an injected fault. */
export function SimulateEvent({ intentId, idPrefix, onDone }: { intentId: string; idPrefix: string; onDone?: (outcome: string) => void }) {
  const { dispatch } = useWorkspace();
  const [inj, setInj] = useState<FailureInjection>("none");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  return (
    <form className={ui.panelBody} onSubmit={(e) => {
      e.preventDefault();
      const r = dispatch({ type: "simulate_provider_event", intentId, injection: inj });
      if (!r.ok) { setMsg({ text: `No event simulated — ${errorText(r)}`, error: true }); return; }
      setMsg({ text: `Provider event processed: ${r.value.outcome.replace(/_/g, " ")}.` });
      onDone?.(r.value.outcome);
    }}>
      <div className={ui.actions} style={{ alignItems: "flex-end" }}>
        <Field label="Failure injection">
          <select id={`${idPrefix}-inj`} value={inj} onChange={(e) => setInj(e.target.value as FailureInjection)}>
            {INJECTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Btn type="submit">Simulate next provider event</Btn>
      </div>
      <p className={ui.hint}>Sandbox provider only. A simulated event is a provider claim, never independent settlement evidence.</p>
      <Status msg={msg} />
    </form>
  );
}
