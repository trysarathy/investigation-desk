import { json } from "@/server/http";
import { platformMutate } from "@/server/onboarding/http";
import { createOrganizationAndInvite, CreateOrgInput, platformOrgs } from "@/server/onboarding/platform";
import { principalFrom } from "@/server/control-http";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Platform operators only (CLEARLINE_PLATFORM_CONSOLE=1 and platform_operators); anyone else: 404. */
export async function GET(req: Request) {
  try { return json(200, { organizations: await platformOrgs(await principalFrom(req)) }); } catch (e) { return errorResponse(e); }
}

/** Create an empty live organisation and invite its first admin (email through the email sender). */
export const POST = (req: Request) => platformMutate(req, async (p, body) => json(201, await createOrganizationAndInvite(p, CreateOrgInput.parse(body))));
