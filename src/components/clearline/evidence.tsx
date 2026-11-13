"use client";
/**
 * Source attribution for evidence: who produced a record, and whether it is independent evidence,
 * a provider's claim, an engine rule or a person's note. Read from the engine records a finding or
 * timeline entry refers to; nothing is inferred beyond those records.
 */
import type { Workspace } from "@/lib/clearline";
import { label } from "./human";
import { ui } from "./ui";

export type Attribution = { source: string; basis: "independent" | "provider_claim" | "engine_rule" | "person" | "record"; ref: string };

const BASIS_TEXT: Record<Attribution["basis"], string> = {
  independent: "independent evidence",
  provider_claim: "provider claim",
  engine_rule: "Clearline rule",
  person: "recorded by a person",
  record: "workspace record",
};

export function attributionOf(ws: Workspace, ref: string): Attribution | undefined {
  const pev = ws.providerEvents.find((x) => x.id === ref);
  if (pev) return { source: pev.providerName, basis: "provider_claim", ref: pev.providerEventId };
  const ev = ws.evidence.find((x) => x.id === ref);
  if (ev) return { source: ev.source, basis: ev.independent ? "independent" : ev.kind === "provider_status_report" ? "provider_claim" : "person", ref: ev.reference ?? ev.id };
  const line = ws.statementLines.find((x) => x.id === ref);
  if (line) return { source: `${label("statementSource", line.source)} · ${line.accountRef}`, basis: line.source === "bank_statement" ? "independent" : "provider_claim", ref: line.lineId };
  const chain = ws.chainObservations.find((x) => x.id === ref);
  if (chain) return { source: `${chain.label} (${chain.network})`, basis: "independent", ref: chain.txHash };
  const exc = ws.exceptions.find((x) => x.id === ref);
  if (exc) return { source: "Clearline reconciliation and exception rules", basis: "engine_rule", ref: exc.id };
  const hold = ws.holds.find((x) => x.id === ref);
  if (hold) return { source: `Partner (${hold.providerId})`, basis: "provider_claim", ref: hold.id };
  return undefined;
}

/** "Source: Northline Payments (sandbox) — provider claim" for every record a finding refers to. */
export function SourceLine({ ws, refs }: { ws: Workspace; refs: string[] }) {
  const items = refs.map((r) => attributionOf(ws, r)).filter((a): a is Attribution => Boolean(a));
  if (!items.length) return null;
  return (
    <span className={ui.sub} data-testid="finding-source">
      {items.map((a, i) => (
        <span key={a.ref + i} style={{ display: "block" }}>
          Source: {a.source} — {BASIS_TEXT[a.basis]} <span className="mono" style={{ overflowWrap: "anywhere" }}>{a.ref}</span>
        </span>
      ))}
    </span>
  );
}
