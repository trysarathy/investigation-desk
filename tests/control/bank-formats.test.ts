/**
 * v1 phase 2.5 against PostgreSQL 16: camt.054 and BAI2 statements through the same upload pipeline as MT940 and
 * camt.053 — the account's currency and (new for these formats) its last four characters are checked before anything
 * is stored, a file naming several accounts is refused, no column mapping, the second person confirms, duplicates
 * are caught, reversals are flagged for review, and normalised lines stay "imported, not bank-authenticated"
 * (source file_import). Every value is fictional and built in the test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetBlank } from "./harness";
import { accountOf, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { buildBai2, type Bai2File } from "../clearline/ingest/bai2-builder";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, setUploadMapping, validateUpload, validationReport } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";

let s: LiveSeed;
let n = 0;
const key = () => `bf-key-${++n}-${Date.now()}`;
const utf8 = (x: string) => new TextEncoder().encode(x);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}

/** camt.054 for the SGD account (its IBAN ends in 0001, the account's last four): two credits, one debit, one reversal. */
const camt054 = (opts: { account?: string; ccy?: string; second?: string; id?: string } = {}) => {
  const ccy = opts.ccy ?? "SGD";
  const ntfctn = (acct: string, id: string) => `<Ntfctn><Id>${id}</Id><Acct><Id><IBAN>${acct}</IBAN></Id><Ccy>${ccy}</Ccy></Acct>
    <Ntry><Amt Ccy="${ccy}">1350.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><ValDt><Dt>2026-11-02</Dt></ValDt><AcctSvcrRef>FICT-054-A</AcctSvcrRef>
      <NtryDtls><TxDtls><Refs><EndToEndId>SG-1001</EndToEndId></Refs></TxDtls></NtryDtls></Ntry>
    <Ntry><Amt Ccy="${ccy}">2698.65</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><ValDt><Dt>2026-11-02</Dt></ValDt><AcctSvcrRef>FICT-054-B</AcctSvcrRef>
      <NtryDtls><TxDtls><Refs><EndToEndId>SG-1002</EndToEndId></Refs></TxDtls></NtryDtls></Ntry>
    <Ntry><Amt Ccy="${ccy}">25.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><ValDt><Dt>2026-11-02</Dt></ValDt><AcctSvcrRef>FICT-054-C</AcctSvcrRef>
      <AddtlNtryInf>WIRE FEE</AddtlNtryInf></Ntry>
    <Ntry><Amt Ccy="${ccy}">1350.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><RvslInd>true</RvslInd><Sts><Cd>BOOK</Cd></Sts><ValDt><Dt>2026-11-03</Dt></ValDt><AcctSvcrRef>FICT-054-D</AcctSvcrRef>
      <AddtlNtryInf>REVERSAL OF FICT-054-A</AddtlNtryInf></Ntry></Ntfctn>`;
  return utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>FICT-054-${opts.id ?? "1"}</MsgId></GrpHdr>
${ntfctn(opts.account ?? "SG00FICT0000000001", "FICT-N-1")}${opts.second ? ntfctn(opts.second, "FICT-N-2") : ""}</BkToCstmrDbtCdtNtfctn></Document>`);
};

/** BAI2 for the SGD account: two credits, a fee, and a returned deposit (555). */
const bai2Spec = (opts: { account?: string; ccy?: string; fileId?: string } = {}): Bai2File => ({
  fileId: opts.fileId ?? "FICT-BAI-SG-1",
  groups: [{ asOf: "261102", currency: opts.ccy ?? "SGD", accounts: [{
    account: opts.account ?? "SG-FICT-0001", status: [["010", 0n], ["015", 270365n]],
    txns: [
      { code: "195", amount: 135000n, bankRef: "FICTB-1", customerRef: "SG-1001", text: "INCOMING TRANSFER" },
      { code: "195", amount: 269865n, bankRef: "FICTB-2", customerRef: "SG-1002", text: "INCOMING TRANSFER" },
      { code: "495", amount: 2500n, bankRef: "FICTB-3", text: "WIRE FEE" },
      { code: "555", amount: 132000n, bankRef: "FICTB-4", customerRef: "SG-1003", text: "DEPOSITED ITEM RETURNED" },
    ],
  }] }],
});
const bai2 = (opts: Parameters<typeof bai2Spec>[0] = {}) => utf8(buildBai2(bai2Spec(opts)));

let sgd: string;
beforeAll(async () => {
  useTestStorage();
  await resetBlank();
  s = await seedLiveMerchants(ownerDb());
  sgd = await accountOf(s.orgs.a, "ENT-LIVE-SG");
}, 120_000);
afterAll(async () => { await closeDatabase(); await closeOwner(); });

const upload = async (fileName: string, bytes: Uint8Array) =>
  createUpload(await liveCtx(s, "finance@live-a.example", "a"), { entityId: "ENT-LIVE-SG", fileType: "bank_statement", bankAccountId: sgd, fileName, bytes }, key());

describe.each([
  ["camt.054", "camt054", "sg.xml", () => camt054(), 4, 3],
  ["BAI2", "bai2", "sg.bai", () => bai2(), 4, 3],
] as const)("%s through the whole pipeline", (_label, format, name, bytes, rowsN, acceptedN) => {
  it("stored with its format, needs no mapping, validates with the reversal flagged, and only a second person confirms", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a"), approver = await liveCtx(s, "approver@live-a.example", "a");
    const up = await upload(name, bytes());
    expect(up.upload).toMatchObject({ fileFormat: format, bankAccountId: sgd, status: "stored" });
    await refused(setUploadMapping(fin, up.upload.id, { mapping: {} }, key()), "NO_MAPPING_NEEDED");
    const v = (await validateUpload(fin, up.upload.id, key())).body;
    expect(v.counts).toMatchObject({ rows: rowsN, accepted: acceptedN, warning: 1, rejected: 0, duplicate: 0 });
    const report = await validationReport(fin, up.upload.id, { status: "warning" });
    expect(report.rows.map((r) => (r.reasonCodes as { code: string }[]).map((c) => c.code))).toEqual([["bank_reversal"]]);
    const decision = { decision: "confirm" as const, reason: "Statement checked (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! };
    await refused(decideUpload(fin, up.upload.id, decision, key()), "ACCESS_403");
    expect((await decideUpload(approver, up.upload.id, decision, key())).body).toMatchObject({ status: "confirmed", confirmedBy: approver.userId, bankAccountId: sgd });
    const norm = (await normaliseUpload(approver, up.upload.id, key())).body;
    expect(norm.counts.created).toBe(2); // the two SGD credits; the fee and the reversal/return are debits (skipped)
    const lines = await ownerDb().select({ a: t.bankLines.bankAccountId, src: t.bankLines.source, c: t.bankLines.currency }).from(t.bankLines)
      .where(and(eq(t.bankLines.orgId, s.orgs.a), eq(t.bankLines.uploadId, up.upload.id)));
    // imported by file and confirmed by a second person: never bank-authenticated
    expect(lines).toEqual([{ a: sgd, src: "file_import", c: "SGD" }, { a: sgd, src: "file_import", c: "SGD" }]);
  });
});

describe("refused before anything is stored (audited by code only)", () => {
  const count = async () => Number((await rows(sql`select count(*)::int as n from uploads`))[0].n);
  it.each([
    ["camt.054 in USD for the SGD account", "usd.xml", () => camt054({ ccy: "USD", id: "usd" }), "STATEMENT_CURRENCY_MISMATCH"],
    ["BAI2 in USD for the SGD account", "usd.bai", () => bai2({ ccy: "USD", fileId: "FICT-USD" }), "STATEMENT_CURRENCY_MISMATCH"],
    ["camt.054 naming another account", "other.xml", () => camt054({ account: "SG00FICT0000004321", id: "other" }), "STATEMENT_ACCOUNT_MISMATCH"],
    ["BAI2 naming another account", "other.bai", () => bai2({ account: "SG-FICT-4321", fileId: "FICT-OTHER" }), "STATEMENT_ACCOUNT_MISMATCH"],
    ["camt.054 covering two accounts", "two.xml", () => camt054({ second: "SG00FICT0000009999", id: "two" }), "FILE_MULTIPLE_ACCOUNTS"],
    ["BAI2 whose control total was changed", "bad.bai", () => utf8(buildBai2(bai2Spec({ fileId: "FICT-BAD" })).replace(/49,(\d+),/, (_m, d: string) => `49,${BigInt(d) + 1n},`)), "FILE_INVALID_BAI2"],
  ])("%s → %s", async (_name, fileName, bytes, code) => {
    const before = await count();
    await refused(upload(fileName, bytes()), code);
    expect(await count()).toBe(before);
    const audit = await rows(sql`select details from audit_events where action = 'upload_refused' and details->>'code' = ${code} order by seq desc limit 1`);
    expect(audit).toHaveLength(1);
    // the audit holds IDs, codes and counts only: no account number, file name or content
    expect(JSON.stringify(audit[0].details)).not.toMatch(/FICT|4321|9999|\.xml|\.bai/);
  });
});

describe("duplicates", () => {
  it("the same BAI2 file again is refused; the same lines in another file are marked duplicate", async () => {
    await refused(upload("sg-again.bai", bai2()), "DUPLICATE_UPLOAD");
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const up = await upload("sg-resent.bai", bai2({ fileId: "FICT-BAI-SG-RESENT" }));
    const v = (await validateUpload(fin, up.upload.id, key())).body;
    expect(v.counts).toMatchObject({ rows: 4, duplicate: 4, accepted: 0 });
  });
});
