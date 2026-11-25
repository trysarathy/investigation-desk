/**
 * v1 phase 5.6: a merchant's data export holds everything Clearline holds for it — every row of every table that can
 * hold the merchant's data (the same information_schema list as deletion), its members' profiles, its audit log and
 * approvals, and every uploaded file byte for byte — and no secret, and no other merchant's row. It opens only with
 * Clearline's trusted public key and the passphrase. Fictional values only; keys and passphrase generated per run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { closeOwner, ownerDb, TOTP_SECRET } from "./harness";
import { useTestStorage } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { orgScopedTables } from "../../src/server/merchant-deletion";
import { exportMerchant } from "../../src/server/privacy/export";
import { openExport, untar, type TarEntry } from "../../src/server/privacy/archive";
import { uploadStorage } from "../../src/server/storage";
import { seedEveryTable, type ErasureSeed } from "./privacy-seed";

const PASS = "fictional export passphrase 0002";
let e: ErasureSeed;
const k = generateKeyPairSync("ed25519");
let out: Awaited<ReturnType<typeof exportMerchant>>;
let files: Map<string, TarEntry>;
const text = (name: string) => new TextDecoder().decode(files.get(name)!.data);
const lines = (name: string) => text(name).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

beforeAll(async () => {
  useTestStorage();
  e = await seedEveryTable("-export");
  out = await exportMerchant(ownerDb(), e.s.slugs.a, { passphrase: PASS, signingKey: k.privateKey });
  files = new Map(untar(openExport(out.archive, out.signature, { passphrase: PASS, trusted: k.publicKey }).plain).map((x) => [x.name, x]));
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("merchant data export", () => {
  it("holds every row of every table that holds the merchant's data, with matching counts and digests", async () => {
    const A = e.s.orgs.a;
    const manifest = JSON.parse(text("manifest.json"));
    expect(manifest).toMatchObject({ format: "clearline-merchant-export/1", organisation: { id: A, slug: e.s.slugs.a } });
    const expected: Record<string, number> = { organizations: 1 };
    for (const x of await orgScopedTables(ownerDb())) {
      const n = Number((await ownerDb().execute(sql`select count(*)::int as n from ${sql.identifier(x.table)} where ${sql.identifier(x.column)} = ${A}`)).rows[0].n);
      if (n) expected[x.table] = (expected[x.table] ?? 0) + n;
    }
    // the export's own audit event is written after the archive is built
    expected.audit_events -= 1;
    expect(out.summary.tables).toEqual(expected);
    expect(Object.keys(expected).length).toBeGreaterThan(55);
    for (const [tb, n] of Object.entries(expected)) expect(lines(`tables/${tb}.jsonl`).length, tb).toBe(n);
    for (const [tb, m] of Object.entries(manifest.tables as Record<string, { sha256: string }>)) {
      const { createHash } = await import("node:crypto");
      expect(createHash("sha256").update(files.get(`tables/${tb}.jsonl`)!.data).digest("hex"), tb).toBe(m.sha256);
    }
    // the audit log, approvals and decisions are in it; the provider's rows about this merchant too
    expect(lines("tables/audit_events.jsonl").map((r) => r.action)).toContain("membership_granted");
    expect(lines("tables/approval_decisions.jsonl")[0]).toMatchObject({ decision: "approve" });
    expect(lines("tables/merchant_invitations.jsonl")[0]).toMatchObject({ org_id: e.s.orgs.providerA, merchant_org_id: A });
    // chain reads (monthly partitions) through their parent
    expect(lines("tables/chain_reads.jsonl").length).toBeGreaterThan(0);
  });

  it("holds the members' profiles and every uploaded file byte for byte", async () => {
    const people = lines("people/users.jsonl");
    expect(people.map((p) => p.email).sort()).toEqual([...e.aEmails].sort());
    expect(Object.keys(people[0]).sort()).toEqual(["created_at", "email", "email_verified", "id", "last_sign_in_at", "name", "two_factor_enabled"]);
    const ups = await ownerDb().select().from(t.uploads).where(and(eq(t.uploads.orgId, e.s.orgs.a), isNotNull(t.uploads.storageKey)));
    expect(ups.length).toBe(5);
    expect(out.summary.files).toBe(5);
    for (const u of ups) {
      const original = await uploadStorage().get(u.orgId, u.storageKey!);
      expect(Buffer.from(files.get(`files/${u.id}`)!.data).equals(Buffer.from(original)), u.id).toBe(true);
    }
  });

  it("holds no secret and nothing of another merchant", async () => {
    const all = Buffer.concat([...files.values()].map((f) => Buffer.from(f.data))).toString("latin1");
    const ids = sql`(${sql.join(e.aUsers.map((u) => sql`${u}`), sql`, `)})`;
    const secrets = (await ownerDb().execute(sql`select a.password as p from accounts a where a.user_id in ${ids} and a.password is not null
      union all select token from sessions where user_id in ${ids} union all select secret from two_factors where user_id in ${ids}
      union all select token_sha256 from org_invitations where org_id = ${e.s.orgs.a} union all select token_sha256 from auth_tokens where user_id in ${ids}`)).rows.map((r) => String(r.p));
    expect(secrets.length).toBeGreaterThan(8);
    for (const s of [...secrets, TOTP_SECRET]) expect(all.includes(s), "a secret is in the export").toBe(false);
    for (const other of [e.s.orgs.b, e.s.slugs.b, "finance-export@live-b.example"]) expect(all.includes(other), other).toBe(false);
  });

  it("is recorded in the merchant's audit log with counts only, and refuses any other key", async () => {
    const [ev] = await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, e.s.orgs.a), eq(t.auditEvents.action, "merchant_exported")));
    expect(ev.details).toMatchObject({ files: 5, people: 6 });
    expect(JSON.stringify(ev.details)).not.toContain("@");
    const other = generateKeyPairSync("ed25519");
    expect(() => openExport(out.archive, out.signature, { passphrase: PASS, trusted: other.publicKey })).toThrow(/signature/);
    await expect(exportMerchant(ownerDb(), e.s.slugs.providerA, { passphrase: PASS, signingKey: k.privateKey })).rejects.toThrow(/merchant/);
  });
});
