import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";
import { sameOriginOrNull } from "@/server/http";

// Better Auth's endpoints (sign-in, sign-out, session), behind our exact-Origin CSRF check. Pilot deployments only.
export const dynamic = "force-dynamic";
export const GET = (req: Request) => toNextJsHandler(auth()).GET(req);
export const POST = (req: Request) => sameOriginOrNull(req) ?? toNextJsHandler(auth()).POST(req);
