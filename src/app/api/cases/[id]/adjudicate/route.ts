import {
  getDocument,
  putDocument,
  audit,
  atomic,
  database,
  workspaceId,
  type CaseRecord,
} from "@/lib/platform/store";
import { actor } from "@/lib/auth/actor";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    who = await actor();
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  return atomic(() => {
    const r = getDocument<CaseRecord>("case", id);
    if (!r?.feedback)
      return Response.json({ error: "Review required" }, { status: 409 });
    if (r.feedback.actor === who)
      return Response.json(
        { error: "A different reviewer must adjudicate" },
        { status: 409 },
      );
    r.feedback.adjudicated = true;
    putDocument("case", id, r);
    const candidates = database()
      .prepare(
        "SELECT id,body FROM documents WHERE workspace=? AND kind='regression'",
      )
      .all(workspaceId()) as { id: string; body: string }[];
    for (const row of candidates) {
      const c = JSON.parse(row.body);
      if (c.caseId === id && c.label.at === r.feedback.at) {
        c.label.adjudicated = true;
        putDocument("regression", row.id, c);
      }
    }
    audit("verdict.adjudicated", id, who);
    return Response.json({ ok: true });
  });
}
