import { redirect } from "next/navigation";
import { pageContext } from "@/server/control-page";
import { orgKind } from "@/server/merchant-ui";

export const dynamic = "force-dynamic";

/** notFound() from pageContext (e.g. an organisation cookie left from another sign-in): the page answers it as before. */
const isNotFound = (e: unknown) => typeof (e as { digest?: unknown })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404");

/**
 * design-fluid: where a person lands after signing in. The same decision as the Overview page, answered as a real
 * redirect (the root loading skeleton would otherwise stream a page's redirect late, after a 200).
 */
export async function GET() {
  let k: Awaited<ReturnType<typeof orgKind>>;
  try {
    k = await orgKind(await pageContext());
  } catch (e) {
    if (isNotFound(e)) redirect("/control");
    throw e;
  }
  if (k.kind === "merchant" && (k.hasProvider || k.live)) redirect("/control/merchant");
  if (k.kind === "provider") redirect("/control/merchant/provider");
  redirect("/control");
}
