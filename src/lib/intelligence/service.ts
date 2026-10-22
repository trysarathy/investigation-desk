import {
  database,
  getDocument,
  putDocument,
  audit,
  workspaceId,
} from "../platform/store";
import { aggregateSignals, type Contribution } from "./signals";
// An internal aggregation boundary, never exposed as raw contribution rows to an API.
export function intelligence() {
  const consentRows = database()
    .prepare(
      "SELECT workspace,body FROM documents WHERE kind='intelligence-consent'",
    )
    .all() as { workspace: string; body: string }[];
  const opted = new Set(
    consentRows
      .filter((r) => JSON.parse(r.body).enabled === true)
      .map((r) => r.workspace),
  );
  const rows = database()
    .prepare(
      "SELECT body FROM documents WHERE kind='intelligence-contribution'",
    )
    .all() as { body: string }[];
  const day = new Date().toISOString().slice(0, 10);
  return {
    enabled: opted.has(workspaceId()),
    aggregates: aggregateSignals(
      rows.map((r) => JSON.parse(r.body)),
      workspaceId(),
      opted,
      day,
    ),
  };
}
export function setConsent(enabled: boolean, actor: string) {
  putDocument("intelligence-consent", "current", {
    enabled,
    at: new Date().toISOString(),
  });
  if (!enabled)
    database()
      .prepare(
        "DELETE FROM documents WHERE workspace=? AND kind='intelligence-contribution'",
      )
      .run(workspaceId());
  audit(
    enabled ? "intelligence.opted_in" : "intelligence.opted_out",
    "consent",
    actor,
  );
}
export function contribute(
  pattern: Contribution["pattern"],
  chain: Contribution["chain"],
  actor: string,
) {
  if (
    !getDocument<{ enabled: boolean }>("intelligence-consent", "current")
      ?.enabled
  )
    throw Error("Opt in first");
  const day = new Date().toISOString().slice(0, 10);
  putDocument("intelligence-contribution", `${day}:${pattern}:${chain}`, {
    workspace: workspaceId(),
    day,
    pattern,
    chain,
  });
  audit("intelligence.contributed", `${pattern}:${chain}`, actor);
}
