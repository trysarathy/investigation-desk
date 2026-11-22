/**
 * Regression tests for the rc5 security review (code-reviewer, launched by the implementing session; not independent).
 * Each test names the finding it covers. Not every test was re-run against the pre-fix code (not mutation-verified).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { closeOwner, ownerDb, principal, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, checkRuntimeRole, resolveTenant, withTenant } from "../../src/server/tenant";
import { listPayments, paymentDetail, decideApproval, requestResolution, runAction, RequestRefused } from "../../src/server/control";
import { importStatementCsv, parseStatementCsv, STATEMENT_COLUMNS, stagedImport, decideStatementImport, type ImportAccepted } from "../../src/server/imports";
import { REDWOOD_REFERENCE } from "../../src/server/seed";

let ids: Record<string, string>;
const ctx = (email: string, org = email.endsWith("harbour.example") ? "harbour-demo" : "lumen-demo") => resolveTenant(principal(ids, email), org);
let k = 0;
const key = () => `hard-key-${++k}-${Date.now()}`;
const runtime = () => new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL, max: 1 });
async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return; }
    expect(`${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ""}`).toMatch(code);
    return;
  }
  throw new Error(`expected refusal ${code}`);
}

let redwood: string; let exc: string;
beforeAll(async () => {
  ids = await resetAndSeed();
  const ops = await ctx("ops@lumen.example");
  redwood = (await listPayments(ops)).find((p) => p.reference === REDWOOD_REFERENCE)!.id;
  exc = (await paymentDetail(ops, redwood)).exceptions.find((e) => e.category === "returned_payout")!.id;
  await runAction(ops, { type: "assign_owner", target: { kind: "exception", id: exc }, ownerId: ops.userId }, key());
  await runAction(ops, { type: "attach_evidence", target: { kind: "exception", id: exc }, evidence: { kind: "funds_returned_confirmation", description: "Funds returned (fictional)", reference: "NL-RET-H" } }, key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("M1: an approval binds evidence that concerns the target, and its content", () => {
  it("evidence of ANOTHER payment cannot be cited", async () => {
    const ops = await ctx("ops@lumen.example");
    const other = (await withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`select line_id from reconciliation_records where intent_id <> ${redwood} and intent_id is not null limit 1`))).rows[0].line_id as string;
    await refused(requestResolution(ops, { target: { kind: "exception", id: exc }, note: "Citing another payment's line", evidenceRefs: [other] }, key()), "EVIDENCE_NOT_FOR_TARGET");
  });

  it("if cited evidence or the target changes after the request, the approval is refused", async () => {
    const ops = await ctx("ops@lumen.example");
    const ev = (await paymentDetail(ops, redwood)).exceptions.find((e) => e.id === exc)!.supportingEvidenceIds;
    const req = await requestResolution(ops, { target: { kind: "exception", id: exc }, note: "Funds returned; supplier unpaid (fictional)", evidenceRefs: ev }, key());
    expect((req.body.payload as { evidence: unknown[] }).evidence).toHaveLength(ev.length);
    // the target changes after the request (a new note) → the approver's decision is refused
    await runAction(ops, { type: "add_note", target: { kind: "exception", id: exc }, text: "Changed after the request" }, key());
    await refused(decideApproval(await ctx("approver@lumen.example"), req.body.id, { decision: "approve", reason: "approve stale", payloadSha256: req.body.payloadSha256 }, key()), "EVIDENCE_CHANGED");
  });
});

describe("M2: the database binds the acting person and the status change", () => {
  it("a request cannot be set approved without a matching decision, even as the runtime role", async () => {
    const ops = await ctx("ops@lumen.example");
    const ev = (await paymentDetail(ops, redwood)).exceptions.find((e) => e.id === exc)!.supportingEvidenceIds;
    const req = await requestResolution(ops, { target: { kind: "exception", id: exc }, note: "Version for the trigger test (fictional)", evidenceRefs: ev }, key());
    await refused(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`update approval_requests set status = 'approved' where id = ${req.body.id}`)), /matching decision/);
    // a decision recorded for someone other than the signed-in user is refused
    const appr = await ctx("approver@lumen.example");
    await refused(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256) values (${ops.orgId}, ${req.body.id}, ${appr.userId}, 'approve', 'forged', ${req.body.payloadSha256})`)), /signed-in user/);
    // and a request cannot be created already approved
    await refused(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`insert into approval_requests (org_id, subject_kind, subject_id, version, payload, payload_sha256, requested_by, status) values (${ops.orgId}, 'investigation_resolution', 'exception:x', 1, '{}', ${"0".repeat(64)}, ${ops.userId}, 'approved')`)), /created pending/);
  });
});

describe("M3: SECURITY DEFINER functions cannot be fooled with a temporary table", () => {
  it("the runtime role cannot create temporary tables", async () => {
    const pool = runtime();
    await expect(pool.query("create temp table organization_memberships (org_id uuid, user_id text, role text, revoked_at timestamptz)")).rejects.toThrow(/permission denied/);
    await pool.end();
  });
});

describe("M4: least privilege for the runtime role", () => {
  it("cannot create provider events or payments, cannot rewrite stored responses, cannot change a payment's amount", async () => {
    const ops = await ctx("ops@lumen.example");
    const run = (q: ReturnType<typeof sql>) => withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(q));
    await refused(run(sql`insert into provider_events (org_id, id, ord, event_type, record) values (${ops.orgId}, 'pev_forged', 9999, 'payout.completed', '{}')`), /permission denied/);
    await refused(run(sql`insert into payment_intents (org_id, id, ord, internal_reference, beneficiary_name, amount_minor, currency, execution, settlement, reconciliation, record) values (${ops.orgId}, 'pi_forged', 9999, 'X', 'Y', 1, 'USD', 'draft', 'none', 'unmatched', '{}')`), /permission denied/);
    await refused(run(sql`update idempotency_records set response = '{}'`), /permission denied/);
    await refused(run(sql`update payment_intents set amount_minor = amount_minor + 1 where id = ${redwood}`), /immutable/);
    await refused(run(sql`update payment_intents set record = jsonb_set(record, '{amountMinor}', '1') where id = ${redwood}`), /immutable/);
  });
});

describe("M5 / L7: CSV parsing stays bounded and refuses spoofing characters", () => {
  const HEADER = STATEMENT_COLUMNS.join(",");
  const ROW = "SIMBANK-H-1,SIMBANK-USD-OPS (fictional),2026-11-20,credit,payment,10.00,USD,REF H1,Counterparty (fictional)";
  it("a file of blank lines yields a bounded note list", () => {
    const r = parseStatementCsv(new TextEncoder().encode(`${HEADER}\n${ROW}\n${"\n".repeat(200_000)}`));
    expect(r.ok).toBe(true); // the row itself is valid: only the blank lines are noted
    expect(r.notes.length).toBeLessThanOrEqual(21);
    expect(r.notes.at(-1)).toMatch(/more blank line/);
  });
  it("bidirectional control characters in text are refused (the same row without them is accepted)", () => {
    expect(parseStatementCsv(new TextEncoder().encode(`${HEADER}\n${ROW}\n`)).ok).toBe(true);
    const r = parseStatementCsv(new TextEncoder().encode(`${HEADER}\n${ROW.replace("REF H1", "REF ‮H1")}\n`));
    expect(r.ok).toBe(false);
  });
});

describe("H2 (mitigation): the approver reviews the staged lines and confirms exactly those", () => {
  it("the staged lines are readable before confirmation, and a decision must state their hash", async () => {
    const fin = await ctx("finance@lumen.example");
    const csv = new TextEncoder().encode(`${STATEMENT_COLUMNS.join(",")}\nSIMBANK-H-2,SIMBANK-USD-OPS (fictional),2026-11-20,credit,payment,10.00,USD,REF H2,Counterparty (fictional)\n`);
    const up = (await importStatementCsv(fin, { fileName: "h2.csv", bytes: csv }, key())).body as ImportAccepted;
    const appr = await ctx("approver@lumen.example");
    const staged = await stagedImport(appr, up.importId);
    expect(staged.lines.map((l) => l.line.lineId)).toEqual(["SIMBANK-H-2"]);
    expect(staged.linesSha256).toBe(up.linesSha256);
    await refused(decideStatementImport(appr, up.importId, { decision: "confirm", reason: "wrong lines hash", fileSha256: up.fileSha256, linesSha256: "b".repeat(64) }, key()), "VERSION_MISMATCH");
    const ok = await decideStatementImport(appr, up.importId, { decision: "confirm", reason: "Reviewed the staged lines (fictional)", fileSha256: up.fileSha256, linesSha256: staged.linesSha256! }, key());
    expect(ok.body).toMatchObject({ status: "imported", acceptedCount: 1 });
  });
});

describe("M8 / L6: runtime role guard and the pooled-connection check on ONE connection", () => {
  it("refuses a connection whose role can bypass RLS (the owner), accepts the runtime login", async () => {
    await expect(checkRuntimeRole(ownerDb())).rejects.toThrow(/bypass row-level security/);
    const pool = runtime();
    await expect(checkRuntimeRole({ execute: async () => ({ rows: (await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user")).rows }) } as never)).resolves.toBeUndefined();
    await pool.end();
    void sql;
  });
  it("a transaction-local tenant setting is gone on the SAME connection after commit", async () => {
    const pool = runtime(); const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.org_id', '00000000-0000-4000-8000-000000000001', true), set_config('app.user_id', 'someone', true)");
      await c.query("commit");
      const r = await c.query("select current_setting('app.org_id', true) as o, current_setting('app.user_id', true) as u");
      expect(r.rows[0]).toEqual({ o: "", u: "" });
    } finally { c.release(); await pool.end(); }
  });
});
