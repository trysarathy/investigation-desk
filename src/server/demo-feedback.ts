import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "./db/schema";
import { demoBuild } from "./demo-build";
import { withTenant, type TenantContext } from "./tenant";
import { ROLE_LABELS } from "./authz";

/**
 * Demo build only: presenter feedback notes ("Note feedback" on every screen). POST /api/control/demo/feedback answers
 * 404 in any other build before this module is loaded, and the bundler drops it (scripts/build/check-chain-recording.mjs
 * --marker demo). A note is saved only for a DEMO organisation (data mode 'demo'), as the signed-in member with their
 * current role (from the session, never the request); the insert policy of drizzle/0032_demo_feedback.sql checks the
 * same again in the database. Nothing else changes: a note is not an action on any record.
 */
export const DEMO_FEEDBACK_MARKER = "clearline-demo[demo-build-only]";
/** The feedback note's own marker (scripts/build/check-chain-recording.mjs --marker feedback). */
export const DEMO_FEEDBACK_ONLY_MARKER = "clearline-demo-feedback[demo-build-only]";

export class DemoFeedbackRefused extends Error {
  readonly marker = DEMO_FEEDBACK_ONLY_MARKER;
  constructor(readonly status: 400 | 404, readonly code: string, message: string) { super(message); }
}

export const FeedbackInput = z.object({
  screen: z.string().trim().min(1).max(200),
  route: z.string().max(500).regex(/^\/[^\s]*$/, "a path on this site"),
  note: z.string().trim().min(1, "Write a note first.").max(2000),
}).strict();

export interface SavedFeedback { id: string; screen: string; route: string; role: string; at: string }

export async function saveDemoFeedback(ctx: TenantContext, body: unknown): Promise<SavedFeedback> {
  if (!demoBuild()) throw new DemoFeedbackRefused(404, "NOT_FOUND", "Not found.");
  const p = FeedbackInput.safeParse(body);
  if (!p.success) throw new DemoFeedbackRefused(400, "INVALID_REQUEST", p.error.issues[0]?.message ?? "Send a screen, its route and a note.");
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [o] = await tx.select({ dataMode: t.organizations.dataMode }).from(t.organizations).where(eq(t.organizations.id, ctx.orgId));
    if (o?.dataMode !== "demo") throw new DemoFeedbackRefused(404, "NOT_FOUND", "Not found.");
    const [row] = await tx.insert(t.demoFeedback).values({ orgId: ctx.orgId, userId: ctx.userId, role: ctx.role, screen: p.data.screen, route: p.data.route, note: p.data.note }).returning();
    return { id: row.id, screen: row.screen, route: row.route, role: ROLE_LABELS[ctx.role], at: row.createdAt.toISOString() };
  });
}

/** The organisation's notes, newest first (members of a demo organisation; RLS scopes them). */
export async function listDemoFeedback(ctx: TenantContext) {
  if (!demoBuild()) throw new DemoFeedbackRefused(404, "NOT_FOUND", "Not found.");
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => tx.select().from(t.demoFeedback).where(eq(t.demoFeedback.orgId, ctx.orgId)).orderBy(desc(t.demoFeedback.createdAt)), { read: true });
}
