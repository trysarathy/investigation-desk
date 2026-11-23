import "server-only";
import { currentPrincipal } from "./auth";
import { IdempotencyKey } from "./control";
import { LIMITS } from "@/lib/clearline/ingest/limits";
import { RequestRefused } from "./errors";
import { errorResponse, sameOriginOrNull } from "./http";
import { AccessDenied, resolveTenant, type Principal, type TenantContext } from "./tenant";

/**
 * Request plumbing shared by every /api/control route handler.
 *
 * Who acts is ALWAYS the session user (the `clearline.session_token` cookie, checked against the session row on every
 * request). The organisation comes from the `clearline_org` cookie, which only *selects* among the user's own active
 * memberships (resolveTenant). Nothing here reads a user id, an organisation id or an actor from a request header
 * such as `x-clearline-actor`, or from a request body.
 */

export const ORG_COOKIE = "clearline_org";
/** Largest JSON body a Control mutation accepts. */
export const MAX_BODY_BYTES = 64 * 1024;

export function readCookie(h: Headers, name: string): string | undefined {
  const raw = h.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      try { return decodeURIComponent(v); } catch { return undefined; }
    }
  }
  return undefined;
}

export async function principalFrom(req: Request): Promise<Principal> {
  const p = await currentPrincipal(req.headers);
  if (!p) throw new AccessDenied(401, "Sign in to continue.");
  return p;
}

export async function tenantFrom(req: Request): Promise<TenantContext> {
  return resolveTenant(await principalFrom(req), readCookie(req.headers, ORG_COOKIE) || undefined);
}

export function idempotencyKeyFrom(req: Request): string {
  const k = req.headers.get("idempotency-key");
  if (!k) throw new RequestRefused(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required.");
  const r = IdempotencyKey.safeParse(k);
  if (!r.success) throw new RequestRefused(400, "IDEMPOTENCY_KEY_INVALID", "The Idempotency-Key header must be 8–128 letters, digits, dots, colons, dashes or underscores.");
  return r.data;
}

export async function jsonBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw new RequestRefused(400, "JSON_REQUIRED", "Send the request body as application/json.");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new RequestRefused(400, "BODY_TOO_LARGE", "The request body is too large.");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new RequestRefused(400, "BODY_TOO_LARGE", "The request body is too large.");
  try { return JSON.parse(text); } catch { throw new RequestRefused(400, "INVALID_JSON", "The request body is not valid JSON."); }
}

/** A read: authenticate, resolve the tenant, run, map errors. */
export async function read(req: Request, run: (ctx: TenantContext) => Promise<Response>): Promise<Response> {
  try { return await run(await tenantFrom(req)); } catch (e) { return errorResponse(e); }
}

/**
 * A mutation: exact-Origin check first (a foreign Origin is refused before anything else, signed in or not), then the
 * session, the organisation selection, the Idempotency-Key header and the JSON body. `run` validates the body with
 * the service's Zod schema; the service then checks the permission matrix and the engine's own rules.
 */
export async function mutate(req: Request, run: (ctx: TenantContext, body: unknown, key: string) => Promise<Response>): Promise<Response> {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try {
    const ctx = await tenantFrom(req);
    const key = idempotencyKeyFrom(req);
    const body = await jsonBody(req);
    return await run(ctx, body, key);
  } catch (e) { return errorResponse(e); }
}

/** rc7: the largest multipart upload request: the largest file the ingest limits accept plus room for the form fields. */
export const MAX_UPLOAD_REQUEST_BYTES = LIMITS.maxFileBytes + 64 * 1024;

/**
 * rc7: a file upload (multipart/form-data with a `file` part and text fields). Same order of checks as `mutate`
 * (Origin, session, organisation, Idempotency-Key); the declared and the actual size are capped before the file is
 * read by any parser. The file's bytes are passed to `run` and never logged.
 */
export async function mutateUpload(req: Request, run: (ctx: TenantContext, form: { fields: Record<string, string>; fileName: string; bytes: Uint8Array }, key: string) => Promise<Response>): Promise<Response> {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try {
    const ctx = await tenantFrom(req);
    const key = idempotencyKeyFrom(req);
    if (!/^multipart\/form-data\b/i.test(req.headers.get("content-type") ?? "")) throw new RequestRefused(400, "MULTIPART_REQUIRED", "Send the file as multipart/form-data with a \"file\" part.");
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > MAX_UPLOAD_REQUEST_BYTES) throw new RequestRefused(422, "FILE_TOO_LARGE", "The file is larger than the largest file accepted (20 MB). Split it into smaller files.");
    let form: FormData;
    try { form = await req.formData(); } catch { throw new RequestRefused(400, "INVALID_FORM", "The upload could not be read as a form."); }
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new RequestRefused(400, "FILE_REQUIRED", "Attach the file in a \"file\" part.");
    if (file.size > LIMITS.maxFileBytes) throw new RequestRefused(422, "FILE_TOO_LARGE", "The file is larger than the largest file accepted (20 MB). Split it into smaller files.");
    const fields: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string" && v.length <= 1000) fields[k] = v;
    const fileName = file instanceof File && file.name ? file.name : "upload";
    return await run(ctx, { fields, fileName, bytes: new Uint8Array(await file.arrayBuffer()) }, key);
  } catch (e) { return errorResponse(e); }
}
