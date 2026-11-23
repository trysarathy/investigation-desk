import { AuditPage, auditLogPage } from "@/server/org-admin";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** ?before=<seq>&pageSize=<n>: one page of the audit log, ids only (Admin only). */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const p = AuditPage.parse({ ...(q.get("before") ? { before: Number(q.get("before")) } : {}), ...(q.get("pageSize") ? { pageSize: Number(q.get("pageSize")) } : {}) });
  return json(200, await auditLogPage(ctx, p));
});
