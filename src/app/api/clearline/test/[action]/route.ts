/**
 * RETIRED (2026-11-13, code review M10 / QA L7). The unversioned legacy test API ran on the old
 * prototype engine (float amounts, a weaker webhook verifier). It no longer executes anything:
 * - a request that is invalid under the old contract is still refused with 422 (QA L7), and
 * - every other request gets 410 Gone with a pointer to /api/clearline/test/v1 (unified engine).
 */
import { NextResponse } from "next/server";

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

export async function GET(_req?: unknown, _ctx?: unknown) {
  return gone();
}

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await ctx.params;
    const text = await req.text();
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
}

export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
