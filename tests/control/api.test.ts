import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed, signInWithMfa } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { POST as authPOST } from "../../src/app/api/auth/[...all]/route";
import { GET as paymentsGET } from "../../src/app/api/control/payments/route";
import { GET as paymentGET } from "../../src/app/api/control/payments/[id]/route";
import { GET as reportGET } from "../../src/app/api/control/payments/[id]/report/route";
import { GET as auditGET } from "../../src/app/api/control/audit/route";
import { GET as approvalsGET, POST as approvalsPOST } from "../../src/app/api/control/approvals/route";
import { POST as decisionPOST } from "../../src/app/api/control/approvals/[id]/decision/route";
import { POST as actionsPOST } from "../../src/app/api/control/actions/route";
import { PUT as casePUT } from "../../src/app/api/control/cases/[id]/route";
import { DELETE as orgDELETE, POST as orgPOST } from "../../src/app/api/control/org/route";
import { REDWOOD_REFERENCE } from "../../src/server/seed";

/**
 * The /api/control route handlers, called as Next calls them, against the real database: session cookie only,
 * `clearline_org` as a selection only, exact Origin and Idempotency-Key on every mutation, errors mapped.
 */
const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const BASE = `${ORIGIN}/api/control`;
let ids: Record<string, string>;
const cookies: Record<string, string> = {};
let ip = 40;

async function signIn(email: string) {
  // v1 1.2: password, then the authenticator code when the account has MFA (tests/control/harness.ts)
  return signInWithMfa(email, PASSWORD, `198.51.100.${ip++}`);
}

let k = 0;
const key = () => `api-test-${++k}-${Date.now()}`;
type Init = { method?: string; body?: unknown; cookie?: string; org?: string; origin?: string | null; idem?: string | null; headers?: Record<string, string> };
function req(path: string, i: Init = {}) {
  const h: Record<string, string> = { ...(i.headers ?? {}) };
  const c = [i.cookie, i.org ? `clearline_org=${i.org}` : ""].filter(Boolean).join("; ");
  if (c) h.cookie = c;
  const method = i.method ?? "GET";
  if (method !== "GET") {
    if (i.origin !== null) h.origin = i.origin ?? ORIGIN;
    if (i.idem !== null) h["idempotency-key"] = i.idem ?? key();
    h["content-type"] = "application/json";
  }
  return new Request(`${BASE}${path}`, { method, headers: h, body: i.body === undefined ? undefined : JSON.stringify(i.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const body = async (r: Response) => r.json() as Promise<Record<string, unknown> & { error?: { code: string; message: string } }>;

let redwood: string;
let exc: string;
let caseId: string;

beforeAll(async () => {
  ids = await resetAndSeed();
  for (const e of ["ops@lumen.example", "approver@lumen.example", "viewer@lumen.example", "ops@harbour.example"]) cookies[e] = await signIn(e);
  const r = await paymentsGET(req("/payments", { cookie: cookies["ops@lumen.example"] }));
  expect(r.status).toBe(200);
  redwood = ((await body(r)).payments as { id: string; reference: string }[]).find((p) => p.reference === REDWOOD_REFERENCE)!.id;
  const d = await body(await paymentGET(req(`/payments/${redwood}`, { cookie: cookies["ops@lumen.example"] }), params(redwood)));
  exc = (d.exceptions as { id: string; category: string }[]).find((e) => e.category === "returned_payout")!.id;
  caseId = (d.cases as { id: string }[])[0].id;
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("authentication and CSRF", () => {
  it("every endpoint answers 401 without a session", async () => {
    expect((await paymentsGET(req("/payments"))).status).toBe(401);
    expect((await paymentGET(req(`/payments/${redwood}`), params(redwood))).status).toBe(401);
    expect((await auditGET(req("/audit"))).status).toBe(401);
    expect((await approvalsGET(req("/approvals"))).status).toBe(401);
    expect((await reportGET(req(`/payments/${redwood}/report?format=json`), params(redwood))).status).toBe(401);
    expect((await actionsPOST(req("/actions", { method: "POST", body: { type: "add_note", target: { kind: "exception", id: exc }, text: "x" } }))).status).toBe(401);
    expect((await orgPOST(req("/org", { method: "POST", body: { slug: "lumen-demo" } }))).status).toBe(401);
  });

  it("a forged session cookie is not a session", async () => {
    expect((await paymentsGET(req("/payments", { cookie: "clearline.session_token=forged.value" }))).status).toBe(401);
  });

  it("a mutation from a foreign or missing Origin is refused with 403 before anything else, even when signed in", async () => {
    for (const origin of ["https://evil.example", null]) {
      const r = await actionsPOST(req("/actions", { method: "POST", cookie: cookies["ops@lumen.example"], origin, body: { type: "add_note", target: { kind: "exception", id: exc }, text: "csrf attempt" } }));
      expect(r.status).toBe(403);
      expect((await body(r)).error?.code).toBe("CSRF_ORIGIN");
    }
    expect((await orgPOST(req("/org", { method: "POST", origin: "https://evil.example", body: { slug: "lumen-demo" } }))).status).toBe(403);
    expect((await orgDELETE(req("/org", { method: "DELETE", origin: "https://evil.example" }))).status).toBe(403);
    const n = (await ownerDb().execute(sql`select count(*)::int as n from investigation_notes where body = 'csrf attempt'`)).rows[0].n;
    expect(n).toBe(0);
  });

  it("a mutation without an Idempotency-Key header, or with a malformed one, is refused", async () => {
    const a = await actionsPOST(req("/actions", { method: "POST", cookie: cookies["ops@lumen.example"], idem: null, body: { type: "add_note", target: { kind: "exception", id: exc }, text: "no key" } }));
    expect(a.status).toBe(400);
    expect((await body(a)).error?.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const b = await casePUT(req(`/cases/${caseId}`, { method: "PUT", cookie: cookies["ops@lumen.example"], idem: "bad key!", body: { priority: "high", nextAction: null, dueDate: null } }), params(caseId));
    expect((await body(b)).error?.code).toBe("IDEMPOTENCY_KEY_INVALID");
  });

  it("a body that is not JSON, or does not fit the schema, is a 400", async () => {
    const r = await actionsPOST(new Request(`${BASE}/actions`, { method: "POST", headers: { cookie: cookies["ops@lumen.example"], origin: ORIGIN, "idempotency-key": key(), "content-type": "application/json" }, body: "{not json" }));
    expect((await body(r)).error?.code).toBe("INVALID_JSON");
    const s = await actionsPOST(req("/actions", { method: "POST", cookie: cookies["ops@lumen.example"], body: { type: "resolve", target: { kind: "exception", id: exc }, note: "self-resolve" } }));
    expect(s.status).toBe(400);
    expect((await body(s)).error?.code).toBe("INVALID_REQUEST");
  });
});

describe("who acts is the session user, never the request", () => {
  it("a forged x-clearline-actor header and a body actorId / ownerId are ignored: the actor and owner are the session user", async () => {
    const forged = { "x-clearline-actor": ids["approver@lumen.example"], "x-clearline-org": "harbour-demo" };
    const note = `Forged-actor probe ${Date.now()} (fictional)`;
    const r = await actionsPOST(req("/actions", {
      method: "POST", cookie: cookies["ops@lumen.example"], headers: forged,
      body: { type: "add_note", target: { kind: "case", id: caseId }, text: note, actorId: ids["approver@lumen.example"], userId: ids["approver@lumen.example"], orgId: "harbour-demo" },
    }));
    expect(r.status).toBe(200);
    const row = (await ownerDb().execute(sql`select n.author_user_id, o.slug from investigation_notes n join organizations o on o.id = n.org_id where n.body = ${note}`)).rows;
    expect(row).toEqual([{ author_user_id: ids["ops@lumen.example"], slug: "lumen-demo" }]);
    const audit = (await ownerDb().execute(sql`select actor_user_id, details from audit_events where action = 'note.added' and summary = ${note.slice(0, 80)}`)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(ids["ops@lumen.example"]);
    expect((audit[0].details as { actorId: string }).actorId).toBe(ids["ops@lumen.example"]);

    const a = await actionsPOST(req("/actions", { method: "POST", cookie: cookies["ops@lumen.example"], headers: forged, body: { type: "assign_owner", target: { kind: "exception", id: exc }, ownerId: ids["approver@lumen.example"], actorId: ids["approver@lumen.example"] } }));
    expect(a.status).toBe(200);
    const d = await body(await paymentGET(req(`/payments/${redwood}`, { cookie: cookies["viewer@lumen.example"] }), params(redwood)));
    expect((d.exceptions as { id: string; ownerId?: string }[]).find((e) => e.id === exc)!.ownerId).toBe(ids["ops@lumen.example"]);
  });

  it("a forged actor header cannot lend a viewer authority", async () => {
    const r = await actionsPOST(req("/actions", { method: "POST", cookie: cookies["viewer@lumen.example"], headers: { "x-clearline-actor": ids["ops@lumen.example"] }, body: { type: "add_note", target: { kind: "case", id: caseId }, text: "viewer note", actorId: ids["ops@lumen.example"] } }));
    expect(r.status).toBe(403);
  });

  it("the strict service schemas refuse an actorId in the body rather than act on it", async () => {
    const r = await casePUT(req(`/cases/${caseId}`, { method: "PUT", cookie: cookies["ops@lumen.example"], body: { priority: "urgent", nextAction: null, dueDate: null, actorId: ids["approver@lumen.example"] } }), params(caseId));
    expect(r.status).toBe(400);
    const p = (await ownerDb().execute(sql`select priority from investigations where id = ${caseId} and org_id = (select id from organizations where slug = 'lumen-demo')`)).rows[0].priority;
    expect(p).toBe("normal");
  });
});

describe("tenancy: the org cookie is a selection among the user's own memberships", () => {
  it("POST /org sets the cookie for one of the user's organisations and 404s (no cookie) for another", async () => {
    const ok = await orgPOST(req("/org", { method: "POST", cookie: cookies["ops@lumen.example"], body: { slug: "lumen-demo" } }));
    expect(ok.status).toBe(200);
    const set = ok.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^clearline_org=lumen-demo;/);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    const no = await orgPOST(req("/org", { method: "POST", cookie: cookies["ops@harbour.example"], body: { slug: "lumen-demo" } }));
    expect(no.status).toBe(404);
    expect(no.headers.get("set-cookie")).toBeNull();
  });

  it("a forged clearline_org cookie naming another organisation is a 404 for reads and writes", async () => {
    const c = cookies["ops@harbour.example"];
    expect((await paymentsGET(req("/payments", { cookie: c, org: "lumen-demo" }))).status).toBe(404);
    expect((await paymentGET(req(`/payments/${redwood}`, { cookie: c, org: "lumen-demo" }), params(redwood))).status).toBe(404);
    expect((await reportGET(req(`/payments/${redwood}/report?format=json`, { cookie: c, org: "lumen-demo" }), params(redwood))).status).toBe(404);
    expect((await actionsPOST(req("/actions", { method: "POST", cookie: c, org: "lumen-demo", body: { type: "add_note", target: { kind: "case", id: caseId }, text: "cross-tenant note" } }))).status).toBe(404);
    const n = (await ownerDb().execute(sql`select count(*)::int as n from investigation_notes where body = 'cross-tenant note'`)).rows[0].n;
    expect(n).toBe(0);
  });

  it("the same record id in the user's own organisation shows only that organisation's data", async () => {
    const d = await body(await paymentGET(req(`/payments/${redwood}`, { cookie: cookies["ops@harbour.example"] }), params(redwood)));
    expect(JSON.stringify(d)).not.toContain("Forged-actor probe");
  });
});

describe("the maker-checker flow over HTTP", () => {
  let request: { id: string; payloadSha256: string };
  let evidenceRefs: string[];

  it("ops sets case details, attaches the confirmation and requests a resolution with evidence", async () => {
    const c = cookies["ops@lumen.example"];
    expect((await casePUT(req(`/cases/${caseId}`, { method: "PUT", cookie: c, body: { priority: "high", nextAction: "Confirm return with Northline (fictional)", dueDate: "2026-12-01" } }), params(caseId))).status).toBe(200);
    expect((await actionsPOST(req("/actions", { method: "POST", cookie: c, body: { type: "attach_evidence", target: { kind: "exception", id: exc }, evidence: { kind: "funds_returned_confirmation", description: "Northline confirms the funds returned (fictional)", reference: "NL-RET-API-1" } } }))).status).toBe(200);
    const d = await body(await paymentGET(req(`/payments/${redwood}`, { cookie: c }), params(redwood)));
    const refs = (d.exceptions as { id: string; supportingEvidenceIds: string[] }[]).find((e) => e.id === exc)!.supportingEvidenceIds;
    const confirmation = (d.evidence as { id: string; kind: string; reference?: string }[]).find((e) => e.reference === "NL-RET-API-1")!;
    expect(confirmation.kind).toBe("funds_returned_confirmation");
    expect(refs).toContain(confirmation.id);
    evidenceRefs = [...refs].sort();
    const r = await approvalsPOST(req("/approvals", { method: "POST", cookie: c, body: { target: { kind: "exception", id: exc }, note: "Funds returned; supplier still unpaid (fictional).", evidenceRefs: refs } }));
    expect(r.status).toBe(201);
    request = (await body(r)) as unknown as typeof request;
    expect(request.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("replaying the same Idempotency-Key returns the stored answer; reusing it for another request is a 409", async () => {
    const c = cookies["ops@lumen.example"];
    const kk = key();
    const one = await actionsPOST(req("/actions", { method: "POST", cookie: c, idem: kk, body: { type: "add_note", target: { kind: "case", id: caseId }, text: "Replay probe (fictional)" } }));
    const two = await actionsPOST(req("/actions", { method: "POST", cookie: c, idem: kk, body: { type: "add_note", target: { kind: "case", id: caseId }, text: "Replay probe (fictional)" } }));
    expect(one.status).toBe(200);
    expect((await body(two)).replayed).toBe(true);
    const three = await actionsPOST(req("/actions", { method: "POST", cookie: c, idem: kk, body: { type: "add_note", target: { kind: "case", id: caseId }, text: "Different text" } }));
    expect(three.status).toBe(409);
  });

  it("ops cannot decide (403); the approver decides with the hash they saw; a stale hash is refused", async () => {
    const asOps = await decisionPOST(req(`/approvals/${request.id}/decision`, { method: "POST", cookie: cookies["ops@lumen.example"], body: { decision: "approve", reason: "self approval", payloadSha256: request.payloadSha256 } }), params(request.id));
    expect(asOps.status).toBe(403);
    const stale = await decisionPOST(req(`/approvals/${request.id}/decision`, { method: "POST", cookie: cookies["approver@lumen.example"], body: { decision: "approve", reason: "stale view", payloadSha256: "f".repeat(64) } }), params(request.id));
    expect(stale.status).toBe(409);
    expect((await body(stale)).error?.code).toBe("VERSION_MISMATCH");
    const ok = await decisionPOST(req(`/approvals/${request.id}/decision`, { method: "POST", cookie: cookies["approver@lumen.example"], body: { decision: "approve", reason: "Debit, return credit and confirmation checked", payloadSha256: request.payloadSha256 } }), params(request.id));
    expect(ok.status).toBe(200);
    const approvals = (await body(await approvalsGET(req("/approvals", { cookie: cookies["viewer@lumen.example"] })))).approvals as { id: string; status: string }[];
    expect(approvals.find((a) => a.id === request.id)!.status).toBe("approved");
  });

  it("the report downloads as an attachment with the approval and the evidence references; the audit lists it", async () => {
    const r = await reportGET(req(`/payments/${redwood}/report?format=json`, { cookie: cookies["approver@lumen.example"] }), params(redwood));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="clearline-report-lumen-demo-/);
    const rep = await r.json();
    const approved = rep.approvals.find((a: { status: string }) => a.status === "approved");
    expect(approved.payload.evidenceRefs).toEqual(evidenceRefs);
    expect(approved.decisions[0]).toMatchObject({ decision: "approve", decidedBy: ids["approver@lumen.example"] });
    const timelineRefs = (rep.timeline as { refs: string[] }[]).flatMap((e) => e.refs);
    for (const ref of evidenceRefs) expect(JSON.stringify(rep.findings) + timelineRefs.join(",")).toContain(ref);
    const csv = await reportGET(req(`/payments/${redwood}/report?format=csv`, { cookie: cookies["viewer@lumen.example"] }), params(redwood));
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv/);
    expect((await reportGET(req(`/payments/${redwood}/report?format=xml`, { cookie: cookies["viewer@lumen.example"] }), params(redwood))).status).toBe(400);
    const events = (await body(await auditGET(req("/audit?limit=50", { cookie: cookies["viewer@lumen.example"] })))).events as { action: string }[];
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["investigation_report_exported", "resolution_approved", "resolution_requested"]));
  });

  it("DELETE /org clears the selection", async () => {
    const r = await orgDELETE(req("/org", { method: "DELETE" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/^clearline_org=; .*Max-Age=0/);
  });
});
