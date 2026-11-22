import "server-only";
import { z } from "zod";
import type { WorkspaceAction } from "@/lib/clearline";
import type { TenantContext } from "./tenant";

/**
 * The request body of POST /api/control/actions: the engine actions Clearline Control accepts (src/server/authz.ts
 * ACTION_PERMISSION), validated here before runAction checks the permission matrix and the engine its own rules.
 *
 * Objects strip unknown keys, so a body that adds `actorId`, `userId`, `orgId` or `ownerId` is accepted and those
 * fields are ignored: the actor is always the session user, and `assign_owner` always assigns the session user
 * ("assign to me"). There is no field through which a caller could name another person or organisation.
 */

const Id = z.string().min(1).max(64);
const Target = z.discriminatedUnion("kind", [z.object({ kind: z.literal("case"), id: Id }), z.object({ kind: z.literal("exception"), id: Id })]);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ControlActionBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign_owner"), target: Target }),
  z.object({ type: z.literal("add_note"), target: Target, text: Text(1000) }),
  z.object({ type: z.literal("request_info"), caseId: Id, from: Text(80), request: Text(300) }),
  z.object({
    type: z.literal("attach_evidence"), target: Target,
    evidence: z.object({
      kind: z.enum(["document_metadata", "funds_returned_confirmation", "beneficiary_correction", "note"]),
      description: Text(300),
      reference: Text(80).optional(),
      documentName: Text(120).optional(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    }),
  }),
  z.object({ type: z.literal("reopen"), target: Target, reason: Text(1000) }),
  // Accounting Bridge (finance prepares, an approver approves); the engine validates every field again.
  z.object({ type: z.literal("set_account_mapping"), entries: z.array(z.record(z.string(), z.unknown())).max(200), expectedRevision: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("open_accounting_period"), name: Text(80), from: Day, to: Day }),
  z.object({ type: z.literal("close_accounting_period"), periodId: Id }),
  z.object({ type: z.literal("propose_journal_entries"), periodId: Id.optional() }),
  z.object({ type: z.literal("approve_journal_proposal"), proposalId: Id, note: Text(1000).optional() }),
  z.object({ type: z.literal("reject_journal_proposal"), proposalId: Id, reason: Text(1000) }),
  z.object({ type: z.literal("confirm_not_imported"), proposalId: Id, note: Text(1000) }),
  z.object({ type: z.literal("export_journal"), periodId: Id }),
  z.object({ type: z.literal("record_posting"), proposalId: Id, externalReference: Text(120), note: Text(1000).optional() }),
  z.object({ type: z.literal("record_reconciliation_export"), from: Day, to: Day }),
]);
export type ControlActionBody = z.infer<typeof ControlActionBody>;

/** The engine action for a validated body, with every person filled in from the session. */
export function toWorkspaceAction(ctx: TenantContext, body: ControlActionBody): WorkspaceAction {
  if (body.type === "assign_owner") return { type: "assign_owner", target: body.target, ownerId: ctx.userId };
  return body as WorkspaceAction;
}
