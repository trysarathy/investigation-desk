import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Facts, Code, Settings } from "../types";
import type { CaseView } from "../view";
export interface CaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  facts: Facts;
  settings: Settings;
  view: CaseView;
  provenance: "synthetic" | "public-chain" | "analyst";
  revisions: { at: string; facts: Facts; settings: Settings; view: CaseView }[];
  feedback?: {
    actual: Code;
    reason: string;
    actor: string;
    at: string;
    adjudicated: boolean;
  };
  resolvedAt?: string;
}
export const workspaceId = () => process.env.WORKSPACE_ID ?? "local-preview";
let db: DatabaseSync | undefined;
export function database() {
  if (!db) {
    const dir = process.env.DESK_DATA_DIR ?? path.join(process.cwd(), ".data");
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "desk.sqlite"));
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (workspace TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(workspace,kind,id));
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, object_id TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;`);
  }
  return db;
}
export function getDocument<T>(
  kind: string,
  id: string,
  ws = workspaceId(),
): T | undefined {
  const row = database()
    .prepare("SELECT body FROM documents WHERE workspace=? AND kind=? AND id=?")
    .get(ws, kind, id) as { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
}
export function documents<T>(kind: string, ws = workspaceId()): T[] {
  return (
    database()
      .prepare(
        "SELECT body FROM documents WHERE workspace=? AND kind=? ORDER BY rowid DESC",
      )
      .all(ws, kind) as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}
export function putDocument(
  kind: string,
  id: string,
  value: unknown,
  ws = workspaceId(),
) {
  database()
    .prepare(
      "INSERT INTO documents VALUES (?,?,?,?) ON CONFLICT(workspace,kind,id) DO UPDATE SET body=excluded.body",
    )
    .run(ws, kind, id, JSON.stringify(value));
}
export function audit(
  action: string,
  objectId: string,
  actor = "system",
  ws = workspaceId(),
) {
  const d = database();
  const previous = d
    .prepare(
      "SELECT hash FROM audit WHERE workspace=? ORDER BY sequence DESC LIMIT 1",
    )
    .get(ws) as { hash: string } | undefined;
  const at = new Date().toISOString(),
    prev = previous?.hash ?? "";
  const hash = createHash("sha256")
    .update(JSON.stringify([ws, at, actor, action, objectId, prev]))
    .digest("hex");
  d.prepare(
    "INSERT INTO audit(workspace,at,actor,action,object_id,previous_hash,hash) VALUES(?,?,?,?,?,?,?)",
  ).run(ws, at, actor, action, objectId, prev, hash);
}
export function auditRows(ws = workspaceId()) {
  return database()
    .prepare(
      "SELECT * FROM audit WHERE workspace=? ORDER BY sequence DESC LIMIT 200",
    )
    .all(ws);
}
export function atomic<T>(fn: () => T): T {
  database().exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    database().exec("COMMIT");
    return out;
  } catch (e) {
    database().exec("ROLLBACK");
    throw e;
  }
}
export function saveInvestigation(
  facts: Facts,
  settings: Settings,
  view: CaseView,
  demo: boolean,
): CaseRecord {
  const id =
    "CASE-" +
    createHash("sha256")
      .update(
        JSON.stringify([
          facts.input.value,
          facts.customerId ?? "",
          facts.tx?.chain ?? "",
          demo,
        ]),
      )
      .digest("hex")
      .slice(0, 20);
  return atomic(() => {
    const old = getDocument<CaseRecord>("case", id);
    const at = new Date().toISOString();
    const record: CaseRecord = {
      id,
      createdAt: old?.createdAt ?? at,
      updatedAt: at,
      facts,
      settings,
      view: { ...view, id },
      provenance: demo ? "synthetic" : "analyst",
      revisions: [
        ...(old?.revisions ?? []),
        { at, facts, settings, view: { ...view, id } },
      ],
    };
    // Rechecks never inherit an old confirmation for changed evidence.
    putDocument("case", id, record);
    audit("investigation.recorded", id);
    return record;
  });
}
export function correctCase(
  id: string,
  actual: Code,
  reason: string,
  actor: string,
  adjudicated = false,
) {
  return atomic(() => {
    const record = getDocument<CaseRecord>("case", id);
    if (!record) throw Error("Case not found");
    record.feedback = {
      actual,
      reason,
      actor,
      at: new Date().toISOString(),
      adjudicated,
    };
    putDocument("case", id, record);
    putDocument("regression", randomUUID(), {
      caseId: id,
      facts: record.facts,
      settings: record.settings,
      predicted: record.view.verdicts.at(-1)?.code,
      expected: actual,
      label: record.feedback,
      provenance: record.provenance,
    });
    audit("verdict.corrected", id, actor);
    return record;
  });
}
