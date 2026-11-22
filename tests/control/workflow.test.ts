import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { closeOwner, ownerDb, principal, resetAndSeed } from "./harness";
import { closeDatabase, database } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { revokeMembership } from "../../src/server/admin";
import {
  auditHistory, decideApproval, investigationReport, listPayments, overview, paymentDetail, RequestRefused, requestResolution,
  runAction, updateCaseDetails,
} from "../../src/server/control";
import { REDWOOD_REFERENCE } from "../../src/server/seed";

let ids: Record<string, string>;
const ctx = (email: string, org = email.endsWith("harbour.example") ? "harbour-demo" : "lumen-demo") => resolveTenant(principal(ids, email), org);
let k = 0;
const key = () => `test-key-${++k}-${Date.now()}`;

async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return e; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return e; }
    const m = `${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ""}`;
    expect(m).toMatch(code);
    return e;
  }
  throw new Error(`expected refusal ${code}`);
}

let redwood: string; // intent id
let exc: string;     // returned_payout exception id
let caseId: string;

beforeAll(async () => {
  ids = await resetAndSeed();
  const ops = await ctx("ops@lumen.example");
  const pays = await listPayments(ops);
  redwood = pays.find((p) => p.reference === REDWOOD_REFERENCE)!.id;
  const d = await paymentDetail(ops, redwood);
  exc = d.exceptions.find((e) => e.category === "returned_payout")!.id;
  caseId = (d.cases[0] as { id?: string } | undefined)?.id ?? "";
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("Redwood Supplies acceptance case (persisted, server-side)", () => {
  it("shows execution returned after a reported completion, net 0.00 on the statement, supplier unpaid", async () => {
    const d = await paymentDetail(await ctx("viewer@lumen.example"), redwood);
    expect(d.view.status.execution).toBe("returned");
    expect(d.view.status.settlement).not.toBe("verified");
    expect(d.view.returnPosition).toMatchObject({
      debited: { amountMinor: 1_278_490, currency: "USD" },
      returnCredited: { amountMinor: 1_278_490, currency: "USD" },
      netMovement: { amountMinor: 0, currency: "USD" },
      netMovementZero: true,
      beneficiaryPaid: false,
      code: "RT_NET_ZERO",
    });
    const intent = (await withTenant({ userId: ids["viewer@lumen.example"], orgId: (await ctx("viewer@lumen.example")).orgId }, (tx) =>
      tx.execute(sql`select record from provider_events where intent_id = ${redwood} order by ord`))).rows.map((r) => (r.record as { normalizedType: string }).normalizedType);
    expect(intent).toEqual(["payout.accepted", "payout.in_transit", "payout.completed", "payout.returned"]);
  });
});

describe("tenant isolation (org A vs org B; the seeds share record ids on purpose)", () => {
  it("a user cannot select another organisation, even by its slug", async () => {
    await refused(resolveTenant(principal(ids, "ops@lumen.example"), "harbour-demo"), "ACCESS_404");
  });

  it("RLS hides org B's rows from org A's user even with org B's id forced into the context", async () => {
    const b = await ctx("ops@harbour.example");
    const n = await withTenant({ userId: ids["ops@lumen.example"], orgId: b.orgId }, async (tx) =>
      (await tx.execute(sql`select count(*)::int as n from payment_intents`)).rows[0].n);
    expect(n).toBe(0);
  });

  it("a write in org B is invisible to org A, and org A cannot read, export or approve org B's records", async () => {
    const opsB = await ctx("ops@harbour.example");
    await runAction(opsB, { type: "add_note", target: { kind: "exception", id: exc }, text: "Harbour-only note (fictional)" }, key());
    const opsA = await ctx("ops@lumen.example");
    const notesA = await withTenant({ userId: opsA.userId, orgId: opsA.orgId }, async (tx) => (await tx.execute(sql`select body from investigation_notes`)).rows);
    expect(notesA.map((r) => r.body)).not.toContain("Harbour-only note (fictional)");
    // org B prepares an approval request; org A's approver can neither see nor decide it
    await runAction(opsB, { type: "assign_owner", target: { kind: "exception", id: exc }, ownerId: opsB.userId }, key());
    await runAction(opsB, { type: "attach_evidence", target: { kind: "exception", id: exc }, evidence: { kind: "funds_returned_confirmation", description: "Provider confirms funds returned (fictional)", reference: "NL-RET-B" } }, key());
    const evB = (await paymentDetail(opsB, redwood)).exceptions.find((e) => e.id === exc)!.supportingEvidenceIds[0];
    const reqB = await requestResolution(opsB, { target: { kind: "exception", id: exc }, note: "Funds returned; supplier still unpaid (fictional)", evidenceRefs: [evB] }, key());
    const apprA = await ctx("approver@lumen.example");
    await refused(decideApproval(apprA, reqB.body.id, { decision: "approve", reason: "cross-tenant attempt", payloadSha256: reqB.body.payloadSha256 }, key()), "ACCESS_404");
    // org A's export is computed from org A's rows only
    const repA = JSON.parse((await investigationReport(opsA, redwood, "json")).body);
    expect(JSON.stringify(repA)).not.toContain("Harbour-only note");
    expect(repA.organisation).toBe("Lumen (fictional)");
  });

  it("the tenant context never leaks into the next transaction on a pooled connection", async () => {
    const a = await ctx("ops@lumen.example");
    await withTenant({ userId: a.userId, orgId: a.orgId }, async () => undefined);
    const r = await database().execute(sql`select current_setting('app.org_id', true) as o, current_setting('app.user_id', true) as u`);
    expect(r.rows[0].o ?? "").toBe("");
    expect(r.rows[0].u ?? "").toBe("");
  });
});

describe("role-based authorisation on the server", () => {
  it("a viewer and an admin cannot change anything; an approver cannot investigate", async () => {
    for (const who of ["viewer@lumen.example", "admin@lumen.example", "approver@lumen.example", "finance@lumen.example"]) {
      await refused(runAction(await ctx(who), { type: "add_note", target: { kind: "exception", id: exc }, text: "not allowed" }, key()), "ACCESS_403");
    }
  });
  it("only payment operations may request approval; only an approver may decide", async () => {
    await refused(requestResolution(await ctx("viewer@lumen.example"), { target: { kind: "exception", id: exc }, note: "viewer attempt to resolve", evidenceRefs: ["x"] }, key()), "ACCESS_403");
    await refused(decideApproval(await ctx("ops@lumen.example"), "00000000-0000-4000-8000-000000000000", { decision: "approve", reason: "ops attempt", payloadSha256: "0".repeat(64) }, key()), "ACCESS_403");
  });
  it("payment execution, simulation, clock and direct resolution are not available at all", async () => {
    const ops = await ctx("ops@lumen.example");
    for (const action of [{ type: "simulate_provider_event", intentId: redwood }, { type: "advance_clock", to: "2030-01-01T00:00:00Z" }, { type: "resolve", target: { kind: "exception", id: exc }, note: "self-resolve" }, { type: "submit_instruction", instructionId: "x" }]) {
      await refused(runAction(ops, action as never, key()), "ACTION_NOT_AVAILABLE");
    }
  });
});

describe("investigation workflow + server-enforced maker-checker", () => {
  let req: { id: string; payloadSha256: string; version: number };

  it("payment operations assigns the owner, sets priority / next action / due date and records a note", async () => {
    const ops = await ctx("ops@lumen.example");
    await runAction(ops, { type: "assign_owner", target: { kind: "exception", id: exc }, ownerId: ops.userId }, key());
    expect(caseId, "the Redwood return opens an investigation case").toMatch(/^case_/);
    await updateCaseDetails(ops, caseId, { priority: "high", nextAction: "Confirm return with Northline (fictional)", dueDate: "2026-12-01" });
    await runAction(ops, { type: "add_note", target: { kind: "exception", id: exc }, text: "Statement shows debit and return credit; supplier unpaid (fictional)." }, key());
    const d = await paymentDetail(ops, redwood);
    expect(d.exceptions.find((e) => e.id === exc)!.ownerId).toBe(ops.userId);
    expect(d.cases[0]).toMatchObject({ priority: "high", nextAction: "Confirm return with Northline (fictional)", dueDate: "2026-12-01" });
  });

  it("a resolution cannot be requested without real evidence of this organisation", async () => {
    const ops = await ctx("ops@lumen.example");
    await refused(requestResolution(ops, { target: { kind: "exception", id: exc }, note: "Resolve without evidence", evidenceRefs: ["stl_does_not_exist"] }, key()), "EVIDENCE_NOT_FOUND");
    // real statement lines of this payment exist, but the engine still refuses: a returned payout needs a
    // funds-returned confirmation (or a correction) before it can be resolved
    const lineIds = (await withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`select line_id from reconciliation_records where intent_id = ${redwood}`))).rows.map((r) => String(r.line_id));
    expect(lineIds).toHaveLength(2);
    await refused(requestResolution(ops, { target: { kind: "exception", id: exc }, note: "Resolve before the confirmation exists", evidenceRefs: lineIds }, key()), "RETURN_NOT_ADDRESSED");
  });

  it("with the confirmation attached, payment operations requests approval of an immutable, hashed version", async () => {
    const ops = await ctx("ops@lumen.example");
    await runAction(ops, { type: "attach_evidence", target: { kind: "exception", id: exc }, evidence: { kind: "funds_returned_confirmation", description: "Northline confirms USD 12,784.90 returned: account invalid (fictional)", reference: "NL-RET-0188" } }, key());
    const ev = (await paymentDetail(ops, redwood)).exceptions.find((e) => e.id === exc)!.supportingEvidenceIds;
    const v1 = await requestResolution(ops, { target: { kind: "exception", id: exc }, note: "Funds returned to our account; supplier still unpaid — re-pay after new details.", evidenceRefs: ev }, key());
    expect(v1.status).toBe(201);
    expect(v1.body.version).toBe(1);
    // an edit creates v2 and supersedes v1: an approval of v1 is then impossible
    const v2 = await requestResolution(ops, { target: { kind: "exception", id: exc }, note: "Funds returned (confirmation NL-RET-0188); supplier still unpaid; new bank details requested.", evidenceRefs: ev }, key());
    expect(v2.body.version).toBe(2);
    await refused(decideApproval(await ctx("approver@lumen.example"), v1.body.id, { decision: "approve", reason: "approving the old version", payloadSha256: v1.body.payloadSha256 }, key()), "REQUEST_CLOSED");
    req = v2.body as typeof req;
  });

  it("the preparer cannot approve; a wrong hash is refused; the database refuses a direct self-approval too", async () => {
    const ops = await ctx("ops@lumen.example");
    await refused(decideApproval(ops, req.id, { decision: "approve", reason: "self approval", payloadSha256: req.payloadSha256 }, key()), "ACCESS_403");
    const appr = await ctx("approver@lumen.example");
    await refused(decideApproval(appr, req.id, { decision: "approve", reason: "stale view", payloadSha256: "f".repeat(64) }, key()), "VERSION_MISMATCH");
    // bypass the service: insert a decision by the requester directly as the runtime role → trigger refuses
    await refused(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256) values (${ops.orgId}, ${req.id}, ${ops.userId}, 'approve', 'bypass', ${req.payloadSha256})`)), /maker-checker/);
  });

  it("two approvers racing: exactly one decision is recorded", async () => {
    const a1 = await ctx("approver@lumen.example");
    const a2 = await ctx("approver2@lumen.example");
    const results = await Promise.allSettled([
      decideApproval(a1, req.id, { decision: "approve", reason: "Evidence checked: debit, return credit, confirmation", payloadSha256: req.payloadSha256 }, key()),
      decideApproval(a2, req.id, { decision: "approve", reason: "Evidence checked as well", payloadSha256: req.payloadSha256 }, key()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const n = await withTenant({ userId: a1.userId, orgId: a1.orgId }, async (tx) => (await tx.execute(sql`select count(*)::int as n from approval_decisions where request_id = ${req.id}`)).rows[0].n);
    expect(n).toBe(1);
  });

  it("the approved resolution is recorded with its evidence, the supplier is STILL unpaid, and the audit trail names both people", async () => {
    const v = await ctx("viewer@lumen.example");
    const d = await paymentDetail(v, redwood);
    const e = d.exceptions.find((x) => x.id === exc)!;
    expect(e.status).toBe("resolved");
    expect(d.view.returnPosition?.beneficiaryPaid).toBe(false);
    expect(d.view.status.settlement).not.toBe("verified");
    const audit = await auditHistory(v);
    const kinds = audit.map((a) => a.action);
    expect(kinds).toEqual(expect.arrayContaining(["resolution_requested", "resolution_approved"]));
    const approved = audit.find((a) => a.action === "resolution_approved")!;
    const requested = audit.find((a) => a.action === "resolution_requested" && (a.details as { requestId: string }).requestId === req.id)!;
    expect(approved.actorUserId).not.toBe(requested.actorUserId);
  });

  it("the evidence-backed export names the evidence, the approval and both people", async () => {
    const r = await investigationReport(await ctx("viewer@lumen.example"), redwood, "json");
    const rep = JSON.parse(r.body);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rep.approvals.some((a: { status: string; decisions: { decision: string }[] }) => a.status === "approved" && a.decisions[0].decision === "approve")).toBe(true);
    expect(JSON.stringify(rep)).toContain("NL-RET-0188");
    const csv = (await investigationReport(await ctx("viewer@lumen.example"), redwood, "csv")).body;
    expect(csv.split("\n").some((l) => /^[=+\-@\t]/.test(l.split(",")[0] ?? ""))).toBe(false);
  });
});

describe("idempotency, revocation and durability", () => {
  it("the same key replays; the same key with a different request is refused", async () => {
    const ops = await ctx("ops@lumen.example");
    const kk = key();
    const a = await runAction(ops, { type: "add_note", target: { kind: "exception", id: exc }, text: "Idempotent note (fictional)" }, kk);
    const b = await runAction(ops, { type: "add_note", target: { kind: "exception", id: exc }, text: "Idempotent note (fictional)" }, kk);
    expect(b.replayed).toBe(true);
    expect(b.body).toEqual(a.body);
    await refused(runAction(ops, { type: "add_note", target: { kind: "exception", id: exc }, text: "Different" }, kk), "IDEMPOTENCY_KEY_REUSED");
    const notes = await withTenant({ userId: ops.userId, orgId: ops.orgId }, async (tx) => (await tx.execute(sql`select count(*)::int as n from investigation_notes where body = 'Idempotent note (fictional)'`)).rows[0].n);
    expect(notes).toBe(1);
  });

  it("a revoked approver loses authority immediately", async () => {
    const ops = await ctx("ops@lumen.example");
    const c = (await paymentDetail(ops, redwood)).cases[0] as { id?: string; status?: string } | undefined;
    await revokeMembership(ownerDb(), { orgSlug: "lumen-demo", email: "approver2@lumen.example" });
    await refused(ctx("approver2@lumen.example"), "ACCESS_403");
    expect(c?.id).toMatch(/^case_/);
    await runAction(ops, { type: "assign_owner", target: { kind: "case", id: c!.id! }, ownerId: ops.userId }, key());
    const req = await requestResolution(ops, { target: { kind: "case", id: c!.id! }, note: "Case: return handled, supplier to be re-paid", evidenceRefs: (await paymentDetail(ops, redwood)).exceptions.find((e) => e.id === exc)!.supportingEvidenceIds }, key());
    // even a direct insert by the revoked user is refused by the database (RLS: no longer a member)
    await refused(withTenant({ userId: ids["approver2@lumen.example"], orgId: ops.orgId }, (tx) => tx.execute(sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256) values (${ops.orgId}, ${req.body.id}, ${ids["approver2@lumen.example"]}, 'approve', 'revoked', ${req.body.payloadSha256})`)), /row-level security|maker-checker|not an active approver/);
  });

  it("a context resolved before revocation is refused with 404, not a server error", async () => {
    const stale = await ctx("approver@lumen.example");
    await revokeMembership(ownerDb(), { orgSlug: "lumen-demo", email: "approver@lumen.example" });
    await refused(listPayments(stale), "ACCESS_404");
  });

  it("everything survives closing every database connection (server restart equivalent)", async () => {
    const before = await overview(await ctx("viewer@lumen.example"));
    await closeDatabase();
    const fresh = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL }); await fresh.end(); // new pool works
    const after = await overview(await ctx("viewer@lumen.example"));
    expect(after).toEqual(before);
    const d = await paymentDetail(await ctx("viewer@lumen.example"), redwood);
    expect(d.exceptions.find((x) => x.id === exc)!.status).toBe("resolved");
  });
});

void (null as unknown as TenantContext);
