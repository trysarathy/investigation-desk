import { saveSettings } from "@/lib/platform/settings";
import { actor } from "@/lib/auth/actor";
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  try {
    return Response.json(saveSettings(await req.json(), await actor()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
