import "server-only";
import { jsonBody, principalFrom } from "../control-http";
import { errorResponse, sameOriginOrNull } from "../http";
import type { Principal } from "../tenant";

/** A platform-console or invitation mutation: exact-Origin check first, then (for the console) the session, then the JSON body. */
export async function platformMutate(req: Request, run: (p: Principal, body: unknown) => Promise<Response>): Promise<Response> {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try { return await run(await principalFrom(req), await jsonBody(req)); } catch (e) { return errorResponse(e); }
}

export async function publicMutate(req: Request, run: (body: unknown) => Promise<Response>): Promise<Response> {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try { return await run(await jsonBody(req)); } catch (e) { return errorResponse(e); }
}
