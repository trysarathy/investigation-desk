import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentPrincipal } from "./auth";
import { ORG_COOKIE } from "./control-http";
import { AccessDenied, resolveTenant, type TenantContext } from "./tenant";

/**
 * The tenant context for a /control page, once per request. No session → redirect to sign-in. The `clearline_org`
 * cookie only selects among the user's own memberships; a cookie naming any other organisation is a 404 (as in the
 * API), so a page never reveals whether that organisation exists.
 */
export const pageContext = cache(async (): Promise<TenantContext> => {
  const p = await currentPrincipal(await headers());
  if (!p) redirect("/control/sign-in");
  const slug = (await cookies()).get(ORG_COOKIE)?.value || undefined;
  try {
    return await resolveTenant(p, slug);
  } catch (e) {
    if (e instanceof AccessDenied && e.status === 404) notFound();
    throw e;
  }
});

/** Runs a service read and turns its 404 into the page's not-found answer. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (e instanceof AccessDenied && e.status === 404) notFound();
    throw e;
  }
}
