import { json } from "@/server/http";
import { platformMutate } from "@/server/onboarding/http";
import { reinviteFirstAdmin, ReinviteInput } from "@/server/onboarding/platform";

export const dynamic = "force-dynamic";

/** A new first-admin invitation for an organisation that has no admin yet (platform operators only). */
export const POST = (req: Request) => platformMutate(req, async (p, body) => json(201, await reinviteFirstAdmin(p, ReinviteInput.parse(body))));
