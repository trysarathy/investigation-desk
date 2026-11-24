/**
 * rc7 Phase 5 blind test: reads what the UI produced for the blind merchant (READ ONLY, as its Finance member through
 * the tenant's row-level security) and judges it against the generator's ground truth (computeTruth):
 *  - zero wrong matches (every transfer on a payment is one the truth attaches to that order);
 *  - every decision equals the truth, the truth made stricter by a documented rule, or an abstention where the files
 *    lack the information (tests/fixtures/synthetic/truth-expect.ts; the provider file carries the provider's claimed
 *    statuses and token symbols but no quote terms, and settlement only as batch totals);
 *  - every bank line of each account tied (bridged to its batch) or explained;
 *  - provider clearing nets to zero for every tied, verified batch;
 *  - every exception (and every payment needing attention) has an owner, a reason and a next step;
 *  - the stored decisions are what the engine computes from the stored input (nothing stale).
 * It also counts the rates the report needs. It never writes.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { database } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { resolveTenant, withTenant } from "../../src/server/tenant";
import { loadReconcileInput } from "../../src/server/merchant-store";
import { accountBalance, proposeJournals, reconcile } from "../../src/lib/clearline/merchant";
import { pairKey } from "../../src/lib/clearline/synthetic";
import { exactByReference, expectationsFor, isClosing, type FileShapes } from "../fixtures/synthetic/truth-expect";
import { BLIND, blindWorld } from "./blind-world";

export interface EntityVerdict {
  entityId: string;
  orders: number;
  records: number;
  decisions: Record<string, number>;
  rules: Record<string, number>;
  unpaid: number;
  /** Payments the engine left for review or exception because the files lack what it needs (by rule). */
  abstainedForLackOfData: Record<string, number>;
  expected: { truth: number; rule: number; abstain: number };
  mismatched: string[];
  wrongMatches: string[];
  /** rc8 decision 1: orders M4.exact.no_quote_terms closed at step 4, and those the generator's truth does not match exactly (must be none). */
  exactNoTerms: number;
  exactNotTruth: string[];
  bankLines: { total: number; credits: number; bridged: number; explained: number; problems: string[] };
  batches: { stored: number; bridged: number; tiedVerified: number; clearingNonZero: string[] };
  exceptions: { open: number; missingOwnerReasonOrNextStep: string[] };
  storedEqualsComputed: boolean;
  /** A digest of everything a run writes (decisions, differences, exceptions, write-offs, journals). */
  stateSha256: string;
}

const LACK = new Set(["M3.quote.terms_unknown", "M5.grouping.proposed_needs_confirmation", "M5.bank.imported_not_verified"]);

export async function judgeBlind(): Promise<{ flag: Record<string, boolean>; entities: EntityVerdict[] }> {
  const { world, truth } = blindWorld();
  const db = database();
  const [fin] = await db.select().from(t.users).where(eq(t.users.email, BLIND.users[0][0]));
  const ctx = await resolveTenant({ userId: fin.id, name: fin.name, email: fin.email }, BLIND.org.slug);
  const read = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });
  const out: EntityVerdict[] = [];
  const flag: Record<string, boolean> = {};
  for (const spec of world.entitySpecs) {
    const entityId = spec.id;
    const input = await read((tx) => loadReconcileInput(tx, ctx.orgId, entityId));
    flag[entityId] = input.policy.allowImportedBankLinesAsVerified;
    const r = reconcile(input);
    const shapes: FileShapes = { provider: "C", settlement: "totals", importedLinesVerify: input.policy.allowImportedBankLinesAsVerified };
    const exp = expectationsFor(world, truth, shapes, entityId);
    const stored = await read((tx) => tx.select().from(t.matchRecords).where(eq(t.matchRecords.orgId, ctx.orgId)));
    const mine = stored.filter((m) => exp.has(m.orderId));
    const recs = new Map(r.records.map((x) => [x.orderId, x]));
    const v: EntityVerdict = {
      entityId, orders: exp.size, records: mine.length, decisions: {}, rules: {}, unpaid: 0, abstainedForLackOfData: {}, expected: { truth: 0, rule: 0, abstain: 0 }, mismatched: [], wrongMatches: [], exactNoTerms: 0, exactNotTruth: [],
      bankLines: { total: 0, credits: 0, bridged: 0, explained: 0, problems: [] }, batches: { stored: input.batches.length, bridged: 0, tiedVerified: 0, clearingNonZero: [] },
      exceptions: { open: 0, missingOwnerReasonOrNextStep: [] }, storedEqualsComputed: true, stateSha256: "",
    };
    for (const m of mine) {
      v.decisions[m.decision] = (v.decisions[m.decision] ?? 0) + 1;
      v.rules[m.ruleId] = (v.rules[m.ruleId] ?? 0) + 1;
      if (!isClosing(m.decision) && LACK.has(m.ruleId)) v.abstainedForLackOfData[m.ruleId] = (v.abstainedForLackOfData[m.ruleId] ?? 0) + 1;
      const c = recs.get(m.orderId);
      if (!c || c.explanation.decision !== m.decision || c.explanation.ruleId !== m.ruleId) v.storedEqualsComputed = false;
    }
    if (mine.length !== r.records.length) v.storedEqualsComputed = false;
    // unpaid: an order in the order list with no payment to reconcile
    v.unpaid = [...exp.keys()].filter((o) => !recs.has(o)).length;
    // zero wrong matches
    for (const rec of r.records) for (const tr of [...rec.chain.transfers, ...rec.chain.pending]) {
      const k = `${tr.network}|${tr.txHash}|${tr.logIndex}`;
      if (!truth.correctPairs.has(pairKey(k, rec.orderId))) v.wrongMatches.push(`${rec.orderId} ← ${k}`);
    }
    for (const rec of r.records) if (isClosing(rec.explanation.decision) && !exp.has(rec.orderId)) v.wrongMatches.push(`${rec.orderId}: closed but not in this entity's orders`);
    // rc8 decision 1: every order its rule closed at step 4 is one the truth matches exactly (no difference)
    for (const rec of r.records) {
      if (!rec.explanation.history.some((h) => h.ruleId === "M4.exact.no_quote_terms" && h.outcome === "pass")) continue;
      v.exactNoTerms++;
      const t = truth.orders.find((o) => o.orderId === rec.orderId);
      if (!t || t.decision !== "matched" || t.differences.length || !exactByReference(world, rec.orderId, shapes)) v.exactNotTruth.push(`${rec.orderId}: truth ${t?.decision} ${t?.ruleId ?? ""}`);
    }
    // decisions against the truth
    for (const [orderId, e] of exp) {
      const rec = recs.get(orderId);
      const got = rec ? `${rec.explanation.decision} ${rec.explanation.ruleId}` : "(no record)";
      const diffs = rec ? rec.explanation.differences.map((d) => `${d.type}:${d.amountMinor}`).sort() : [];
      const same = (want: { decision: string; ruleId?: string; differences: [string, bigint][] }) => !!rec && rec.explanation.decision === want.decision
        && (want.ruleId === undefined || rec.explanation.ruleId === want.ruleId) && JSON.stringify(diffs) === JSON.stringify(want.differences.map(([a, b]) => `${a}:${b}`).sort());
      if (e.kind === "truth") {
        if (e.decision === "any_non_closing" ? rec && !isClosing(rec.explanation.decision) : same(e)) v.expected.truth++;
        else v.mismatched.push(`${orderId}: want ${e.decision} ${e.ruleId ?? ""}, got ${got}`);
      } else if (e.kind === "rule") {
        if (same(e)) v.expected.rule++; else v.mismatched.push(`${orderId}: want (${e.why}) ${e.decision} ${e.ruleId}, got ${got}`);
      } else {
        const fine = (e.noRecord ? !rec : !rec || !isClosing(rec.explanation.decision)) && (e.decision === undefined || (rec?.explanation.decision === e.decision && rec?.explanation.ruleId === e.ruleId));
        if (fine) v.expected.abstain++; else v.mismatched.push(`${orderId}: must abstain (${e.why}), got ${got}`);
      }
    }
    // every bank line of the account: a settlement credit bridged to its batch (totals = net = line), anything else explained
    const meta = new Map(world.bankLineMeta.map((m) => [m.bankLineId, m]));
    for (const wl of world.bankLines.filter((l) => l.account === spec.bankAccountId)) {
      v.bankLines.total++;
      const m = meta.get(wl.bankLineId)!;
      const got = input.bankLines.find((l) => l.valueDate === wl.valueDate && l.amountMinor === wl.amountMinor && l.account === wl.account);
      if (wl.amountMinor <= 0n) { if (got) v.bankLines.problems.push(`${wl.bankLineId}: a debit was imported as a settlement credit`); else v.bankLines.explained++; continue; }
      v.bankLines.credits++;
      if (!got) { v.bankLines.problems.push(`${wl.bankLineId}: credit not imported`); continue; }
      const bridge = r.bridges.find((b) => b.bankLineId === got.bankLineId);
      if (m.kind === "non_settlement") { if (bridge) v.bankLines.problems.push(`${wl.bankLineId}: ${m.reason} but bridged to ${bridge.batchId}`); else v.bankLines.explained++; continue; }
      if (!bridge || bridge.batchId !== m.batchId) { v.bankLines.problems.push(`${wl.bankLineId}: not bridged to ${m.batchId}`); continue; }
      if (!(bridge.checks.grossLessFeesRefundsEqualsNet && bridge.checks.netEqualsBankLine)) v.bankLines.problems.push(`${wl.bankLineId}: ${m.batchId} totals do not bridge`);
      else v.bankLines.bridged++;
    }
    v.batches.bridged = r.bridges.filter((b) => b.bankLineId).length;
    // provider clearing nets to zero for every tied, verified batch
    const journals = proposeJournals(input, r);
    for (const b of r.bridges.filter((x) => x.tied && x.settlementVerified)) {
      v.batches.tiedVerified++;
      const bal = accountBalance(journals, "provider_clearing", { batchId: b.batchId });
      if (bal !== 0n) v.batches.clearingNonZero.push(`${b.batchId}: ${bal}`);
    }
    // every exception and every payment needing attention: an owner, a reason, a next step
    const ex = await read((tx) => tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.status, "open"))));
    const exMine = ex.filter((x) => !x.orderId || exp.has(x.orderId));
    v.exceptions.open = exMine.length;
    for (const x of exMine) if (!(x.ownerRole.length > 2 && x.reason.length > 10 && x.nextStep.length > 10)) v.exceptions.missingOwnerReasonOrNextStep.push(x.id);
    for (const x of [...r.exceptions, ...r.records.flatMap((rec) => (rec.attention ? [rec.attention] : []))]) if (!(x.owner && x.reason.length > 10 && x.nextStep.length > 10)) v.exceptions.missingOwnerReasonOrNextStep.push(JSON.stringify(x).slice(0, 120));
    // a digest of the written state, to show a second run changes nothing
    const diffsRows = await read((tx) => tx.select().from(t.differences).where(eq(t.differences.orgId, ctx.orgId)));
    const wo = await read((tx) => tx.select().from(t.writeoffProposals).where(eq(t.writeoffProposals.orgId, ctx.orgId)));
    const js = await read((tx) => tx.select().from(t.merchantJournalProposals).where(eq(t.merchantJournalProposals.orgId, ctx.orgId)));
    const state = {
      m: mine.map((x) => [x.orderId, x.decision, x.ruleId, x.inputSha256]).sort(),
      d: diffsRows.filter((x) => exp.has(x.orderId)).map((x) => [x.id, x.type, String(x.amountMinor)]).sort(),
      x: ex.filter((x) => !x.orderId || exp.has(x.orderId)).map((x) => [x.id, x.status]).sort(),
      w: wo.filter((x) => exp.has(x.orderId)).map((x) => [x.id, x.status, String(x.amountMinor)]).sort(),
      j: js.filter((x) => x.entityId === entityId).map((x) => [x.id, x.status]).sort(),
    };
    v.stateSha256 = createHash("sha256").update(JSON.stringify(state)).digest("hex");
    out.push(v);
  }
  return { flag, entities: out };
}
