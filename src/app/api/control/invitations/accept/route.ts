import { json } from "@/server/http";
import { publicMutate } from "@/server/onboarding/http";
import { acceptInvitation, AcceptInput } from "@/server/onboarding/invitations";

export const dynamic = "force-dynamic";

/** Accept an invitation with its one-time token (no session: the token is the proof). Then the person signs in. */
export const POST = (req: Request) => publicMutate(req, async (body) => json(200, await acceptInvitation(AcceptInput.parse(body))));
