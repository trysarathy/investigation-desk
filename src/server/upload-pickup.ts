import "server-only";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { FILE_TYPES, type FileType } from "@/lib/clearline/mapping";
import type { Db, Tx } from "./db/client";
import * as t from "./db/schema";
import { can } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { RequestRefused } from "./errors";
import { AccessDenied, requireUnscoped, resolveTenant, withTenant, type TenantContext } from "./tenant";
import { createUpload, setUploadMapping, validateUpload } from "./uploads";
import type { UploadStorage } from "./storage";
import { PickupUnavailable, pickupSourceFor, type PickupSource, type SourceConfig } from "./pickup/sources";
import { stampNow } from "./live-clock";

/**
 * v1 phase 2.1: scheduled pickup of uploads, optional per merchant. An Admin configures a source (an SFTP folder or an
 * email inbox) for one entity and file type, the member it runs as (Finance or Payment Operations), how often, and
 * optionally a mapping template. The scheduled run (`control:admin -- pickup-run`, from cron) reads each due source and
 * hands every new file to exactly the same pipeline as a person's upload: createUpload (allowlist, parsers, limits,
 * malware scan, duplicate check, encrypted storage, audit), then, with a template, the same mapping and validation.
 * Nothing is confirmed by pickup: a bank statement still needs an Approver who is not the run's member.
 * Logs and audit rows hold ids, codes and counts only.
 */

const Location = z.string().min(1).max(300).regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/).refine((l) => !l.split("/").some((p) => p === "." || p === ".."), "no . or .. segments");
const Sender = z.string().trim().toLowerCase().max(254).regex(/^([^\s@]+@[^\s@]+\.[^\s@]+|@[^\s@]+\.[^\s@]+)$/);

export const CreatePickupSource = z.object({
  kind: z.enum(["sftp", "email"]), name: z.string().trim().min(1).max(120), entityId: z.string().min(1).max(64), fileType: z.enum(FILE_TYPES),
  bankAccountId: z.uuid().optional(), templateId: z.uuid().optional(), location: Location,
  credentialRef: z.string().regex(/^CLEARLINE_PICKUP_[A-Z0-9_]{1,64}$/).optional(),
  allowedSenders: z.array(Sender).max(50).default([]), runAsUserId: z.string().min(1).max(200), intervalMinutes: z.number().int().min(5).max(1440).default(60),
}).strict().superRefine((v, c) => {
  if (v.kind === "email" && v.allowedSenders.length === 0) c.addIssue({ code: "custom", message: "An email source lists at least one allowed sender (an address or @domain).", path: ["allowedSenders"] });
  if (v.kind === "sftp" && v.allowedSenders.length) c.addIssue({ code: "custom", message: "Allowed senders apply to email sources only.", path: ["allowedSenders"] });
  if ((v.fileType === "bank_statement") !== !!v.bankAccountId) c.addIssue({ code: "custom", message: "A bank statement source names its bank account; other file types do not.", path: ["bankAccountId"] });
});

export type PickupSourceRow = typeof t.uploadPickupSources.$inferSelect;
const view = (r: PickupSourceRow) => ({
  id: r.id, kind: r.kind, name: r.name, entityId: r.entityId, fileType: r.fileType, bankAccountId: r.bankAccountId, templateId: r.templateId, location: r.location,
  credentialRef: r.credentialRef, allowedSenders: r.allowedSenders as string[], runAsUserId: r.runAsUserId, intervalMinutes: r.intervalMinutes, enabled: r.enabled,
  lastRunAt: r.lastRunAt?.toISOString() ?? null, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
});

function requirePickupAdmin(ctx: TenantContext) {
  if (!can(ctx.role, "manage_pickup")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  requireUnscoped(ctx);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);

/** Admin: add a pickup source. The database checks the member, the entity scope and the live organisation again. */
export async function createPickupSource(ctx: TenantContext, input: z.input<typeof CreatePickupSource>, idempotencyKey: string) {
  requirePickupAdmin(ctx);
  const key = IdempotencyKey.parse(idempotencyKey);
  const v = CreatePickupSource.parse(input);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "pickup_source_create", ...v }, async () => {
    const [m] = await tx.select({ role: t.organizationMemberships.role }).from(t.organizationMemberships)
      .where(and(eq(t.organizationMemberships.orgId, ctx.orgId), eq(t.organizationMemberships.userId, v.runAsUserId), isNull(t.organizationMemberships.revokedAt)));
    if (!m || !["finance", "payment_ops"].includes(m.role)) throw new RequestRefused(422, "PICKUP_MEMBER_CANNOT_UPLOAD", "A pickup source runs as a member who uploads files (Finance or Payment Operations).");
    const [row] = await tx.insert(t.uploadPickupSources).values({
      orgId: ctx.orgId, kind: v.kind, name: v.name, entityId: v.entityId, fileType: v.fileType, bankAccountId: v.bankAccountId ?? null, templateId: v.templateId ?? null,
      location: v.location, credentialRef: v.credentialRef ?? null, allowedSenders: v.allowedSenders, runAsUserId: v.runAsUserId, intervalMinutes: v.intervalMinutes, createdBy: ctx.userId,
    }).returning();
    await serverAudit(tx, ctx, "upload_pickup_source_created", "upload_pickup_source", row.id, `Pickup source added (${v.kind}, ${v.fileType} for ${v.entityId}, every ${v.intervalMinutes} minutes)`,
      { sourceId: row.id, kind: v.kind, entityId: v.entityId, fileType: v.fileType, runAsUserId: v.runAsUserId, intervalMinutes: v.intervalMinutes, allowedSenders: v.allowedSenders.length, credentialRef: v.credentialRef ?? null });
    return { status: 201, body: view(row) };
  }));
}

export async function listPickupSources(ctx: TenantContext) {
  if (!can(ctx.role, "manage_pickup") && !can(ctx.role, "merchant_upload")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => ({
    sources: (await tx.select().from(t.uploadPickupSources).where(eq(t.uploadPickupSources.orgId, ctx.orgId)).orderBy(asc(t.uploadPickupSources.createdAt))).map(view),
  }), { read: true });
}

/** Admin: switch a source on or off (nothing else about a source ever changes; add a new one instead). */
export async function setPickupSourceEnabled(ctx: TenantContext, id: string, enabled: boolean, idempotencyKey: string) {
  requirePickupAdmin(ctx);
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!z.uuid().safeParse(id).success) throw new AccessDenied(404, "Not found.");
  const on = z.boolean().parse(enabled);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "pickup_source_enable", id, enabled: on }, async () => {
    const [row] = await tx.update(t.uploadPickupSources).set({ enabled: on }).where(and(eq(t.uploadPickupSources.orgId, ctx.orgId), eq(t.uploadPickupSources.id, id))).returning();
    if (!row) throw new AccessDenied(404, "Not found.");
    await serverAudit(tx, ctx, on ? "upload_pickup_source_enabled" : "upload_pickup_source_disabled", "upload_pickup_source", id, `Pickup source switched ${on ? "on" : "off"}`, { sourceId: id });
    return { status: 200, body: view(row) };
  }));
}

export interface PickupRunCounts { sources: number; items: number; stored: number; duplicate: number; refused: number; validated: number; unavailable: number }

/**
 * The scheduled run: every enabled source whose interval has passed. Owner connection to find the due sources and
 * their members; everything else as the source's member, through row-level security. Returns counts; `log` receives
 * ids and codes only.
 */
export async function runPickup(db: Db, now: Date, opts: {
  sourceFor?: (row: SourceConfig) => PickupSource; storage?: UploadStorage;
  log?: (line: { event: "pickup_source_unavailable" | "pickup_source_done"; orgId: string; sourceId: string; code?: string; counts?: Record<string, number> }) => void;
} = {}): Promise<PickupRunCounts> {
  const sourceFor = opts.sourceFor ?? ((row: SourceConfig) => pickupSourceFor(row));
  const storage = opts.storage; // unset: each upload call uses the configured store, acting for the source's member
  const total: PickupRunCounts = { sources: 0, items: 0, stored: 0, duplicate: 0, refused: 0, validated: 0, unavailable: 0 };
  const due = await db.select({ src: t.uploadPickupSources, slug: t.organizations.slug, email: t.users.email, name: t.users.name }).from(t.uploadPickupSources)
    .innerJoin(t.organizations, eq(t.organizations.id, t.uploadPickupSources.orgId))
    .innerJoin(t.users, eq(t.users.id, t.uploadPickupSources.runAsUserId))
    .where(and(eq(t.uploadPickupSources.enabled, true), or(isNull(t.uploadPickupSources.lastRunAt),
      lte(sql`${t.uploadPickupSources.lastRunAt} + make_interval(mins => ${t.uploadPickupSources.intervalMinutes})`, now))))
    .orderBy(asc(t.uploadPickupSources.createdAt));
  for (const { src, slug, email, name } of due) {
    total.sources++;
    const counts = { items: 0, stored: 0, duplicate: 0, refused: 0, validated: 0 };
    let ctx: TenantContext;
    try { ctx = await resolveTenant({ userId: src.runAsUserId, email, name }, slug); } catch {
      // the member left the organisation: the source cannot run (an Admin switches it off or adds a new one)
      total.unavailable++;
      await db.insert(t.auditEvents).values({ orgId: src.orgId, source: "server", action: "upload_pickup_unavailable", entityType: "upload_pickup_source", entityId: src.id, at: now,
        summary: "Pickup did not run: its member is no longer an active member of this organisation", details: { sourceId: src.id, code: "PICKUP_MEMBER_NOT_ACTIVE" } });
      opts.log?.({ event: "pickup_source_unavailable", orgId: src.orgId, sourceId: src.id, code: "PICKUP_MEMBER_NOT_ACTIVE" });
      continue;
    }
    let items;
    try { items = await sourceFor(src).list(); } catch (e) {
      const code = e instanceof PickupUnavailable ? e.code : "SOURCE_UNAVAILABLE";
      total.unavailable++;
      await tenantTx(ctx, (tx) => serverAudit(tx, ctx, "upload_pickup_unavailable", "upload_pickup_source", src.id, `Pickup could not read its source (${code}); it tries again at the next run`, { sourceId: src.id, code }));
      opts.log?.({ event: "pickup_source_unavailable", orgId: src.orgId, sourceId: src.id, code });
      continue;
    }
    const seen = new Set((await withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => tx.select({ k: t.uploadPickupItems.itemKey }).from(t.uploadPickupItems)
      .where(and(eq(t.uploadPickupItems.orgId, src.orgId), eq(t.uploadPickupItems.sourceId, src.id))), { read: true })).map((r) => r.k));
    for (const item of items) {
      if (seen.has(item.key)) continue;
      counts.items++;
      let outcome: "stored" | "duplicate" | "refused" = "refused", code: string | null = item.refusal ?? null, uploadId: string | null = null;
      if (!item.refusal) {
        try {
          const r = await createUpload(ctx, { entityId: src.entityId, fileType: src.fileType as FileType, fileName: item.fileName, bytes: await item.read(), ...(src.bankAccountId ? { bankAccountId: src.bankAccountId } : {}) },
            `pickup:${item.key.slice(0, 48)}`, storage, { pickupSourceId: src.id });
          outcome = "stored"; uploadId = r.upload.id;
          if (src.templateId && r.upload.fileFormat !== "mt940" && r.upload.fileFormat !== "camt053") {
            // the template the Admin chose for this source maps the file; a template that does not fit leaves it for a person
            try {
              await setUploadMapping(ctx, r.upload.id, { templateId: src.templateId }, `pickup-map:${item.key.slice(0, 44)}`, storage);
              await validateUpload(ctx, r.upload.id, `pickup-val:${item.key.slice(0, 44)}`, storage);
              counts.validated++;
            } catch (e) { if (!(e instanceof RequestRefused)) throw e; code = e.code; }
          } else if (r.upload.fileFormat === "mt940" || r.upload.fileFormat === "camt053") {
            try { await validateUpload(ctx, r.upload.id, `pickup-val:${item.key.slice(0, 44)}`, storage); counts.validated++; } catch (e) { if (!(e instanceof RequestRefused)) throw e; code = e.code; }
          }
        } catch (e) {
          if (!(e instanceof RequestRefused)) throw e;
          outcome = e.code === "DUPLICATE_UPLOAD" ? "duplicate" : "refused";
          code = e.code;
        }
      }
      counts[outcome]++;
      await tenantTx(ctx, async (tx) => {
        await tx.insert(t.uploadPickupItems).values({ orgId: src.orgId, sourceId: src.id, itemKey: item.key, outcome, code: code && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null, uploadId, pickedAt: stampNow() })
          .onConflictDoNothing();
        if (outcome !== "stored" && item.refusal) {
          await serverAudit(tx, ctx, "upload_pickup_refused", "upload_pickup_source", src.id, `Pickup refused an item before reading it (${item.refusal})`, { sourceId: src.id, code: item.refusal, itemKey: item.key });
        }
      });
    }
    await tenantTx(ctx, async (tx) => {
      await tx.update(t.uploadPickupSources).set({ lastRunAt: now }).where(and(eq(t.uploadPickupSources.orgId, src.orgId), eq(t.uploadPickupSources.id, src.id)));
      await serverAudit(tx, ctx, "upload_pickup_run", "upload_pickup_source", src.id,
        `Pickup run: ${counts.items} new item(s), ${counts.stored} stored, ${counts.duplicate} duplicate(s), ${counts.refused} refused, ${counts.validated} validated`, { sourceId: src.id, ...counts });
    });
    opts.log?.({ event: "pickup_source_done", orgId: src.orgId, sourceId: src.id, counts });
    for (const k of Object.keys(counts) as (keyof typeof counts)[]) total[k] += counts[k];
  }
  return total;
}
