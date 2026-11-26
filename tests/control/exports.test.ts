/**
 * rc7 phase 3b exports against PostgreSQL 16, on a LIVE merchant filled through the real upload pipeline: draft
 * journal files in Xero's and QuickBooks' import layouts and the month-end pack (ZIP). Finance, an Approver or an Admin
 * only (rc8 founder decision 3);
 * another merchant's entity is refused; nothing is posted (proposals unchanged); the audit row holds ids, counts and
 * hashes, never file contents. Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { liveKey, seedSgLive, sgChain, type LiveSg } from "./live-data";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { journalDraftFile, monthEndPack } from "../../src/server/exports";
import { merchantShell } from "../../src/server/merchant-ui";
import { updateMerchantPolicy, runReconciliation } from "../../src/server/merchant";
import { readStoreZip } from "../../src/lib/clearline/exports/zip";
import { DRAFT_MARKING, QBO_HEADERS, XERO_HEADERS } from "../../src/lib/clearline/exports/journal-drafts";
import { RULE_SET_VERSION } from "../../src/server/runs";

const MARKER = "ZQX-EXPORT-MARKER-5521";
let s: LiveSeed;
let live: LiveSg;
let month: string;

async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const parseCsv = (body: string) => body.trim().split("\r\n").map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, "\"")));

beforeAll(async () => {
  useTestStorage();
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-exp");
  live = await seedSgLive(s, MARKER);
  // the merchant's Admin turns the imported-statement flag on for this entity so the batch verifies and a settlement
  // journal is proposed (an Admin's decision; it stays off by default)
  await updateMerchantPolicy(live.admin, live.entityId, { allowImportedBankLinesAsVerified: true }, 1, liveKey());
  await runReconciliation(live.ops, live.entityId, liveKey(), { chain: sgChain() });
  month = (await merchantShell(live.ops)).entities.find((e) => e.id === live.entityId)!.months[0];
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("draft journal files (sandbox only, nothing posted)", () => {
  it("Xero and QuickBooks layouts: balanced, marked DRAFT on every row, from proposed journals pending sign-off", async () => {
    const before = await ownerDb().select({ id: t.merchantJournalProposals.id, status: t.merchantJournalProposals.status }).from(t.merchantJournalProposals).where(eq(t.merchantJournalProposals.orgId, live.fin.orgId));
    expect(before.length).toBeGreaterThan(0);
    const x = await journalDraftFile(live.fin, live.entityId, month, "xero");
    const xr = parseCsv(x.body);
    expect(xr[0]).toEqual(XERO_HEADERS);
    expect(x.journals).toBeGreaterThan(0);
    for (const r of xr.slice(1)) { expect(r[0]).toContain(DRAFT_MARKING); expect(r[1]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/); expect(r[5]).toMatch(/^-?\d+\.\d{2}$/); }
    // per journal, the signed amounts sum to zero (exactly, in cents)
    const byJournal = new Map<string, bigint>();
    for (const r of xr.slice(1)) { const id = r[0].split(" | ")[1]; byJournal.set(id, (byJournal.get(id) ?? 0n) + BigInt(r[5].replace(".", ""))); }
    expect([...byJournal.values()].every((v) => v === 0n)).toBe(true);
    const q = await journalDraftFile(live.approver, live.entityId, month, "quickbooks");
    const qr = parseCsv(q.body);
    expect(qr[0]).toEqual(QBO_HEADERS);
    const debits = qr.slice(1).reduce((a, r) => a + BigInt((r[3] || "0").replace(".", "")), 0n), credits = qr.slice(1).reduce((a, r) => a + BigInt((r[4] || "0").replace(".", "")), 0n);
    expect(debits).toBe(credits);
    // nothing was posted or changed
    const after = await ownerDb().select({ id: t.merchantJournalProposals.id, status: t.merchantJournalProposals.status }).from(t.merchantJournalProposals).where(eq(t.merchantJournalProposals.orgId, live.fin.orgId));
    expect(after).toEqual(before);
    expect(after.every((j) => j.status === "proposed" || j.status === "superseded")).toBe(true);
  });

  it("only Finance, an Approver or an Admin may export; another merchant's entity is refused", async () => {
    for (const c of [live.ops, live.viewer]) await refused(journalDraftFile(c, live.entityId, month, "xero"), "ACCESS_403");
    // rc8 founder decision 3: an Admin exports too (rc7: Finance or an Approver)
    expect((await journalDraftFile(live.admin, live.entityId, month, "xero")).journals).toBeGreaterThan(0);
    const finB = await liveCtx(s, "finance@live-b.example", "b");
    await refused(journalDraftFile(finB, live.entityId, month, "xero"), "ACCESS_404");
    await refused(monthEndPack(finB, live.entityId, month), "ACCESS_404");
    await expect(journalDraftFile(live.fin, live.entityId, "2026-13", "xero")).rejects.toThrow();
  });
});

describe("month-end pack", () => {
  it("one ZIP: bridges, exceptions with owner/reason/next step, journal proposals, drafts, provenance of every file, ledger comparison, evidence, manifest", async () => {
    const p = await monthEndPack(live.approver, live.entityId, month);
    const files = readStoreZip(p.body);
    expect([...files.keys()]).toEqual(["manifest.json", "bridges.csv", "exceptions.csv", "journal-proposals.csv", "xero-manual-journal-DRAFT.csv", "quickbooks-journal-DRAFT.csv", "provenance.csv", "ledger-invoices.csv", "evidence-pack.json"]);
    const manifest = JSON.parse(dec(files.get("manifest.json")!));
    expect(manifest).toMatchObject({ label: "Your data", month, ruleSetVersion: RULE_SET_VERSION, policyRevision: 2, postingRuleStatus: "pending_sign_off" });
    for (const f of manifest.files) expect(f.sha256).toBe((await import("node:crypto")).createHash("sha256").update(files.get(f.name)!).digest("hex"));
    const bridges = parseCsv(dec(files.get("bridges.csv")!));
    expect(bridges.length).toBeGreaterThan(1);
    expect(bridges.slice(1).some((r) => r[9] === "true")).toBe(true);
    const ex = parseCsv(dec(files.get("exceptions.csv")!));
    expect(ex[0]).toEqual(["exception_id", "order_id", "owner_role", "owner", "reason", "next_step", "status", "opened_at"]);
    expect(ex.length).toBeGreaterThan(1);
    for (const r of ex.slice(1)) expect([r[2].length > 2, r[4].length > 10, r[5].length > 10]).toEqual([true, true, true]);
    const prov = parseCsv(dec(files.get("provenance.csv")!));
    expect(prov.slice(1).map((r) => r[0]).sort()).toEqual([...live.uploadIds].sort());
    const ups = await ownerDb().select().from(t.uploads).where(eq(t.uploads.orgId, live.fin.orgId));
    for (const r of prov.slice(1)) expect(r[4]).toBe(ups.find((u) => u.id === r[0])!.contentSha256);
    expect(dec(files.get("evidence-pack.json")!)).toContain("\"label\": \"Your data\"");
    // the same data gives the same files (the evidence pack's audit trail grows with each export, by design)
    const again = readStoreZip((await monthEndPack(live.fin, live.entityId, month)).body);
    for (const [name, data] of files) if (name !== "evidence-pack.json" && name !== "manifest.json") expect(Buffer.from(again.get(name)!).equals(Buffer.from(data)), name).toBe(true);
  });

  it("audit rows hold ids, counts and hashes only: no file contents, no cell values", async () => {
    const rows = await ownerDb().execute(sql`select action, summary, details::text as d from audit_events where org_id = ${live.fin.orgId} and action in ('merchant_month_end_pack_exported', 'merchant_journal_draft_exported')`);
    expect(rows.rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows.rows) {
      expect(`${r.summary} ${r.d}`).not.toContain(MARKER);
      expect(`${r.summary} ${r.d}`).not.toMatch(/Export Nov|statement\.csv|orders\.csv/);
    }
  });
});
