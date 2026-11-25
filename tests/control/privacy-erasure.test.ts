/**
 * v1 phase 5.6: deleting a merchant leaves NOTHING but the minimal retained records. A fictional merchant A is seeded
 * across EVERY table of the schema (tests/control/privacy-seed.ts; a table that holds no trace of A must be listed as
 * global with a reason, so a table added later fails here until it is covered). After the deletion, every base table
 * read from information_schema (partitions through their parent) is scanned, whole row as text, for A's id, slug and
 * name, its members' ids, e-mails (and their SHA-256) and fictional names, and the free-text marker; the upload
 * storage is scanned for A's folder. The retained records keep the order of events, the preparer/approver separation
 * and the payload digests, and refuse deletion inside the retention period. Merchant B and the provider's other rows
 * are untouched. Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb } from "./harness";
import { liveCtx, useTestStorage } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { allTables, deleteMerchant, findMerchantTraces, planMerchantDeletion } from "../../src/server/merchant-deletion";
import { orgRef, pseudonym } from "../../src/server/privacy/retained";
import { uploadPreview } from "../../src/server/uploads";
import { outboxSenderIn } from "../../src/server/email/outbox";
import { LIMITS, keyHash, type Scope } from "../../src/server/rate-limit";
import { GLOBAL_TABLES, MARKER, seedEveryTable, type ErasureSeed } from "./privacy-seed";

let dir: string;
let e: ErasureSeed;

/** Every base table (partitions through their parent) with the number of rows whose text contains any needle. */
async function scan(needles: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const tb of await allTables(ownerDb())) {
    const n = Number((await ownerDb().execute(sql`select count(*)::int as n from ${sql.identifier(tb)} x where ${sql.join(needles.map((v) => sql`strpos(x::text, ${v}) > 0`), sql` or `)}`)).rows[0].n);
    if (n) out[tb] = n;
  }
  return out;
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** Rate-limit counters store HMACs of an account's e-mail or user id under the server secret (rate-limit.ts). */
const rateHashes = () => (Object.keys(LIMITS) as Scope[]).flatMap((s) => [...e.aUsers, ...e.aEmails].map((k) => keyHash(s, k)));
const needles = () => [e.s.orgs.a, e.s.slugs.a, "Merchant A (fictional)", ...e.aUsers, ...e.aEmails, ...e.aEmails.map(sha), ...rateHashes(), ...e.aNames, MARKER, MARKER.toLowerCase()];
async function rowsOf(where: (tb: string) => ReturnType<typeof sql>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const tb of await allTables(ownerDb())) {
    const rows = (await ownerDb().execute(sql`select x::text as r from ${sql.identifier(tb)} x where ${where(tb)} order by 1`)).rows.map((r) => String(r.r));
    if (rows.length) out[tb] = sha(rows.join("\n"));
  }
  return out;
}

beforeAll(async () => {
  dir = useTestStorage();
  e = await seedEveryTable("-erase");
  // wave 2: the one local stand-in outbox is the email_outbox table (w1-27; the folder form was removed): one message
  // to A's member, one to B's, through the one EmailSender's owner-transaction form
  await outboxSenderIn(ownerDb()).send({ to: e.aEmails[2], subject: "Invitation (fictional)", text: "Join Merchant A (fictional)" });
  await outboxSenderIn(ownerDb()).send({ to: "finance-erase@live-b.example", subject: "Invitation (fictional)", text: "Join Merchant B (fictional)" });
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("merchant deletion leaves nothing but the minimal retained records", () => {
  let bBefore: Record<string, string>;
  let providerOther: Record<string, string>;

  it("the seed reaches every table that can hold a merchant's data (a new table must be seeded or listed as global)", async () => {
    const found = await scan(needles());
    const missing = (await allTables(ownerDb())).filter((tb) => !found[tb] && !GLOBAL_TABLES[tb] && !["merchant_deletions", "retained_records", "retention_runs"].includes(tb));
    expect(missing, "tables with no trace of the seeded merchant: seed them in privacy-seed.ts or list them in GLOBAL_TABLES with a reason").toEqual([]);
    expect(Object.keys(found).length).toBeGreaterThan(60);
    expect(readdirSync(path.join(dir, e.s.orgs.a)).length).toBe(5);
    // partitions of chain_reads hold A's rows (reached through the parent)
    const parts = (await ownerDb().execute(sql`select count(*)::int as n from chain_reads where org_id = ${e.s.orgs.a}`)).rows[0].n;
    expect(Number(parts)).toBeGreaterThan(0);
  });

  it("deletes the merchant; the scan of every table and of the storage finds no trace", async () => {
    const B = e.s.orgs.b, P = e.s.orgs.providerA;
    bBefore = await rowsOf(() => sql`strpos(x::text, ${B}) > 0`);
    providerOther = await rowsOf((tb) => (tb === "audit_events" ? sql`x.org_id = ${P} and strpos(x::text, ${e.s.orgs.a}) = 0` : sql`strpos(x::text, ${P}) > 0 and strpos(x::text, ${e.s.orgs.a}) = 0`));
    const plan = await planMerchantDeletion(ownerDb(), e.s.slugs.a);
    const r = await deleteMerchant(ownerDb(), e.s.slugs.a, e.s.slugs.a);
    expect(r.residue).toEqual({});
    expect(r.users).toBe(6);
    expect(r.files).toBe(5);
    expect(r.retained).toBe(plan.retained + 1); // + the provider's audit event that named A
    expect(JSON.stringify(r)).not.toContain(e.s.orgs.a);
    for (const k of ["sessions", "accounts", "two_factors", "passkeys", "auth_tokens", "verifications", "login_failures", "auth_rate_events", "email_outbox"]) expect(r.tables[k], k).toBeGreaterThan(0);

    expect(await scan(needles())).toEqual({});
    expect(existsSync(path.join(dir, e.s.orgs.a))).toBe(false);
    expect((await ownerDb().execute(sql`select to_address from email_outbox where to_address in (${e.aEmails[2]}, 'finance-erase@live-b.example') order by 1`)).rows.map((x) => x.to_address)).toEqual(["finance-erase@live-b.example"]);
    expect(await findMerchantTraces(ownerDb(), { orgId: e.s.orgs.a, slug: e.s.slugs.a, name: "Merchant A (fictional)", userIds: e.aUsers, emails: e.aEmails })).toEqual({});
  });

  it("merchant B and the provider's other rows are exactly as they were; B's file still opens", async () => {
    expect(await rowsOf(() => sql`strpos(x::text, ${e.s.orgs.b}) > 0`)).toEqual(bBefore);
    const P = e.s.orgs.providerA;
    expect(await rowsOf((tb) => (tb === "audit_events" ? sql`x.org_id = ${P} and strpos(x::text, ${e.s.orgs.a}) = 0` : sql`strpos(x::text, ${P}) > 0 and strpos(x::text, ${e.s.orgs.a}) = 0`))).toEqual(providerOther);
    const finB = await liveCtx(e.s, "finance@live-b.example", "b");
    expect((await uploadPreview(finB, e.bUpload)).preview.rows).toHaveLength(1);
    // every trigger is back on: an append-only table refuses an update again
    await expect(ownerDb().execute(sql`update audit_events set summary = 'x' where org_id = ${e.s.orgs.b}`)).rejects.toThrow();
  });

  it("keeps the audit trail and approvals in minimal form: order, kinds, separation of duties, digests; no free text", async () => {
    const A = e.s.orgs.a;
    const [receipt] = await ownerDb().select().from(t.merchantDeletions).where(eq(t.merchantDeletions.orgRef, orgRef(A)));
    expect(receipt).toBeDefined();
    const kept = await ownerDb().select().from(t.retainedRecords).where(eq(t.retainedRecords.deletionId, receipt.id));
    expect(kept.length).toBe(receipt.retained);
    const audit = kept.filter((k) => k.kind === "audit_event").sort((a, b) => a.position - b.position);
    expect(audit.map((k) => k.record.action)).toContain("organization_created");
    expect(audit.map((k) => k.record.action)).toContain("membership_granted");
    // the provider's event about A is kept with the provider only as a digest
    expect(audit.some((k) => k.record.action === "merchant_invited" && k.record.otherOrgRef === orgRef(e.s.orgs.providerA))).toBe(true);
    for (const k of kept) {
      expect(Object.keys(k.record)).not.toContain("summary");
      expect(k.retainUntil.getUTCFullYear() - k.occurredAt.getUTCFullYear()).toBe(7);
    }
    // the merchant (holding its org id) can find its own records; the preparer is not the approver
    const fin = e.s.users["finance@live-a.example"], approver = e.s.users["approver@live-a.example"];
    const req = kept.find((k) => k.kind === "approval_request")!.record;
    const dec = kept.find((k) => k.kind === "approval_decision")!.record;
    expect(req.requestedByRef).toBe(pseudonym(A, "user", fin));
    expect(dec.decidedByRef).toBe(pseudonym(A, "user", approver));
    expect(dec.requestRef).toBe(req.requestRef);
    expect(dec.payloadSha256).toBe(req.payloadSha256);
    expect(dec.decidedByRef).not.toBe(req.requestedByRef);
    // inside the retention period a retained record cannot be deleted or changed, not even by the owner
    await expect(ownerDb().execute(sql`delete from retained_records where deletion_id = ${receipt.id}`)).rejects.toThrow();
    await expect(ownerDb().execute(sql`update retained_records set record = '{}'::jsonb where deletion_id = ${receipt.id}`)).rejects.toThrow();
    await expect(ownerDb().execute(sql`update merchant_deletions set retained = 0 where id = ${receipt.id}`)).rejects.toThrow();
    // nobody but the owner can read them
    for (const role of ["clearline_runtime", "clearline_jobs", "clearline_app"]) {
      const p = (await ownerDb().execute(sql`select has_table_privilege(${role}, 'retained_records', 'SELECT') as a, has_table_privilege(${role}, 'merchant_deletions', 'SELECT') as b, has_table_privilege(${role}, 'retention_runs', 'SELECT') as c`)).rows[0];
      expect(p, role).toEqual({ a: false, b: false, c: false });
    }
  });
});
