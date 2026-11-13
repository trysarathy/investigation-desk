import type { Result, Workspace } from "./types";

export const serializeWorkspace = (ws: Workspace): string => JSON.stringify(ws);

const ARRAYS: (keyof Workspace)[] = [
  "actors", "routes", "intents", "quotes", "instructions", "providerEvents", "evidence", "statementLines", "allocations",
  "exceptions", "cases", "holds", "liquidity", "chainObservations", "advances", "fundingDecisions", "obligations", "repaymentAllocations", "audit",
];

/** Parse stored workspace JSON. On any error the UI should reset to the sample. */
export function parseWorkspace(text: string): Result<Workspace> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "invalid_field", message: "Stored workspace is not valid JSON." } };
  }
  const ws = v as Workspace;
  if (!ws || typeof ws !== "object" || ws.schemaVersion !== 1 || ws.mode !== "sandbox")
    return { ok: false, error: { code: "invalid_field", message: "Unsupported workspace schema; reset to sample." } };
  for (const k of ARRAYS) if (!Array.isArray(ws[k])) return { ok: false, error: { code: "invalid_field", message: `Workspace field ${k} missing.`, field: k } };
  if (typeof ws.asOf !== "string" || !Number.isSafeInteger(ws.seq) || !ws.organization?.fictional)
    return { ok: false, error: { code: "invalid_field", message: "Workspace header invalid; reset to sample." } };
  return { ok: true, value: ws };
}
