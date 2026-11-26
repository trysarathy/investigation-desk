/**
 * v1 founder decision 9 against PostgreSQL 16: the duplicate check for bank statement lines includes the bank account.
 * The same line in two accounts is two lines; again in the same account a duplicate; a line first imported with NO
 * account (a simulated pre-0039 upload) keeps its old fingerprint and line id, and a re-upload of it to any account of
 * the entity is still a duplicate. Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetBlank } from "./harness";
import { accountOf, addTestBankAccount, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { analyseUpload, createUpload, decideUpload, rowsDigest, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { uploadStorage } from "../../src/server/storage";
import type { Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let n = 0;
const key = () => `dup-key-${++n}-${Date.now()}`;
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}

let fin: TenantContext, approver: TenantContext;
/** ENT-LIVE-SG (SGD): its SGD account and a second SGD account. */
let sgd: string, sgd2: string;

async function pipeline(entityId: string, bankAccountId: string, fileName: string, bytes: Uint8Array, mapping: Mapping) {
  const up = await createUpload(fin, { entityId, fileType: "bank_statement", fileName, bytes, bankAccountId }, key());
  await setUploadMapping(fin, up.upload.id, { mapping }, key());
  const v = (await validateUpload(fin, up.upload.id, key())).body;
  return { id: up.upload.id, v };
}
async function confirmAndNormalise(id: string, v: { contentSha256: string; rowsSha256: string | null }) {
  await decideUpload(approver, id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return (await normaliseUpload(approver, id, key())).body;
}
/** A small SGD statement (semicolons, decimal comma): two credits and a fee; `tag` makes the FILE differ, not its lines. */
const bankCsv = (lines: string[], tag: string) => new TextEncoder().encode(["Buchungstag;Valuta;Betrag;Verwendungszweck;Auftraggeber", ...lines, `07.11.2026;07.11.2026;(1,00);FEE ${tag};`].join("\n") + "\n");
const LINES = (k: string) => [`03.11.2026;03.11.2026;4.008,16;PAYOUT ${k};Provider A (fictional)`, `05.11.2026;05.11.2026;1.234,50;TRANSFER ${k};Fictional Payer`];
const linesOf = (uploadId: string) => ownerDb().select({ id: t.bankLines.lineId, a: t.bankLines.bankAccountId, amount: t.bankLines.amountMinor }).from(t.bankLines)
  .where(and(eq(t.bankLines.orgId, s.orgs.a), eq(t.bankLines.uploadId, uploadId))).orderBy(t.bankLines.amountMinor);

beforeAll(async () => {
  useTestStorage();
  await resetBlank();
  s = await seedLiveMerchants(ownerDb());
  fin = await liveCtx(s, "finance@live-a.example", "a");
  approver = await liveCtx(s, "approver@live-a.example", "a");
  sgd = await accountOf(s.orgs.a, "ENT-LIVE-SG");
  sgd2 = await addTestBankAccount(ownerDb(), s.orgs.a, "ENT-LIVE-SG", "SGD", "ENT-LIVE-SG second SGD account (fictional)", "0004");
}, 120_000);
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("the duplicate check includes the bank account", () => {
  it("the same statement to a second account of the entity is not a duplicate: two accounts, two sets of lines", async () => {
    const one = await pipeline("ENT-LIVE-SG", sgd, "s1.csv", bankCsv(LINES("two-accounts"), "a"), sc.SG_BANK_MAPPING);
    expect(one.v.counts).toMatchObject({ rows: 3, accepted: 3, duplicate: 0 });
    expect((await confirmAndNormalise(one.id, one.v)).counts.created).toBe(2);
    const two = await pipeline("ENT-LIVE-SG", sgd2, "s2.csv", bankCsv(LINES("two-accounts"), "b"), sc.SG_BANK_MAPPING);
    expect(two.v.counts).toMatchObject({ rows: 3, accepted: 3, duplicate: 0 });
    expect((await confirmAndNormalise(two.id, two.v)).counts.created).toBe(2);
    const a = await linesOf(one.id), b = await linesOf(two.id);
    expect(a.map((x) => x.a)).toEqual([sgd, sgd]);
    expect(b.map((x) => x.a)).toEqual([sgd2, sgd2]);
    expect(a.map((x) => x.amount)).toEqual(b.map((x) => x.amount));
    expect(a.map((x) => x.id).filter((id) => b.some((y) => y.id === id))).toEqual([]); // distinct line ids
  });
  it("the same lines to the same account again: those rows are duplicates, nothing imported twice (an identical FILE is refused as before)", async () => {
    const again = await pipeline("ENT-LIVE-SG", sgd, "s1-again.csv", bankCsv(LINES("two-accounts"), "c"), sc.SG_BANK_MAPPING);
    expect(again.v.counts).toMatchObject({ rows: 3, accepted: 1, warning: 0, duplicate: 2 }); // the two credits; the new fee line is accepted
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "bank_statement", bankAccountId: sgd2, fileName: "same-file.csv", bytes: bankCsv(LINES("two-accounts"), "a") }, key()), "DUPLICATE_UPLOAD");
  });
  it("a line imported by an upload with no account (pre-0039) keeps its old fingerprint, and a re-upload to any account is a duplicate", async () => {
    const legacy = await pipeline("ENT-LIVE-SG", sgd, "legacy.csv", bankCsv(LINES("pre-0039"), "legacy"), sc.SG_BANK_MAPPING);
    // Simulate an upload made before migration 0039: no account, and the fingerprints it had then (owner, test only)
    const [u] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, legacy.id));
    const bytes = await uploadStorage().get(s.orgs.a, u.storageKey!);
    const old = await ownerDb().transaction((tx) => analyseUpload(tx, { ...u, bankAccountId: null }, bytes));
    const stored = await ownerDb().select().from(t.uploadRows).where(eq(t.uploadRows.uploadId, legacy.id));
    const keyed = new Map(stored.map((r) => [r.rowNumber, r.rowHash]));
    expect(old.rows.every((r) => r.rowHash !== keyed.get(r.rowNumber))).toBe(true); // the account changed every fingerprint
    const newRows = stored.map((r) => ({ ...r, rowHash: old.rows.find((x) => x.rowNumber === r.rowNumber)!.rowHash }));
    await ownerDb().transaction(async (tx) => {
      await tx.execute(sql`alter table uploads disable trigger uploads_bank_account`);
      await tx.execute(sql`alter table uploads disable trigger uploads_check`);
      await tx.execute(sql`alter table upload_rows disable trigger upload_rows_check`);
      await tx.update(t.uploads).set({ bankAccountId: null, rowsSha256: rowsDigest(newRows) }).where(eq(t.uploads.id, legacy.id));
      for (const r of newRows) await tx.update(t.uploadRows).set({ rowHash: r.rowHash }).where(and(eq(t.uploadRows.uploadId, legacy.id), eq(t.uploadRows.rowNumber, r.rowNumber)));
      await tx.execute(sql`alter table upload_rows enable trigger upload_rows_check`);
      await tx.execute(sql`alter table uploads enable trigger uploads_check`);
      await tx.execute(sql`alter table uploads enable trigger uploads_bank_account`);
    });
    const norm = await confirmAndNormalise(legacy.id, { contentSha256: legacy.v.contentSha256, rowsSha256: rowsDigest(newRows) });
    expect(norm.counts.created).toBe(2);
    const legacyLines = await linesOf(legacy.id);
    expect(legacyLines.map((l) => l.a)).toEqual([null, null]);
    // the legacy line id is the old fingerprint's (unchanged behaviour for NULL-account lines)
    for (const l of legacyLines) expect(old.rows.some((r) => r.rowHash && l.id === `FILE-${r.rowHash.slice(0, 32)}`)).toBe(true);
    for (const account of [sgd, sgd2]) {
      const re = await pipeline("ENT-LIVE-SG", account, `re-${account}.csv`, bankCsv(LINES("pre-0039"), `re-${account}`), sc.SG_BANK_MAPPING);
      expect(re.v.counts, account).toMatchObject({ rows: 3, accepted: 1, duplicate: 2 });
      // normalised: the duplicates point at the legacy lines; no second copy of a pre-0039 line
      expect((await confirmAndNormalise(re.id, re.v)).counts).toEqual({ created: 0, existing: 2, conflict: 0, skipped: 1 });
      const targets = await rows(sql`select target_ref from upload_rows where upload_id = ${re.id} and status = 'duplicate' order by row_number`);
      expect(targets.map((x) => x.target_ref).sort()).toEqual(legacyLines.map((l) => `bank_lines:${l.id}`).sort());
    }
    expect(Number((await rows(sql`select count(*)::int as n from bank_lines where org_id = ${s.orgs.a} and description like '%pre-0039%'`))[0].n)).toBe(2);
  });
});

