import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";

process.env.DATABASE_URL = process.env.CLEARLINE_TEST_RUNTIME_URL;
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-deployment-0123456789";
process.env.CLEARLINE_ORIGIN ??= "http://127.0.0.1:3199";

export const PASSWORD = "fictional-test-pass-01";
let ownerPool: Pool | undefined;
export function ownerDb(): Db {
  ownerPool ??= new Pool({ connectionString: process.env.CLEARLINE_TEST_OWNER_URL });
  return drizzle(ownerPool, { schema }) as Db;
}
export async function closeOwner() { await ownerPool?.end(); ownerPool = undefined; }

/** Truncate all data (owner; triggers disabled only for the reset) and seed two fictional organisations. */
export async function resetAndSeed() {
  const db = ownerDb();
  // Test-only reset as the schema owner: the owner can always alter its own tables (documented in the threat model);
  // the runtime role can never do this.
  const TABLES = `audit_events, investigation_notes, approval_decisions, approval_requests, idempotency_records, statement_imports,
    accounting_exports, accounting_proposals, repayment_allocations, funding_obligations, investigations, exceptions, reconciliation_records,
    settlement_evidence, provider_events, engine_records, payment_intents, org_engine_state, organization_memberships, organizations,
    sessions, accounts, verifications, users`;
  for (const tb of ["audit_events", "investigation_notes", "approval_decisions", "approval_requests"]) await db.execute(sql.raw(`ALTER TABLE ${tb} DISABLE TRIGGER USER`));
  await db.execute(sql.raw(`TRUNCATE ${TABLES} CASCADE`));
  for (const tb of ["audit_events", "investigation_notes", "approval_decisions", "approval_requests"]) await db.execute(sql.raw(`ALTER TABLE ${tb} ENABLE TRIGGER USER`));
  const { createOrganization, createUser, grantMembership } = await import("../../src/server/admin");
  await createOrganization(db, { slug: "lumen-demo", name: "Lumen (fictional)", seed: "sample" });
  await createOrganization(db, { slug: "harbour-demo", name: "Harbour (fictional)", seed: "sample" });
  const users = [
    ["ops@lumen.example", "lumen-demo", "payment_ops"], ["approver@lumen.example", "lumen-demo", "approver"],
    ["approver2@lumen.example", "lumen-demo", "approver"], ["finance@lumen.example", "lumen-demo", "finance"],
    ["viewer@lumen.example", "lumen-demo", "viewer"], ["admin@lumen.example", "lumen-demo", "admin"],
    ["ops@harbour.example", "harbour-demo", "payment_ops"], ["approver@harbour.example", "harbour-demo", "approver"],
  ] as const;
  const ids: Record<string, string> = {};
  for (const [email, org, role] of users) {
    ids[email] = await createUser(db, { email, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
    await grantMembership(db, { orgSlug: org, email, role });
  }
  return ids;
}

export function principal(ids: Record<string, string>, email: string) {
  return { userId: ids[email], name: email, email };
}
