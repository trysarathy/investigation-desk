import { getDocument, audit, type CaseRecord } from "@/lib/platform/store";
import { actor } from "@/lib/auth/actor";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  const r = getDocument<CaseRecord>("case", (await params).id);
  if (!r) return Response.json({ error: "Not found" }, { status: 404 });
  const b = await req.json();
  if (
    !["reply.copied", "verdict.confirmed", "finding.confirmed"].includes(
      b.action,
    )
  )
    return Response.json({ error: "Invalid action" }, { status: 400 });
  audit(b.action, r.id, await actor());
  return Response.json({ ok: true });
}
