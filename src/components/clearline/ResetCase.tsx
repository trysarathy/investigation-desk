"use client";
/**
 * Per-case reset of a guided case through the engine (rc3: canResetScenario / resetScenario). The
 * engine is asked first; a refusal disables the button and shows its reason. Only that case is
 * restored: other cases and records the person created stay as they are.
 */
import { useMemo, useState } from "react";
import { useWorkspace } from "./workspace";
import { ActionButton, type Gate } from "./Action";
import { label } from "./human";
import { Status } from "./ui";

export function ResetCaseButton({ scenario, children }: { scenario: string; children: string }) {
  const { ws, canResetCase, resetCase } = useWorkspace();
  const check = useMemo(() => canResetCase(scenario), [ws, scenario, canResetCase]); // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const gate: Gate = check.allowed ? { ok: true } : {
    ok: false,
    reason: `${label("resetCode", check.code)}. ${check.reason}`,
    code: check.blockers.length ? `${check.code} · ${check.blockers.slice(0, 3).join(", ")}${check.blockers.length > 3 ? "…" : ""}` : check.code,
  };
  return (
    <div data-testid="reset-case">
      <ActionButton size="small" gate={gate} name="Reset case" onClick={() => {
        const r = resetCase(scenario);
        setMsg(r.ok
          ? { text: `${children} — recorded by the engine: ${r.removed} record(s) replaced by the ${r.restored} original record(s). Other cases and your own records are unchanged.` }
          : { text: `${children} — not applied. ${r.reason} (${r.code})`, error: true });
      }}>{children}</ActionButton>
      <Status msg={msg} />
    </div>
  );
}
