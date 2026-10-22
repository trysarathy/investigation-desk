import { enqueueAlert } from "@/lib/integrations/outbox";
import { actor } from "@/lib/auth/actor";
import { correctCase } from "@/lib/platform/store";
import { VERDICT_LABELS } from "@/lib/catalogue";
import type { Code } from "@/lib/types";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return Response.json(
      { error: "Cross-origin mutation refused" },
      { status: 403 },
    );
  const body = await req.json();
  if (
    !Object.hasOwn(VERDICT_LABELS, body.actual) ||
    typeof body.reason !== "string" ||
    !body.reason.trim() ||
    body.reason.length > 1000
  )
    return Response.json(
      { error: "Valid diagnosis and review reason required" },
      { status: 400 },
    );
  try {
    const record = correctCase(
      (await params).id,
      body.actual as Code,
      body.reason,
      await actor(),
    );
    enqueueAlert(`review:${record.id}:${record.feedback!.at}`, record.id);
    return Response.json(record);
  } catch {
    return Response.json({ error: "Case not found" }, { status: 404 });
  }
}
