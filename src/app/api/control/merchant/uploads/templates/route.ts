import { z } from "zod";
import { TemplateInput, listMappingTemplates, saveMappingTemplate } from "@/server/mapping-templates";
import { mutate, read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const Type = z.enum(["provider_export", "settlement_report", "orders_invoices", "bank_statement"]).optional();

/** Every mapping template version (?fileType). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, { templates: await listMappingTemplates(ctx, Type.parse(new URL(req.url).searchParams.get("fileType") ?? undefined)) }));

/** Save a confirmed mapping as a template (a new version for an existing name). Body: { fileType, name, headers, mapping }. */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await saveMappingTemplate(ctx, TemplateInput.parse(body), key);
  return json(r.status, { template: r.body, replayed: r.replayed });
});
