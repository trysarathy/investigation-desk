import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { FILE_TYPES, normalisedHeaderList, suggestMapping, validateMapping, type FileType, type Mapping, type MappingSuggestion } from "@/lib/clearline/mapping";
import { dataLabel, isDataMode, type DataLabel, type DataMode } from "@/lib/clearline/data-mode";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";

/**
 * rc7 mapping templates: a merchant's saved column mappings, one immutable row per version, offered again when an
 * upload's headers match (auto-apply is a SUGGESTION; the person confirms). Finance or Payment Operations save them;
 * everyone in the merchant reads them. A provider-file template reads files of the merchant's own provider only
 * (refused by the database otherwise, drizzle/0017). Audit rows carry ids and counts, never header names or values.
 */

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });

/** sha256 of the normalised, sorted header list: the same export layout always has the same signature. */
export function headerSignature(headers: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(normalisedHeaderList(headers)), "utf8").digest("hex");
}

const Headers = z.array(z.string().max(200)).min(1).max(200);
export const TemplateInput = z.object({
  fileType: z.enum(FILE_TYPES),
  name: z.string().trim().min(1).max(120),
  headers: Headers,
  mapping: z.unknown(),
}).strict();

export interface TemplateView {
  id: string; name: string; version: number; fileType: FileType; providerOrgId: string | null; headerSignature: string;
  mapping: Mapping; createdBy: string; createdAt: string;
}
const view = (r: typeof t.mappingTemplates.$inferSelect): TemplateView => ({
  id: r.id, name: r.name, version: r.version, fileType: r.fileType as FileType, providerOrgId: r.providerOrgId, headerSignature: r.headerSignature,
  mapping: r.mapping as Mapping, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
});

/** The organisation's data mode and the label the UI shows for its data. */
export async function dataModeOf(tx: Tx, orgId: string): Promise<{ dataMode: DataMode; label: DataLabel }> {
  const [o] = await tx.select({ dataMode: t.organizations.dataMode }).from(t.organizations).where(eq(t.organizations.id, orgId));
  if (!o || !isDataMode(o.dataMode)) throw new AccessDenied(404, "Not found.");
  return { dataMode: o.dataMode, label: dataLabel(o.dataMode) };
}
export const organisationDataMode = (ctx: TenantContext) => { require(ctx, "read"); return tenantRead(ctx, (tx) => dataModeOf(tx, ctx.orgId)); };

/** The provider whose files a template of this type reads: the merchant's own provider, or none for its own files. */
async function providerFor(tx: Tx, orgId: string, fileType: FileType): Promise<string | null> {
  const [o] = await tx.select({ kind: t.organizations.kind, providerOrgId: t.organizations.providerOrgId }).from(t.organizations).where(eq(t.organizations.id, orgId));
  if (!o || o.kind !== "merchant") throw new AccessDenied(403, "Mapping templates belong to a merchant.");
  if (fileType !== "provider_export" && fileType !== "settlement_report") return null;
  if (!o.providerOrgId) throw new RequestRefused(409, "NO_PROVIDER", "This merchant has no payment provider, so it has no provider files to map.");
  return o.providerOrgId;
}

/** Save a confirmed mapping as a template: version 1 for a new name, else the next version. The mapping must fit the headers. */
export async function saveMappingTemplate(ctx: TenantContext, input: z.input<typeof TemplateInput>, idempotencyKey: string) {
  require(ctx, "merchant_upload");
  const key = IdempotencyKey.parse(idempotencyKey);
  const v = TemplateInput.parse(input);
  const check = validateMapping(v.mapping, v.headers);
  if (!check.ok) throw new RequestRefused(422, "MAPPING_INVALID", check.issues.map((i) => i.message).join(" "));
  if (check.mapping.fileType !== v.fileType) throw new RequestRefused(422, "MAPPING_INVALID", "The mapping is for another file type.");
  const signature = headerSignature(v.headers);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "mapping_template_save", name: v.name, fileType: v.fileType, signature, mapping: check.mapping }, async () => {
    const providerOrgId = await providerFor(tx, ctx.orgId, v.fileType);
    const [latest] = await tx.select({ v: max(t.mappingTemplates.version) }).from(t.mappingTemplates)
      .where(and(eq(t.mappingTemplates.orgId, ctx.orgId), eq(t.mappingTemplates.fileType, v.fileType), eq(t.mappingTemplates.name, v.name)));
    const [row] = await tx.insert(t.mappingTemplates).values({
      orgId: ctx.orgId, providerOrgId, fileType: v.fileType, name: v.name, version: (latest?.v ?? 0) + 1, headerSignature: signature, mapping: check.mapping, createdBy: ctx.userId,
    }).returning();
    await serverAudit(tx, ctx, "mapping_template_saved", "mapping_template", row.id, `Mapping template saved (${v.fileType}, version ${row.version}, ${Object.keys(check.mapping.columns).length} fields mapped)`,
      { templateId: row.id, version: row.version, fileType: v.fileType, fields: Object.keys(check.mapping.columns).length });
    return { status: 201, body: view(row) };
  }));
}

/** Every template version of the merchant, newest version first per name. */
export async function listMappingTemplates(ctx: TenantContext, fileType?: FileType) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const rows = await tx.select().from(t.mappingTemplates)
      .where(and(eq(t.mappingTemplates.orgId, ctx.orgId), ...(fileType ? [eq(t.mappingTemplates.fileType, fileType)] : [])))
      .orderBy(asc(t.mappingTemplates.fileType), asc(t.mappingTemplates.name), desc(t.mappingTemplates.version));
    return rows.map(view);
  });
}

export interface TemplateSuggestion {
  /** The latest version of a usable template saved for exactly these headers. */
  exact: TemplateView | null;
  /** Latest versions of other usable templates whose mapping fits these headers. */
  compatible: TemplateView[];
  /** Header-name suggestions, for when no template fits (never confirmed). */
  suggestion: MappingSuggestion;
}

/** Templates are usable only while their provider is still the merchant's provider. */
async function usableLatest(tx: Tx, orgId: string, fileType: FileType): Promise<TemplateView[]> {
  const [o] = await tx.select({ providerOrgId: t.organizations.providerOrgId }).from(t.organizations).where(eq(t.organizations.id, orgId));
  const rows = await tx.select().from(t.mappingTemplates).where(and(eq(t.mappingTemplates.orgId, orgId), eq(t.mappingTemplates.fileType, fileType)))
    .orderBy(asc(t.mappingTemplates.name), desc(t.mappingTemplates.version), desc(t.mappingTemplates.createdAt));
  const seen = new Set<string>();
  return rows.filter((r) => (r.providerOrgId === null || r.providerOrgId === o?.providerOrgId) && !seen.has(r.name) && seen.add(r.name)).map(view);
}

/** Auto-apply: given an upload's file type and headers, the template to offer (the person still confirms it). */
export async function suggestTemplate(ctx: TenantContext, input: { fileType: FileType; headers: readonly string[] }): Promise<TemplateSuggestion> {
  require(ctx, "read");
  const fileType = z.enum(FILE_TYPES).parse(input.fileType);
  const headers = Headers.parse(input.headers);
  const signature = headerSignature(headers);
  return tenantRead(ctx, async (tx) => {
    const usable = await usableLatest(tx, ctx.orgId, fileType);
    const exact = usable.filter((x) => x.headerSignature === signature).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
    const compatible = usable.filter((x) => x !== exact && validateMapping(x.mapping, headers).ok);
    return { exact, compatible, suggestion: suggestMapping(headers, fileType) };
  });
}
