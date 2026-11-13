/**
 * RETIRED (2026-11-13, code review M10 / QA L7). The unversioned legacy test API ran on the old
 * prototype engine (float amounts, a weaker webhook verifier). It no longer executes anything:
 * - a request that is invalid under the old contract is still refused with 422 (QA L7), and
 * - every other request gets 410 Gone with a pointer to /api/clearline/test/v1 (unified engine).
 *
 * QA L3 (rc3): this route is excluded from the middleware matcher, so it applies the deployment gates
 * itself (gated) and reads at most MAX_BODY_BYTES of a body.
 */
import { NextResponse } from "next/server";
import { readBodyLimited } from "@/lib/clearline/bodylimit";
import { closeAfter, gated, refusedByDeploymentGate } from "../gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-Clearline-Mode": "synthetic-test-only" };
const REPLACEMENT = "/api/clearline/test/v1";

const gone = () =>
  NextResponse.json(
    { error: { code: "endpoint_retired", message: `This unversioned test endpoint has been retired. Use ${REPLACEMENT} (see docs/clearline/openapi.yaml).`, replacement: REPLACEMENT, help: "Test mode only. No money movement." } },
    { status: 410, headers: HEADERS },
  );
const invalid = (message: string) =>
  NextResponse.json({ error: { code: "invalid_request", message, replacement: REPLACEMENT, help: "This endpoint is retired; invalid requests are still refused." } }, { status: 422, headers: HEADERS });

const CURRENCIES = ["SGD", "USD", "PHP", "USDC"];
const STATES = ["created", "quoted", "approved", "submitted", "in_transit", "completed", "failed", "returned", "on_hold"];
const ALLOWED: Record<string, string[]> = {
  created: ["quoted", "failed"], quoted: ["approved", "failed"], approved: ["submitted", "on_hold", "failed"],
  submitted: ["in_transit", "on_hold", "failed"], in_transit: ["completed", "failed", "returned", "on_hold"],
  on_hold: ["submitted", "in_transit", "failed", "returned"], completed: [], failed: [], returned: [],
};
const safeText = (v: unknown, n = 120) => typeof v === "string" && v.length >= 2 && v.length <= n && /^[a-zA-Z0-9 ()/.,:_\-]+$/.test(v);

/** The old contract's validation, kept only so invalid input is never answered as if accepted. */
function legacyProblem(action: string, b: Record<string, unknown>): string | null {
  if (action === "intents") {
    if (Object.keys(b).sort().join(",") !== "amount,beneficiary,currency,destinationCurrency,purpose,reference") return "Exact intent fields required.";
    if (typeof b.amount !== "string" || !/^(?:[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(b.amount)) return "Use a positive amount.";
    if (!CURRENCIES.includes(b.currency as string) || !CURRENCIES.includes(b.destinationCurrency as string)) return "Unsupported currency.";
    if (!safeText(b.beneficiary) || !safeText(b.purpose) || !safeText(b.reference, 48)) return "Use fictional text-only fields.";
    return null;
  }
  if (action === "quotes") {
    if (typeof b.amountMinor !== "number" || !Number.isSafeInteger(b.amountMinor) || b.amountMinor <= 0) return "amountMinor must be a positive integer.";
    if (!CURRENCIES.includes(b.currency as string) || !CURRENCIES.includes(b.destinationCurrency as string)) return "Unsupported currency.";
    if (typeof b.kycTier !== "number") return "kycTier required.";
    return null;
  }
  if (action === "transitions") {
    const p = b.payment as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !STATES.includes(p.status as string) || !STATES.includes(b.to as string)) return "payment object and allowed to state required.";
    if (!ALLOWED[p.status as string].includes(b.to as string)) return `Invalid payment transition: ${String(p.status)} to ${String(b.to)}.`;
    return null;
  }
  if (action === "webhooks") {
    return ["intent.created", "quote.accepted", "payout.submitted", "payout.completed", "payout.failed", "payout.returned"].includes(b.type as string) ? null : "Unknown webhook event type.";
  }
  return null;
}

/** The old contract allowed 12,000 characters; at most 4 UTF-8 bytes each, so this byte cap never refuses a valid one. */
const MAX_BODY_BYTES = 48_000;

// The request is optional only for existing unit tests that call GET() bare; Next always passes it.
export async function GET(req?: unknown, _ctx?: unknown) {
  const refused = req instanceof Request ? refusedByDeploymentGate(req) : null;
  return refused ?? gone();
}

export const POST = gated(async (req: Request, ctx: { params: Promise<{ action: string }> }) => {
  try {
    const { action } = await ctx.params;
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return closeAfter(invalid("Test payload exceeds 12 KB."));
    const read = await readBodyLimited(req.body, MAX_BODY_BYTES);
    if (!read.ok) return closeAfter(read.reason === "too_large" ? invalid("Test payload exceeds 12 KB.") : gone());
    const text = read.text;
    if (text.length > 12_000) return invalid("Test payload exceeds 12 KB.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return invalid("JSON object required.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("JSON object required.");
    const problem = legacyProblem(action, body as Record<string, unknown>);
    return problem ? invalid(problem) : gone();
  } catch {
    return gone();
  }
});

const goneGated = gated(async (req: Request) => (req.body ? closeAfter(gone()) : gone()));
export const PUT = goneGated;
export const PATCH = goneGated;
export const DELETE = goneGated;
// Defined so the gates run for OPTIONS too (Next's automatic OPTIONS would answer before any gate).
export const OPTIONS = gated(async () => new Response(null, { status: 204, headers: { Allow: "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT" } }));
