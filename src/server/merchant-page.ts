import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { can } from "./authz";
import { pageContext } from "./control-page";
import { merchantShell } from "./merchant-ui";

/** The tenant context and white-label shell for a /control/merchant page, once per request. */
export const merchantPage = cache(async () => {
  const ctx = await pageContext();
  return { ctx, shell: await merchantShell(ctx) };
});

/**
 * A merchant finance-team page: a member of a merchant organisation with read access. Anyone else (a provider user,
 * whatever the URL) gets the not-found answer, which never says whether the merchant or the record exists.
 */
export async function merchantMember() {
  const r = await merchantPage();
  if (r.shell.kind !== "merchant" || !can(r.ctx.role, "read")) notFound();
  return r;
}
