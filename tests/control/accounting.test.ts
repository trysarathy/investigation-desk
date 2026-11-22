/**
 * Accounting Bridge persistence (Clearline Control, rc5) against a REAL PostgreSQL 16 — no mocks. Every change goes
 * through runAction (permission matrix → engine), every read through src/server/accounting.ts. FICTIONAL data only;
 * nothing is posted anywhere and no network call is made.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, principal, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { createUser, grantMembership, revokeMembership } from "../../src/server/admin";
import { runEngineAction } from "../../src/server/engine-store";
import { listPayments, RequestRefused, runAction } from "../../src/server/control";
import { accountingOverview, journalExportFile, reconciliationExportFile, STABLECOIN_ROUTE_RULES_PENDING_SIGN_OFF } from "../../src/server/accounting";
import { REDWOOD_REFERENCE } from "../../src/server/seed";
import type { JournalProposal, AccountingExportRecord } from "../../src/lib/clearline";

let ids: Record<string, string>;
const ctx = (email: string, org = email.endsWith("harbour.example") ? "harbour-demo" : "lumen-demo") => resolveTenant(principal(ids, email), org);
let k = 0;
const key = () => `acct-key-${++k}-${Date.now()}`;

async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return e; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return e; }
    const m = `${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ""}`;
    expect(m).toMatch(code);
    return e;
  }
  throw new Error(`expected refusal ${code}`);
}

/** Persisted rows of one organisation, read as that organisation's user (RLS) and filtered by org id as well. */
async function rows<T = Record<string, unknown>>(c: TenantContext, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await withTenant({ userId: c.userId, orgId: c.orgId }, (tx) => tx.execute(query))).rows as T[];
}
const proposalRows = async (c: TenantContext) => (await rows<{ record: JournalProposal; status: string; rule: string }>(c, sql`select record, status, rule from accounting_proposals where org_id = ${c.orgId} order by ord`));
const exportRows = async (c: TenantContext) => (await rows<{ record: AccountingExportRecord }>(c, sql`select record from accounting_exports where org_id = ${c.orgId} order by ord`)).map((r) => r.record);

/** Balanced per currency, in BigInt, from a persisted record. */
function balancedPerCurrency(p: JournalProposal): boolean {
  const net = new Map<string, bigint>();
  for (const l of p.lines) {
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor <= 0) return false;
    net.set(l.currency, (net.get(l.currency) ?? 0n) + BigInt(l.amountMinor) * (l.side === "debit" ? 1n : -1n));
  }
  return net.size > 0 && [...net.values()].every((v) => v === 0n);
}

/**
 * Evidence arriving through a server-controlled path (test fixture). Evidence never enters through runAction (no
 * provider simulation is available there); like the seed, the owner connection runs the engine action on the stored
 * workspace and persists the diff with provenance seed_fictional. "usr_maya" is a fictional seed operator.
 */
async function serverSideEngineAction(orgId: string, actorId: string, action: Parameters<typeof runEngineAction>[3]) {
  return ownerDb().transaction((tx) => runEngineAction(tx, orgId, actorId, action, { provenance: "seed_fictional" }));
}

let lumen: { finance: TenantContext; appr: TenantContext; appr2: TenantContext; viewer: TenantContext };
let redwood: string;
let periodId: string;
let initialIds: Set<string>;
let financeProposed: string[];

beforeAll(async () => {
  ids = await resetAndSeed();
  // A finance user in org B and a third, short-lived approver in org A (fictional).
  ids["finance@harbour.example"] = await createUser(ownerDb(), { email: "finance@harbour.example", name: "finance (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: "harbour-demo", email: "finance@harbour.example", role: "finance" });
  ids["approver3@lumen.example"] = await createUser(ownerDb(), { email: "approver3@lumen.example", name: "approver3 (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: "lumen-demo", email: "approver3@lumen.example", role: "approver" });
  lumen = { finance: await ctx("finance@lumen.example"), appr: await ctx("approver@lumen.example"), appr2: await ctx("approver2@lumen.example"), viewer: await ctx("viewer@lumen.example") };
  redwood = (await listPayments(lumen.viewer)).find((p) => p.reference === REDWOOD_REFERENCE)!.id;
  const v = await accountingOverview(lumen.viewer);
  periodId = v.periods.find((p) => p.status === "open")!.id;
  initialIds = new Set(v.proposals.map((p) => p.id));
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("seeded accounting setup", () => {
  it("the pilot seed carries the sample's mapping, one open period and the sample's proposals (by a seed actor); Redwood is pending", async () => {
    const v = await accountingOverview(lumen.viewer);
    expect(v.configured).toBe(true);
    expect(v.mapping?.entries.length).toBeGreaterThan(0);
    expect(v.periods.filter((p) => p.status === "open")).toHaveLength(1);
    expect(v.exports).toEqual([]);
    expect(v.proposals.every((p) => p.status === "proposed" && p.createdBy === "usr_maya")).toBe(true);
    expect(v.pending.length).toBeGreaterThan(0);
    expect(v.proposals.filter((p) => p.intentId === redwood)).toEqual([]);
  });
});

describe("finance proposes; the proposals persist", () => {
  it("finance proposes through runAction; new proposals are rows of accounting_proposals by the finance user", async () => {
    const r = await runAction(lumen.finance, { type: "propose_journal_entries" }, key());
    expect(r.body.outcome).toBe("proposals_created");
    financeProposed = r.body.createdIds;
    expect(financeProposed.length).toBeGreaterThan(0);
    const persisted = await proposalRows(lumen.finance);
    for (const id of financeProposed) {
      const row = persisted.find((x) => x.record.id === id)!;
      expect(row.record.createdBy).toBe(lumen.finance.userId);
      expect(row.status).toBe("proposed");
      expect(row.rule).toBe(row.record.ruleCode);
    }
  });

  it("survives a pool restart (closeDatabase) and reloads identically", async () => {
    const before = await accountingOverview(lumen.viewer);
    const rowsBefore = await proposalRows(lumen.viewer);
    await closeDatabase();
    const after = await accountingOverview(lumen.viewer);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(await proposalRows(lumen.viewer)).toEqual(rowsBefore);
  });

  it("every persisted proposal is balanced per currency (BigInt) and has one currency", async () => {
    const persisted = await proposalRows(lumen.viewer);
    expect(persisted.length).toBe(initialIds.size + financeProposed.length);
    for (const { record: p } of persisted) {
      expect(balancedPerCurrency(p), p.id).toBe(true);
      expect(new Set(p.lines.map((l) => l.currency))).toEqual(new Set([p.currency]));
    }
  });

  it("every proposal names evidence that exists in this organisation's persisted settlement_evidence / reconciliation_records", async () => {
    const c = lumen.viewer;
    const ev = await rows<{ id: string; kind: string }>(c, sql`select id, kind from settlement_evidence where org_id = ${c.orgId}`);
    const kind = (k: string) => new Set(ev.filter((e) => e.kind === k).map((e) => e.id));
    const lines = kind("statement_line"), chain = kind("chain_observation"), evRecords = kind("evidence_record");
    const allocs = new Set((await rows<{ id: string }>(c, sql`select id from reconciliation_records where org_id = ${c.orgId}`)).map((r) => r.id));
    const pevs = new Set((await rows<{ id: string }>(c, sql`select id from provider_events where org_id = ${c.orgId}`)).map((r) => r.id));
    const rpas = new Set((await rows<{ id: string }>(c, sql`select id from repayment_allocations where org_id = ${c.orgId}`)).map((r) => r.id));
    const known = new Set([...lines, ...chain, ...evRecords, ...allocs, ...pevs, ...rpas]);
    for (const { record: p } of await proposalRows(c)) {
      // independent evidence: a bank statement line (with its allocation) or a chain observation — never a provider report alone
      expect(p.evidence.statementLineIds.length + p.evidence.chainObservationIds.length, p.id).toBeGreaterThan(0);
      for (const id of p.evidence.statementLineIds) expect(lines.has(id), `${p.id} ${id}`).toBe(true);
      for (const id of p.evidence.chainObservationIds) expect(chain.has(id), `${p.id} ${id}`).toBe(true);
      for (const id of p.evidence.evidenceRecordIds) expect(evRecords.has(id), `${p.id} ${id}`).toBe(true);
      for (const id of p.evidence.allocationIds) expect(allocs.has(id), `${p.id} ${id}`).toBe(true);
      for (const id of p.evidence.providerEventIds) expect(pevs.has(id), `${p.id} ${id}`).toBe(true);
      for (const id of p.evidence.repaymentAllocationIds) expect(rpas.has(id), `${p.id} ${id}`).toBe(true);
      if (p.evidence.statementLineIds.length) expect(p.evidence.allocationIds.length, p.id).toBeGreaterThan(0);
      for (const l of p.lines) for (const id of l.evidenceIds) expect(known.has(id), `${p.id} line ${l.lineNo} ${id}`).toBe(true);
    }
  });

  it("the unrelated amount-only receipt gives no entry; its exception stays", async () => {
    const c = lumen.viewer;
    const [line] = await rows<{ id: string }>(c, sql`select id from settlement_evidence where org_id = ${c.orgId} and kind = 'statement_line' and record->>'lineId' = 'SIMBANK-0005'`);
    expect(line, "the sample's unreferenced SGD 20,000.00 receipt").toBeTruthy();
    const v = await accountingOverview(c);
    expect(v.notProposed.find((n) => n.refs.includes(line.id))?.code).toBe("NP_AMOUNT_ONLY_MATCH");
    for (const { record: p } of await proposalRows(c)) {
      expect(p.evidence.statementLineIds).not.toContain(line.id);
      expect(p.lines.flatMap((l) => l.evidenceIds)).not.toContain(line.id);
    }
  });

  it("Redwood's return gives no entry that debits supplier_payable (the supplier is never shown paid)", async () => {
    const mine = (await proposalRows(lumen.viewer)).map((r) => r.record).filter((p) => p.intentId === redwood);
    expect(mine.map((p) => p.ruleCode).sort()).toEqual(["JR_PAYOUT_DEBIT_NOT_DELIVERED", "JR_PAYOUT_RETURN_CREDIT"]);
    for (const p of mine) {
      expect(p.showsSupplierPaid).toBe(false);
      expect(p.lines.filter((l) => l.side === "debit" && l.accountKey === "supplier_payable")).toEqual([]);
    }
    expect(financeProposed.sort()).toEqual(mine.map((p) => p.id).sort());
  });
});

describe("maker-checker on journal approval", () => {
  let target: string;
  beforeAll(() => { target = financeProposed[0]; });

  it("finance cannot approve or reject (403 from the permission matrix); a viewer cannot propose", async () => {
    await refused(runAction(lumen.finance, { type: "approve_journal_proposal", proposalId: target }, key()), "ACCESS_403");
    await refused(runAction(lumen.finance, { type: "reject_journal_proposal", proposalId: target, reason: "finance attempt" }, key()), "ACCESS_403");
    await refused(runAction(lumen.viewer, { type: "propose_journal_entries" }, key()), "ACCESS_403");
    await refused(runAction(await ctx("ops@lumen.example"), { type: "propose_journal_entries" }, key()), "ACCESS_403");
  });

  it("an approver who proposed an entry cannot approve it (the engine refuses; the matrix lets only finance propose, so the approver proposes through the server-side engine path)", async () => {
    // New, independent evidence arrives server-side: the s4 stablecoin transfer reaches finality.
    const s4 = (await accountingOverview(lumen.viewer)).notProposed.find((n) => n.code === "NP_CHAIN_NOT_FINAL")!;
    const s4Intent = (await rows<{ intent_id: string }>(lumen.viewer, sql`select intent_id from settlement_evidence where org_id = ${lumen.viewer.orgId} and id = ${s4.refs[0]} and kind = 'chain_observation'`))[0].intent_id;
    await serverSideEngineAction(lumen.viewer.orgId, "usr_maya", { type: "simulate_provider_event", intentId: s4Intent });
    // The approver proposes it (the engine lets an approver propose; Clearline Control's matrix does not).
    const out = await serverSideEngineAction(lumen.viewer.orgId, lumen.appr.userId, { type: "propose_journal_entries" });
    expect(out.createdIds).toHaveLength(1);
    const sc = (await proposalRows(lumen.viewer)).find((r) => r.record.id === out.createdIds[0])!.record;
    expect(sc.ruleCode).toBe("JR_STABLECOIN_FINAL_TRANSFER");
    expect(sc.createdBy).toBe(lumen.appr.userId);
    expect(balancedPerCurrency(sc)).toBe(true);
    await refused(runAction(lumen.appr, { type: "approve_journal_proposal", proposalId: sc.id }, key()), "maker_checker_violation");
    expect((await proposalRows(lumen.viewer)).find((r) => r.record.id === sc.id)!.status).toBe("proposed");
    // a different approver may approve it
    await runAction(lumen.appr2, { type: "approve_journal_proposal", proposalId: sc.id, note: "Checked chain finality (fictional)" }, key());
    const row = (await proposalRows(lumen.viewer)).find((r) => r.record.id === sc.id)!;
    expect(row.status).toBe("approved");
    expect(row.record.approval?.by).toBe(lumen.appr2.userId);
  });

  it("stablecoin-route proposals carry pendingSignOff: true; no other proposal does", async () => {
    expect([...STABLECOIN_ROUTE_RULES_PENDING_SIGN_OFF].sort()).toEqual(["JR_STABLECOIN_FINAL_TRANSFER", "JR_STABLECOIN_ONRAMP_FUNDING"]);
    const v = await accountingOverview(lumen.viewer);
    const sc = v.proposals.filter((p) => p.ruleCode.startsWith("JR_STABLECOIN_"));
    expect(sc.length).toBeGreaterThan(0);
    for (const p of v.proposals) expect(p.pendingSignOff, `${p.id} ${p.ruleCode}`).toBe(sc.includes(p) ? true : undefined);
  });

  it("a different approver approves; the approval persists with that approver's user id", async () => {
    await runAction(lumen.appr, { type: "approve_journal_proposal", proposalId: target, note: "Debit and return credit on the statement (fictional)" }, key());
    await closeDatabase();
    const row = (await proposalRows(lumen.viewer)).find((r) => r.record.id === target)!;
    expect(row.status).toBe("approved");
    expect(row.record.approval?.by).toBe(lumen.appr.userId);
    expect(row.record.createdBy).toBe(lumen.finance.userId);
    const audit = await rows<{ actor_user_id: string; summary: string }>(lumen.viewer, sql`select actor_user_id, summary from audit_events where org_id = ${lumen.viewer.orgId} and source = 'engine' and action = 'journal.approved' and entity_id = ${target}`);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(lumen.appr.userId);
  });

  it("a revoked approver cannot approve: no new tenant context, and a context resolved before revocation is refused", async () => {
    const stale = await ctx("approver3@lumen.example");
    const other = financeProposed[1];
    await revokeMembership(ownerDb(), { orgSlug: "lumen-demo", email: "approver3@lumen.example" });
    await refused(ctx("approver3@lumen.example"), /ACCESS_40[34]/);
    // RLS: a revoked member's transaction sees none of the organisation's rows, so the load is refused as not found (404).
    await refused(runAction(stale, { type: "approve_journal_proposal", proposalId: other }, key()), /ACCESS_404/);
    // (A revoked member stays an engine actor so the records they made keep validating — review L2; their authority
    // ends at the membership: no context resolves, RLS hides the org from their transactions, triggers refuse them.)
    const row = (await proposalRows(lumen.viewer)).find((r) => r.record.id === other)!;
    expect(row.status).toBe("proposed");
    expect(row.record.approval).toBeUndefined();
  });

  it("two approvers approving the same proposal concurrently: exactly one approval is recorded", async () => {
    const other = financeProposed[1];
    const results = await Promise.allSettled([
      runAction(lumen.appr, { type: "approve_journal_proposal", proposalId: other, note: "approver one (fictional)" }, key()),
      runAction(lumen.appr2, { type: "approve_journal_proposal", proposalId: other, note: "approver two (fictional)" }, key()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(RequestRefused);
    expect((loser.reason as RequestRefused).code).toBe("invalid_transition");
    const row = (await proposalRows(lumen.viewer)).find((r) => r.record.id === other)!;
    expect(row.status).toBe("approved");
    expect(row.record.history.filter((h) => h.action === "approved")).toHaveLength(1);
    const audit = await rows(lumen.viewer, sql`select 1 from audit_events where org_id = ${lumen.viewer.orgId} and action = 'journal.approved' and entity_id = ${other}`);
    expect(audit).toHaveLength(1);
    expect([lumen.appr.userId, lumen.appr2.userId]).toContain(row.record.approval!.by);
  });
});

describe("proposed is not posted", () => {
  let exportId: string;
  let exportKey: string;
  let exported: string[];

  it("record_posting before export is refused (approved is not exported)", async () => {
    await refused(runAction(lumen.finance, { type: "record_posting", proposalId: financeProposed[0], externalReference: "JV-FICT-0001" }, key()), "invalid_transition");
    await refused(runAction(lumen.finance, { type: "record_posting", proposalId: [...initialIds][0], externalReference: "JV-FICT-0002" }, key()), "invalid_transition");
    expect((await proposalRows(lumen.viewer)).filter((r) => r.status === "posted")).toEqual([]);
  });

  it("finance exports the period's approved entries; the export is a row of accounting_exports; nothing is posted", async () => {
    const approved = (await proposalRows(lumen.viewer)).filter((r) => r.status === "approved").map((r) => r.record.id).sort();
    expect(approved.length).toBe(3);
    exportKey = key();
    const r = await runAction(lumen.finance, { type: "export_journal", periodId }, exportKey);
    expect(r.replayed).toBe(false);
    [exportId] = r.body.createdIds;
    const recs = await exportRows(lumen.viewer);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ id: exportId, kind: "journal", periodId, by: lumen.finance.userId });
    expect([...(recs[0].proposalIds ?? [])].sort()).toEqual(approved);
    exported = approved;
    const after = await proposalRows(lumen.viewer);
    for (const id of exported) {
      const p = after.find((x) => x.record.id === id)!;
      expect(p.status).toBe("exported");
      expect(p.record.posting).toBeUndefined();
    }
    expect(after.filter((x) => x.status === "posted")).toEqual([]);
  });

  it("replaying the same idempotency key does not create a second export", async () => {
    const r = await runAction(lumen.finance, { type: "export_journal", periodId }, exportKey);
    expect(r.replayed).toBe(true);
    expect(r.body.createdIds).toEqual([exportId]);
    expect(await exportRows(lumen.viewer)).toHaveLength(1);
    // a new key finds nothing left to export (the approved entries are exported), so still one export
    await refused(runAction(lumen.finance, { type: "export_journal", periodId }, key()), "precondition_failed");
    expect(await exportRows(lumen.viewer)).toHaveLength(1);
  });

  it("the CSV and JSON files re-render byte for byte from the database, with the recorded SHA-256, across a pool restart", async () => {
    const [rec] = await exportRows(lumen.viewer);
    const csv1 = await journalExportFile(lumen.finance, exportId, "csv");
    const json1 = await journalExportFile(lumen.appr, exportId, "json");
    await closeDatabase();
    const csv2 = await journalExportFile(lumen.viewer, exportId, "csv");
    const json2 = await journalExportFile(lumen.finance, exportId, "json");
    expect(csv2.body).toBe(csv1.body);
    expect(json2.body).toBe(json1.body);
    expect(csv1.sha256).toBe(csv2.sha256);
    expect(json1.sha256).toBe(json2.sha256);
    expect(csv1.sha256).toBe(rec.fileSha256!.csv);
    expect(json1.sha256).toBe(rec.fileSha256!.json);
    expect(csv1.documentId).toBe(rec.documentId);
    // the file is a proposal to import: marked, and says Clearline posted nothing
    const doc = JSON.parse(json1.body);
    expect(doc).toMatchObject({ kind: "journal", fictional: true, sandbox: true, notPostedByClearline: true, documentId: rec.documentId });
    expect(csv1.body.split("\r\n").filter(Boolean).slice(1).every((l) => l.endsWith(",FICTIONAL SANDBOX"))).toBe(true);
    // every download is audited with its hash
    const audit = await rows<{ details: { sha256: string; format: string } }>(lumen.viewer, sql`select details from audit_events where org_id = ${lumen.viewer.orgId} and action = 'journal_export_downloaded' and entity_id = ${exportId}`);
    expect(audit).toHaveLength(4);
    expect(new Set(audit.map((a) => `${a.details.format}:${a.details.sha256}`))).toEqual(new Set([`csv:${csv1.sha256}`, `json:${json1.sha256}`]));
  });

  it("an exported file is not 'posted'; record_posting is accepted only with a person's external reference", async () => {
    const id = exported[0];
    await refused(runAction(lumen.finance, { type: "record_posting", proposalId: id, externalReference: "" }, key()), "invalid_field");
    await refused(runAction(lumen.finance, { type: "record_posting", proposalId: id, externalReference: "x" }, key()), "invalid_field");
    await refused(runAction(lumen.finance, { type: "record_posting", proposalId: id, externalReference: "JV FICT <script>" }, key()), "invalid_field");
    await refused(runAction(lumen.viewer, { type: "record_posting", proposalId: id, externalReference: "JV-FICT-1001" }, key()), "ACCESS_403");
    expect((await proposalRows(lumen.viewer)).find((r) => r.record.id === id)!.status).toBe("exported");
    await runAction(lumen.finance, { type: "record_posting", proposalId: id, externalReference: "JV-FICT-1001", note: "Posted by hand in the fictional ledger" }, key());
    const after = await proposalRows(lumen.viewer);
    const p = after.find((r) => r.record.id === id)!;
    expect(p.status).toBe("posted");
    expect(p.record.posting).toMatchObject({ externalReference: "JV-FICT-1001", recordedBy: lumen.finance.userId, simulated: true });
    // the other exported entries stay exported: exporting is not posting
    for (const other of exported.slice(1)) expect(after.find((r) => r.record.id === other)!.status).toBe("exported");
    // a recorded export still re-renders byte for byte after a posting is recorded
    const [rec] = await exportRows(lumen.viewer);
    expect((await journalExportFile(lumen.viewer, exportId, "csv")).sha256).toBe(rec.fileSha256!.csv);
  });

  it("the reconciliation export of the period renders deterministically and is audited", async () => {
    const a = await reconciliationExportFile(lumen.finance, periodId, "csv");
    const b = await reconciliationExportFile(lumen.viewer, periodId, "csv");
    expect(b.body).toBe(a.body);
    expect(b.sha256).toBe(a.sha256);
    const j = JSON.parse((await reconciliationExportFile(lumen.viewer, periodId, "json")).body);
    expect(j).toMatchObject({ kind: "reconciliation", fictional: true, documentId: a.documentId });
    await refused(reconciliationExportFile(lumen.viewer, "per_does_not_exist", "csv"), "ACCESS_404");
  });
});

describe("tenant isolation", () => {
  it("org B's finance user cannot see or export org A's proposals or exports", async () => {
    const b = await ctx("finance@harbour.example");
    const a = lumen.viewer;
    const [recA] = await exportRows(a);
    const vb = await accountingOverview(b);
    expect(vb.exports).toEqual([]);
    expect(vb.proposals.some((p) => p.createdBy === lumen.finance.userId || p.createdBy === lumen.appr.userId)).toBe(false);
    expect(vb.proposals.some((p) => p.status !== "proposed")).toBe(false);
    expect(JSON.stringify(vb)).not.toContain(recA.documentId);
    await refused(journalExportFile(b, recA.id, "csv"), "ACCESS_404");
    await refused(journalExportFile(b, recA.id, "json"), "ACCESS_404");
    // RLS: forcing org A's id into org B's user's context shows no rows at all
    const n = await withTenant({ userId: b.userId, orgId: a.orgId }, async (tx) => ({
      p: (await tx.execute(sql`select count(*)::int as n from accounting_proposals`)).rows[0].n,
      e: (await tx.execute(sql`select count(*)::int as n from accounting_exports`)).rows[0].n,
    }));
    expect(n).toEqual({ p: 0, e: 0 });
    // and org B's own actions never touch org A's rows
    const before = JSON.stringify(await proposalRows(a));
    await runAction(b, { type: "propose_journal_entries" }, key());
    expect(JSON.stringify(await proposalRows(a))).toBe(before);
    expect(await exportRows(a)).toHaveLength(1);
  });
});
