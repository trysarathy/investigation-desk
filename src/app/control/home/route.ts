import { redirect } from "next/navigation";
import { pageContext } from "@/server/control-page";
import { orgKind } from "@/server/merchant-ui";

export const dynamic = "force-dynamic";

/**
 * Where a signed-in member starts: the same decision as the /control page (src/app/control/(app)/page.tsx), answered
 * as a real redirect. A page's redirect is streamed (the root loading boundary wraps every page), so it arrived late
 * and could overtake the next navigation; a route handler's redirect is a plain 307. Sign-in, the MFA gate and
 * organisation selection run exactly as for a page (pageContext).
 */
export async function GET() {
  const ctx = await pageContext();
  const k = await orgKind(ctx);
  if (k.kind === "merchant" && (k.hasProvider || k.live)) redirect("/control/merchant");
  if (k.kind === "provider") redirect("/control/merchant/provider");
  redirect("/control");
}
