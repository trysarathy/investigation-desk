/**
 * Clearline engine test-mode API (v1). SANDBOX ONLY: fictional data, no provider calls, no money
 * movement, nothing persisted server-side. Every request is stateless: send the `workspace` you
 * hold (from a previous response or the console's browser storage) or omit it to use the sample.
 * See docs/clearline/openapi.yaml.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  applyAction,
  computeLiquidity,
  ENGINE_DISCLAIMER,
  fundingProjection,
  getAdapter,
  investigate,
  listExceptions,
  parseWorkspaceValue,
  sampleWorkspace,
  sandboxWebhookSecret,
  verifySandboxWebhook,
  type EngineErrorCode,
  type Workspace,
  type WorkspaceAction,
} from "@/lib/clearline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-Clearline-Mode": "synthetic-test-only" };
/** QA M3: request bodies are capped in BYTES (checked from Content-Length first, then the body). */
const MAX_BODY_BYTES = 512 * 1024;
/** QA M3: per-collection item caps for caller-supplied workspaces (audit is append-only, so larger). */
const MAX_ITEMS = 1000;
const MAX_AUDIT_ITEMS = 10_000;

const STATUS: Partial<Record<EngineErrorCode | "unauthenticated" | "unknown_endpoint" | "invalid_json", number>> = {
  unauthenticated: 401,
  webhook_signature_invalid: 401,
  unauthorized_actor: 403,
  maker_checker_violation: 403,
  not_found: 404,
  unknown_endpoint: 404,
  idempotency_conflict: 409,
  duplicate_statement_line: 409,
  invalid_transition: 409,
  resolution_not_permitted: 409,
  hold_requires_human_decision: 409,
  quote_expired: 409,
};

const respond = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: HEADERS });
const fail = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  respond({ error: { code, message, help: "Test mode only. Use fictional data. See /clearline/docs and docs/clearline/openapi.yaml.", ...extra } }, STATUS[code as EngineErrorCode] ?? 422);

const authed = (req: NextRequest) => req.headers.get("authorization") === "Bearer cl_test_demo";

async function readBody(req: NextRequest): Promise<Record<string, unknown> | Response> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return fail("invalid_json", "Content-Type: application/json required.");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail("invalid_json", "Request body exceeds 512 KB.");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail("invalid_json", "Request body exceeds 512 KB.");
  try {
    const v: unknown = text ? JSON.parse(text) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail("invalid_json", "JSON object required.");
    return v as Record<string, unknown>;
  } catch {
    return fail("invalid_json", "Body is not valid JSON.");
  }
}

function workspaceFrom(body: Record<string, unknown>): Workspace | Response {
  if (body.workspace === undefined) return sampleWorkspace();
  const w = body.workspace as Record<string, unknown> | null;
  if (w && typeof w === "object" && !Array.isArray(w))
    for (const [k, v] of Object.entries(w))
      if (Array.isArray(v) && v.length > (k === "audit" ? MAX_AUDIT_ITEMS : MAX_ITEMS))
        return respond({ error: { code: "invalid_field", field: `workspace.${k}`, message: `workspace.${k} has more than ${k === "audit" ? MAX_AUDIT_ITEMS : MAX_ITEMS} items.`, help: "Test mode only." } }, 400);
  // Depth-checked, structure-validated, no re-serialisation (QA L3/L4).
  const parsed = parseWorkspaceValue(body.workspace);
  return parsed.ok ? parsed.value : fail(parsed.error.code, parsed.error.message, { field: parsed.error.field ?? "workspace" });
}

/** M8: an `at` that is not an ISO-8601 instant is a 400, never silently replaced or treated as fresh. */
const isInstant = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));
const badAt = () => respond({ error: { code: "invalid_field", field: "at", message: "at must be an ISO-8601 instant, e.g. 2026-11-13T02:00:00Z.", help: "Test mode only." } }, 400);

function act(ws: Workspace, action: WorkspaceAction, body: Record<string, unknown>, req: NextRequest, defaultActor: string, pick?: (ws: Workspace, created: string[]) => unknown) {
  const actorId = req.headers.get("x-clearline-actor") ?? (typeof body.actorId === "string" ? body.actorId : defaultActor);
  if (body.at !== undefined && !isInstant(body.at)) return badAt();
  const at = typeof body.at === "string" ? body.at : ws.asOf;
  const r = applyAction(ws, action, { actorId, at });
  if (!r.ok) return fail(r.error.code, r.error.message, { field: r.error.field, entityId: r.error.entityId });
  const { workspace, audit, outcome, createdIds } = r.value;
  return respond(
    { data: pick ? pick(workspace, createdIds) : { createdIds }, outcome, audit, workspace, mode: "synthetic", persisted: false, disclaimer: ENGINE_DISCLAIMER },
    createdIds.length && outcome !== "idempotent_replay" ? 201 : 200,
  );
}

type Ctx = { params: Promise<{ path: string[] }> };
/** M6: malformed input must never surface as an HTTP 500 or leak internals. */
const guarded = (handler: (req: NextRequest, ctx: Ctx) => Promise<Response>) => async (req: NextRequest, ctx: Ctx) => {
  try {
    return await handler(req, ctx);
  } catch {
    return respond({ error: { code: "invalid_request", message: "The request could not be processed; check the JSON shape against docs/clearline/openapi.yaml.", help: "Test mode only." } }, 422);
  }
};

export const GET = guarded(async (req: NextRequest, { params }: Ctx) => {
  const path = (await params).path;
  if (path.join("/") === "health") return respond({ mode: "test", canMoveMoney: false, persisted: false, service: "Clearline engine sandbox v1" });
  if (!authed(req)) return fail("unauthenticated", "Send Authorization: Bearer cl_test_demo (a public example key, not a credential).");
  const ws = sampleWorkspace();
  const [root, id] = path;
  const ok = (data: unknown) => respond({ data, mode: "synthetic", source: "sample workspace", disclaimer: ENGINE_DISCLAIMER });
  switch (root) {
    case "workspace": return ok(ws);
    case "routes": return ok(ws.routes);
    case "intents": return id ? (ws.intents.find((i) => i.id === id) ? ok(ws.intents.find((i) => i.id === id)) : fail("not_found", "Intent not found.")) : ok(ws.intents);
    case "instructions": return ok(ws.instructions);
    case "events": return ok(ws.providerEvents);
    case "reconciliation": return ok({ statementLines: ws.statementLines, allocations: ws.allocations });
    case "exceptions": return ok(listExceptions(ws, { status: "unresolved" }));
    case "liquidity": return ok(computeLiquidity(ws));
    case "funding-advances": return ok(fundingProjection(ws));
    case "repayments": return ok({ obligations: ws.obligations, allocations: ws.repaymentAllocations });
    case "investigations": {
      const v = investigate(ws, id ?? "");
      return v.ok ? ok(v.value) : fail(v.error.code, v.error.message);
    }
    default: return fail("unknown_endpoint", "Unknown endpoint.");
  }
});

export const POST = guarded(async (req: NextRequest, { params }: Ctx) => {
  const path = (await params).path;
  if (!authed(req)) return fail("unauthenticated", "Send Authorization: Bearer cl_test_demo (a public example key, not a credential).");
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const route = path.join("/");

  // Sample verifier: no workspace needed.
  if (route === "webhooks/verify") {
    const { providerId, rawBody, signatureHeader, at } = body as Record<string, string>;
    if (!getAdapter(providerId) || typeof rawBody !== "string" || typeof signatureHeader !== "string") return fail("invalid_field", "providerId, rawBody and signatureHeader required.");
    if (at !== undefined && !isInstant(at)) return badAt();
    const now = at !== undefined ? Math.floor(Date.parse(at) / 1000) : Math.floor(Date.now() / 1000);
    return respond({ data: verifySandboxWebhook(rawBody, signatureHeader, sandboxWebhookSecret(providerId), now), mode: "synthetic" });
  }

  const ws = workspaceFrom(body);
  if (ws instanceof Response) return ws;
  const [root, id, verb] = path;
  const intentOf = (w: Workspace, c: string[]) => w.intents.find((i) => i.id === c[0]);

  if (root === "actions" && !id) {
    if (!body.action || typeof body.action !== "object") return fail("invalid_field", "action required.");
    return act(ws, body.action as WorkspaceAction, body, req, "usr_maya");
  }
  if (root === "intents" && !id) {
    const input = { ...(body.input as Record<string, unknown>) };
    const header = req.headers.get("idempotency-key");
    if (header) {
      if (input.idempotencyKey !== undefined && input.idempotencyKey !== header) return fail("idempotency_conflict", "Idempotency-Key header and body idempotencyKey differ.");
      input.idempotencyKey = header;
    }
    return act(ws, { type: "create_intent", input: input as never }, body, req, "usr_maya", intentOf);
  }
  if (root === "intents" && id && verb === "quotes")
    return act(ws, { type: "request_quotes", intentId: id }, body, req, "usr_maya", (w) => w.quotes.filter((q) => q.intentId === id && w.intents.find((i) => i.id === id)?.quoteIds.includes(q.id)));
  if (root === "intents" && id && verb === "cancel") return act(ws, { type: "cancel_intent", intentId: id, reason: String(body.reason ?? "") }, body, req, "usr_maya", (w) => w.intents.find((i) => i.id === id));
  if (root === "instructions" && !id)
    return act(ws, { type: "choose_route", intentId: String(body.intentId ?? ""), quoteId: String(body.quoteId ?? "") }, body, req, "usr_maya", (w, c) => w.instructions.find((x) => x.id === c[0]));
  if (root === "instructions" && id && verb === "approve") return act(ws, { type: "approve_instruction", instructionId: id }, body, req, "usr_daniel", (w) => w.instructions.find((x) => x.id === id));
  if (root === "instructions" && id && verb === "reject") return act(ws, { type: "reject_instruction", instructionId: id, reason: String(body.reason ?? "") }, body, req, "usr_daniel", (w) => w.instructions.find((x) => x.id === id));
  if (root === "instructions" && id && verb === "submit") return act(ws, { type: "submit_instruction", instructionId: id }, body, req, "usr_maya", (w) => w.instructions.find((x) => x.id === id));
  if (root === "events" && id === "simulate")
    return act(ws, { type: "simulate_provider_event", intentId: String(body.intentId ?? ""), injection: body.injection as never }, body, req, "usr_maya", (w) => w.providerEvents.filter((e) => e.intentId === body.intentId));
  if (root === "events" && id === "webhook") {
    const providerId = String(body.providerId ?? "");
    const signatureHeader = req.headers.get("x-sandbox-signature") ?? String(body.signatureHeader ?? "");
    return act(ws, { type: "ingest_webhook", delivery: { providerId, rawBody: String(body.rawBody ?? ""), signatureHeader } }, body, req, "usr_maya", (w) => w.providerEvents.at(-1));
  }
  if (root === "reconciliation" && id === "statement-lines")
    return act(ws, { type: "ingest_statement_line", line: body.line as never }, body, req, "usr_maya", (w, c) => w.statementLines.find((l) => l.id === c[0]));
  if (root === "repayments" && !id) {
    const line = body.line as Record<string, unknown> | undefined;
    if (!line || line.direction !== "credit" || line.kind !== "payment") return fail("invalid_field", "Repayments are credit payment statement lines (direction: credit, kind: payment).");
    return act(ws, { type: "ingest_statement_line", line: line as never }, body, req, "usr_maya", (w) => fundingProjection(w));
  }
  if (root === "exceptions" && id && verb) {
    const target = { kind: "exception" as const, id };
    const map: Record<string, WorkspaceAction> = {
      assign: { type: "assign_owner", target, ownerId: String(body.ownerId ?? "") },
      notes: { type: "add_note", target, text: String(body.text ?? "") },
      evidence: { type: "attach_evidence", target, evidence: body.evidence as never },
      resolve: { type: "resolve", target, note: String(body.note ?? "") },
      reopen: { type: "reopen", target, reason: String(body.reason ?? "") },
    };
    if (!map[verb]) return fail("unknown_endpoint", "Unknown exception operation.");
    return act(ws, map[verb], body, req, "usr_maya", (w) => w.exceptions.find((e) => e.id === id));
  }
  if (root === "funding-advances" && !id)
    return act(ws, { type: "create_advance", input: body.input as never }, body, req, "usr_maya", (w, c) => fundingProjection(w).rows.find((r) => r.advanceId === c[0]));
  if (root === "funding-advances" && id && verb === "decision")
    return act(ws, { type: "decide_advance", advanceId: id, outcome: body.outcome as never, reason: String(body.reason ?? "") }, body, req, "usr_daniel", (w) => fundingProjection(w).rows.find((r) => r.advanceId === id));
  if (root === "liquidity" && !id) {
    if (body.at !== undefined && !isInstant(body.at)) return badAt();
    return respond({ data: computeLiquidity(ws, typeof body.at === "string" ? body.at : ws.asOf), mode: "synthetic" });
  }
  if (root === "investigations" && id) {
    const v = investigate(ws, id);
    return v.ok ? respond({ data: v.value, mode: "synthetic" }) : fail(v.error.code, v.error.message);
  }
  return fail("unknown_endpoint", "Unknown endpoint.");
});
