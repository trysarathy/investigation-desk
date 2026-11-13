/**
 * QA L3 (rc3): the test-API routes are excluded from the middleware matcher, so Next never clones or
 * drains their request bodies. Every deployment gate that applied to them in the middleware is
 * applied here instead, by the SAME pure function (deploymentGate in src/middleware.ts), before any
 * body byte is read. Not a route file: Next only routes `route.ts`.
 */
import { deploymentGate, gateResponse } from "@/middleware";

/** The middleware's response for this request when a deployment gate refuses it, else null. */
export function refusedByDeploymentGate(req: Request): Response | null {
  return gateResponse(deploymentGate(new URL(req.url).pathname, req.headers.get("authorization"), process.env), req.url);
}

/**
 * Marks a response sent while request-body bytes may still be unread: the server closes the
 * connection after it instead of reading (and discarding) the rest of an arbitrarily large body.
 */
export function closeAfter(res: Response): Response {
  res.headers.set("Connection", "close");
  return res;
}

const hasBody = (req: Request) => req.method !== "GET" && req.method !== "HEAD" && req.body !== null;

/** Wraps a route handler so the deployment gates run first, before any body byte is read. */
export function gated<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const refused = refusedByDeploymentGate(req);
    if (refused) return hasBody(req) ? closeAfter(refused) : refused;
    return handler(req, ...rest);
  };
}
