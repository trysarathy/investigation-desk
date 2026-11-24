/**
 * rc7 acceptance: the synthetic SMALL preset's own files, pushed through the REAL service pipeline for each entity
 * (createUpload → setUploadMapping with the header suggestions plus only the confirmations a user makes → validate →
 * confirm (a bank statement by a second person, an Approver) → normalise → verify against chain data through the
 * recorded client built from the world → reconcile), judged against the generator's ground truth: zero wrong matches,
 * decisions and differences per order equal to the truth (or to the truth made stricter by a documented rule, or an
 * abstention where a file shape lacks the information — each listed with its reason), every bank line tied or
 * explained, provider clearing at zero for every tied verified batch (policy flag on, set by an Admin, for that check
 * only; with it off no settlement is verified), and every exception with an owner, a reason and a next step.
 * Provider shapes A, B, C (and A with its quote columns), per-line and totals-only settlement, CSV / MT940 / camt.053.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed, PASSWORD } from "./harness";
import { accountFields, addTestBankAccount, useTestStorage } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { verifyChainForEntity } from "../../src/server/chain-verify";
import { runReconciliation, updateMerchantPolicy } from "../../src/server/merchant";
import { loadReconcileInput, writeIngested } from "../../src/server/merchant-store";
import { accountBalance, proposeJournals, reconcile, type ReconcileResult } from "../../src/lib/clearline/merchant";
import { RecordingChainClient, recordingOf } from "../../src/lib/clearline/merchant/chain";
import { pairKey, smallPreset, toEnginePolicy, type Preset, type SyntheticFile } from "../../src/lib/clearline/synthetic";
import type { ColumnMapping, FileType, Mapping } from "../../src/lib/clearline/mapping";
import { providerExportWithQuotes } from "../fixtures/synthetic/quote-export";
import { batchTieable, exactByReference, expectationsFor, isClosing, type Expectation, type FileShapes, type ProviderShape } from "../fixtures/synthetic/truth-expect";

let P: Preset;
let n = 0;
const key = () => `truth-${++n}-${Date.now()}`;
type Bank = "csv" | "mt940" | "camt053";
type Settlement = "lines" | "totals" | "totals_c";
interface Variant { name: string; provider: ProviderShape; settlement: Settlement; bank: Bank }
interface Users { fin: TenantContext; approver: TenantContext; admin: TenantContext; ops: TenantContext; orgId: string }

// ---------------------------------------------------------------- the user's confirmations, per file shape

const STATUS_A: Record<string, string> = { Paid: "paid", Completed: "paid", Underpaid: "underpaid", Overpaid: "overpaid", "Partially paid": "partially_paid", Confirming: "pending" };
const CLAIMS = Object.fromEntries(["paid", "underpaid", "overpaid", "held_for_review", "re_quoted", "partially_paid", "pending"].map((w) => [w, w]));
const SGT = { dateFormat: "dmy", defaultUtcOffsetMinutes: 480 } as const;
/** What a person changes in the suggested mapping, by file: set (or correct) these fields, drop these suggestions. */
function confirmations(kind: string, cur: string, account?: string): { set: Record<string, ColumnMapping>; drop: string[]; shape?: Mapping["shape"] } {
  const providerA = {
    executed_rate: { header: "Rate" }, credited_fiat: { header: `Credited (${cur})` }, batch_id: { header: "Settled In" }, paid_at: { header: "Created (SGT)", ...SGT },
    currency: { constant: cur }, status: { header: "Status", statusValueMap: STATUS_A },
  };
  switch (kind) {
    case "orders": return { set: { issued_at: { header: "Issued (local)", ...SGT }, status: { header: "Status", statusValueMap: { open: "open", void: "void" } } }, drop: [] };
    case "A": return { set: { ...providerA, token_contract: { derive: "network_and_symbol" } }, drop: ["quote_rate", "created_at"] };
    case "Aq": return {
      set: { ...providerA, quote_rate: { header: "Quote Rate" }, rate_source: { header: "Rate Source" }, token_contract: { header: "Token Contract" }, invoice_amount: { header: "Invoice Amount" },
        created_at: { header: "Quote Created (SGT)", ...SGT }, expires_at: { header: "Quote Expires (SGT)", ...SGT } },
      drop: [],
    };
    case "B": return {
      set: { received_token_amount: { header: "crypto_amount" }, executed_rate: { header: "rate" }, paid_at: { header: "created_at" }, quote_id: { header: "reference" },
        token_contract: { derive: "network_and_symbol" }, status: { header: "payment_status", statusValueMap: CLAIMS } },
      drop: ["quoted_token_amount", "quote_rate", "created_at"],
    };
    case "C": return {
      set: { network: { header: "chain.network" }, deposit_address: { header: "chain.to" }, received_token_amount: { header: "pay.amount" }, quoted_token_amount: { header: "pay.quoted" },
        executed_rate: { header: "pay.rate" }, paid_at: { header: "pay.created" }, payment_id: { header: "pay.id" }, payment_link_id: { header: "order.link" }, tx_hash: { header: "chain.tx" },
        status: { header: "pay.status", statusValueMap: CLAIMS } },
      drop: ["invoice_amount", "quote_rate", "created_at"],
    };
    case "lines": return { shape: "per_payment_lines", set: { line_type: { header: "line_type", statusValueMap: { payment: "payment", refund: "refund", fee: "fee" } }, line_amount: { header: "amount", deductionSign: "negative" } }, drop: [] };
    case "totals": return { shape: "batch_totals", set: {}, drop: ["line_amount", "payment_id"] };
    case "totals_c": return { shape: "batch_totals", set: {}, drop: [] };
    case "bank_csv": return { set: { value_date: { header: "Value Date", dateFormat: "dmy" }, booking_date: { header: "Booking Date", dateFormat: "dmy" }, bank_account: { constant: account! }, amount: { header: "Amount", decimalSeparator: "," } }, drop: [] };
    default: throw new Error(kind);
  }
}

// ---------------------------------------------------------------- pipeline

async function seedOrg(tag: string): Promise<Users> {
  const db = ownerDb();
  const slug = `truth-${tag}`;
  const orgId = await createOrganization(db, { slug, name: `Truth ${tag} (fictional)`, seed: "empty", dataMode: "live" });
  for (const e of P.world.entities) {
    const p = toEnginePolicy(P.world.policy, e.functionalCurrency);
    await db.insert(t.merchantEntities).values({ orgId, id: e.id, name: e.name, functionalCurrency: e.functionalCurrency, ledger: "xero", timezone: e.timeZone.name, utcOffsetMinutes: e.timeZone.utcOffsetMinutes });
    await db.insert(t.merchantPolicy).values({
      orgId, entityId: e.id, toleranceBps: p.tolerancePct, toleranceAbsMinor: p.toleranceAbsMinor, toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor,
      approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: p.senderFeeBoundBaseUnits.toString(),
    });
    await addTestBankAccount(db, orgId, e.id, e.functionalCurrency);
    await db.transaction((tx) => writeIngested(tx, orgId, e.id, { fxRates: P.world.fxRates.filter((r) => r.pair.endsWith(`/${e.functionalCurrency}`)), addressFacts: P.world.addressFacts }, { chainSource: "recorded_fixture" }));
  }
  const users: Record<string, TenantContext> = {};
  for (const role of ["finance", "approver", "admin", "payment_ops"] as const) {
    const email = `${role}@${slug}.example`;
    const id = await createUser(db, { email, name: `${role} (fictional)`, password: PASSWORD });
    await grantMembership(db, { orgSlug: slug, email, role });
    users[role] = await resolveTenant({ userId: id, name: email, email }, slug);
  }
  return { fin: users.finance, approver: users.approver, admin: users.admin, ops: users.payment_ops, orgId };
}

const file = (kind: SyntheticFile["kind"], pick: Partial<SyntheticFile> = {}) => P.files.find((f) => f.kind === kind && Object.entries(pick).every(([k, v]) => (f as unknown as Record<string, unknown>)[k] === v))!;

interface Upload { name: string; fileType: FileType; bytes: Uint8Array; kind: string; account?: string }
function filesFor(v: Variant, entityId: string): Upload[] {
  const spec = P.world.entitySpecs.find((e) => e.id === entityId)!;
  const provider: Upload = v.provider === "A" ? { ...file("provider_export_a", { entityId }), fileType: "provider_export", kind: "A" }
    : v.provider === "B" ? { ...file("provider_export_b"), fileType: "provider_export", kind: "B" }
      : v.provider === "C" ? { ...file("provider_export_c"), fileType: "provider_export", kind: "C" }
        : { ...providerExportWithQuotes(P.world, entityId), fileType: "provider_export", kind: "Aq" };
  const settlement: Upload = v.settlement === "lines" ? { ...file("settlement_lines"), fileType: "settlement_report", kind: "lines" }
    : v.settlement === "totals" ? { ...file("settlement_totals"), fileType: "settlement_report", kind: "totals" } : { ...file("provider_settlement_totals_c"), fileType: "settlement_report", kind: "totals_c" };
  const bankKind = { csv: "bank_csv", mt940: "bank_mt940", camt053: "bank_camt053" } as const;
  const bank: Upload = { ...file(bankKind[v.bank], { account: spec.bankAccountId }), fileType: "bank_statement", kind: v.bank === "csv" ? "bank_csv" : v.bank, account: spec.bankAccountId };
  return [{ ...file("order_list_csv"), fileType: "orders_invoices", kind: "orders" }, provider, settlement, bank];
}

async function push(u: Users, entityId: string, f: Upload, shuffle?: (b: Uint8Array) => Uint8Array) {
  const cur = P.world.entities.find((e) => e.id === entityId)!.functionalCurrency;
  const bytes = shuffle ? shuffle(f.bytes) : f.bytes;
  const up = await createUpload(u.fin, { entityId, fileType: f.fileType, fileName: f.name, bytes, ...(await accountFields(u.fin, entityId, f.fileType)) }, key());
  if (f.kind !== "mt940" && f.kind !== "camt053") {
    const c = confirmations(f.kind, cur, f.account);
    const proposal = Object.fromEntries(Object.entries(up.suggestion?.suggestion.proposal ?? {}).filter(([k]) => !c.drop.includes(k)).map(([k, x]) => [k, { header: x.header }]));
    // a column the person now uses for another field is no longer proposed for the old one
    const usedHeaders = new Set(Object.values(c.set).map((x) => x.header).filter(Boolean));
    for (const [k, x] of Object.entries(proposal)) if (usedHeaders.has(x.header) && !(k in c.set)) delete proposal[k];
    const mapping: Mapping = { fileType: f.fileType, ...(c.shape ? { shape: c.shape } : {}), columns: { ...proposal, ...c.set } };
    await setUploadMapping(u.fin, up.upload.id, { mapping }, key());
  }
  const v = (await validateUpload(u.fin, up.upload.id, key())).body;
  const confirmer = f.fileType === "bank_statement" ? u.approver : u.fin; // a statement needs a second person
  await decideUpload(confirmer, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  const norm = (await normaliseUpload(confirmer, up.upload.id, key())).body;
  return { id: up.upload.id, counts: v.counts, norm: norm.counts };
}

const chainClient = () => new RecordingChainClient(recordingOf(P.world.transfers), { now: P.world.asOf });
const inputOf = (u: Users, entityId: string) => withTenant({ userId: u.ops.userId, orgId: u.orgId }, (tx) => loadReconcileInput(tx, u.orgId, entityId), { read: true });
const view = (r: ReconcileResult) => Object.fromEntries(r.records.map((x) => [x.orderId, { d: x.explanation.decision, r: x.explanation.ruleId, diffs: x.explanation.differences.map((d) => [d.type, d.amountMinor]), tied: x.bank.batchTied, v: x.bank.settlementVerified }]));

async function runVariant(v: Variant, u: Users, opts: { shuffle?: (b: Uint8Array) => Uint8Array } = {}) {
  const uploads: Record<string, Awaited<ReturnType<typeof push>>[]> = {};
  for (const e of P.world.entitySpecs) {
    uploads[e.id] = [];
    for (const f of filesFor(v, e.id)) uploads[e.id].push(await push(u, e.id, f, opts.shuffle));
    await verifyChainForEntity(u.ops, e.id, chainClient(), { now: new Date(P.world.asOf) });
  }
  return uploads;
}

// ---------------------------------------------------------------- judging against the truth

interface Row { variant: string; entity: string; orders: number; truth: number; rule: number; abstain: number; mismatched: string[]; wrongMatches: string[]; abstentions: string[]; rules: Record<string, number>; rawOn?: number;
  /** rc8: orders decision 1 (M4.exact.no_quote_terms) closed at step 4, before step 5; and orders closed in the end (flag off / on) */
  exact: number; exactNotTruth: string[]; closed: number; closedOn?: number }
const table: Row[] = [];

/**
 * rc8: an order decision 1 closed at step 4 is one the truth matches exactly. The one exception is a payment held for
 * review that the file shows as "Completed" (shape A hides the claim): step 4 cannot tell, and step 5 must then keep it
 * open (it is in no batch), so it is never closed.
 */
function exactClosureIsTruth(rec: ReconcileResult["records"][number], shapes: FileShapes): boolean {
  const t = P.truth.orders.find((o) => o.orderId === rec.orderId);
  if (!t || !exactByReference(P.world, rec.orderId, shapes)) return false;
  if (t.decision === "matched" && t.differences.length === 0) return true;
  const hidden = shapes.provider === "A" && P.world.orders.find((o) => o.orderId === rec.orderId)?.design.scenario === "held_by_provider";
  return hidden && !isClosing(rec.explanation.decision);
}

function judge(v: Variant, entityId: string, input: Awaited<ReturnType<typeof inputOf>>, r: ReconcileResult, shapes: FileShapes): Row {
  const exp = expectationsFor(P.world, P.truth, shapes, entityId);
  const recs = new Map(r.records.map((x) => [x.orderId, x]));
  const row: Row = { variant: v.name, entity: entityId, orders: exp.size, truth: 0, rule: 0, abstain: 0, mismatched: [], wrongMatches: [], abstentions: [], rules: {}, exact: 0, exactNotTruth: [], closed: 0 };
  // rc8 decision 1: every order its rule closed at step 4 is one the generator's truth matches exactly (no difference)
  for (const rec of r.records) {
    if (isClosing(rec.explanation.decision)) row.closed++;
    if (!rec.explanation.history.some((h) => h.ruleId === "M4.exact.no_quote_terms" && h.outcome === "pass")) continue;
    row.exact++;
    if (!exactClosureIsTruth(rec, shapes)) row.exactNotTruth.push(`${rec.orderId}: ${rec.explanation.decision} ${rec.explanation.ruleId}, truth ${P.truth.orders.find((o) => o.orderId === rec.orderId)?.decision}`);
  }
  // zero wrong matches: every transfer on a record is one the truth attaches to that order
  for (const rec of r.records) for (const tr of [...rec.chain.transfers, ...rec.chain.pending]) {
    const k = `${tr.network}|${tr.txHash}|${tr.logIndex}`;
    if (!P.truth.correctPairs.has(pairKey(k, rec.orderId))) row.wrongMatches.push(`${rec.orderId} ← ${k}`);
  }
  for (const [orderId, e] of exp) {
    const rec = recs.get(orderId);
    const got = rec ? `${rec.explanation.decision} ${rec.explanation.ruleId}` : "(no record)";
    const gotDiffs = rec ? rec.explanation.differences.map((d) => [d.type, d.amountMinor] as [string, bigint]).sort() : [];
    const ok = (want: Expectation & { kind: "truth" | "rule" }) => rec && rec.explanation.decision === want.decision && (want.ruleId === undefined || rec.explanation.ruleId === want.ruleId)
      && JSON.stringify(gotDiffs.map(([a, b]) => [a, String(b)])) === JSON.stringify([...want.differences].sort().map(([a, b]) => [a, String(b)]));
    if (e.kind === "truth") {
      if (e.decision === "any_non_closing" ? rec && !isClosing(rec.explanation.decision) : ok(e)) row.truth++;
      else row.mismatched.push(`${orderId}: want ${e.decision} ${e.ruleId ?? ""} ${JSON.stringify(e.differences.map(([a, b]) => [a, String(b)]))}, got ${got} ${JSON.stringify(gotDiffs.map(([a, b]) => [a, String(b)]))}`);
    } else if (e.kind === "rule") {
      if (ok(e)) { row.rule++; row.rules[e.ruleId] = (row.rules[e.ruleId] ?? 0) + 1; }
      else row.mismatched.push(`${orderId}: want (${e.why}) ${e.decision} ${e.ruleId}, got ${got}`);
    } else {
      const fine = (e.noRecord ? !rec : !rec || !isClosing(rec.explanation.decision)) && (e.decision === undefined || (rec?.explanation.decision === e.decision && rec?.explanation.ruleId === e.ruleId));
      if (fine) { row.abstain++; row.abstentions.push(`${orderId} → ${got}: ${e.why}`); } else row.mismatched.push(`${orderId}: must abstain (${e.why}), got ${got}`);
    }
  }
  // every exception (and every record that needs attention) has an owner, a reason and a next step
  for (const x of [...r.exceptions, ...r.records.flatMap((rec) => (rec.attention ? [rec.attention] : []))])
    expect([!!x.owner, x.reason.length > 10, x.nextStep.length > 10], JSON.stringify(x)).toEqual([true, true, true]);
  void input;
  if (process.env.TRUTH_DEBUG) for (const b of r.bridges.filter((x) => !x.tied)) process.stdout.write(`DEBUG ${v.name} ${b.batchId} ${JSON.stringify(b.checks)} ${JSON.stringify(b.lines.map((l) => [l.kind, String(l.amountMinor), l.paymentIds.join(" ")]))}\n`);
  return row;
}

/** Every bank line of the entity's account: a settlement credit is tied by its batch's bridge (per-line) or its batch totals bridge to it (totals-only); anything else is explained by the truth. */
function bankLinesExplained(v: Variant, entityId: string, input: Awaited<ReturnType<typeof inputOf>>, r: ReconcileResult, shapes: FileShapes) {
  const spec = P.world.entitySpecs.find((e) => e.id === entityId)!;
  const meta = new Map(P.world.bankLineMeta.map((m) => [m.bankLineId, m]));
  const problems: string[] = [];
  for (const wl of P.world.bankLines.filter((l) => l.account === spec.bankAccountId)) {
    const m = meta.get(wl.bankLineId)!;
    const mine = input.bankLines.find((l) => l.valueDate === wl.valueDate && l.amountMinor === wl.amountMinor && l.account === wl.account);
    if (wl.amountMinor <= 0n) { if (mine) problems.push(`${wl.bankLineId}: a debit was imported as a settlement credit`); continue; } // debits are not settlement credits
    if (!mine) { problems.push(`${wl.bankLineId}: credit not imported`); continue; }
    const bridge = r.bridges.find((b) => b.bankLineId === mine.bankLineId);
    if (m.kind === "non_settlement") { if (bridge) problems.push(`${wl.bankLineId}: ${m.reason} but bridged to ${bridge.batchId}`); continue; }
    if (!bridge || bridge.batchId !== m.batchId) { problems.push(`${wl.bankLineId}: not bridged to ${m.batchId}`); continue; }
    // per-line: the batch ties (unless these files cannot tie it: then its totals still bridge to the line); totals-only: the totals bridge to the line
    const mustTie = v.settlement === "lines" && batchTieable(P.world, P.truth, m.batchId!, shapes);
    if (mustTie ? !bridge.tied : !(bridge.checks.grossLessFeesRefundsEqualsNet && bridge.checks.netEqualsBankLine)) problems.push(`${wl.bankLineId}: ${m.batchId} does not ${mustTie ? "tie" : "bridge"}`);
  }
  return problems;
}

const VARIANTS: Variant[] = [
  { name: "A · per-line · CSV", provider: "A", settlement: "lines", bank: "csv" },
  { name: "B · per-line · MT940", provider: "B", settlement: "lines", bank: "mt940" },
  { name: "C · C totals · camt.053", provider: "C", settlement: "totals_c", bank: "camt053" },
  { name: "A · totals · CSV", provider: "A", settlement: "totals", bank: "csv" },
  { name: "A+quotes · per-line · camt.053", provider: "Aq", settlement: "lines", bank: "camt053" },
  { name: "A+quotes · totals · MT940", provider: "Aq", settlement: "totals", bank: "mt940" },
];

beforeAll(async () => {
  useTestStorage(true);
  await resetAndSeed();
  P = await smallPreset();
});
afterAll(async () => {
  const lines = ["", "| variant | entity | orders | = truth | = truth + rule (rules) | abstained (file lacks it) | = raw truth, flag on | decision 1 at step 4 | closed (flag off / on) | mismatched | wrong matches |", "|---|---|---|---|---|---|---|---|---|---|---|",
    ...table.map((r) => `| ${r.variant} | ${r.entity} | ${r.orders} | ${r.truth} | ${r.rule} (${Object.entries(r.rules).map(([k, x]) => `${k} ${x}`).join(", ")}) | ${r.abstain} | ${r.rawOn ?? "–"} | ${r.exact} | ${r.closed} / ${r.closedOn ?? "–"} | ${r.mismatched.length} | ${r.wrongMatches.length} |`),
    "", ...table.flatMap((r) => r.abstentions.map((a) => `- ${r.variant} · ${a}`))];
  process.stdout.write(lines.join("\n") + "\n");
  if (process.env.TRUTH_REPORT) (await import("node:fs")).writeFileSync(process.env.TRUTH_REPORT, lines.join("\n") + "\n");
  await closeDatabase(); await closeOwner();
});

describe.each(VARIANTS)("truth: $name", (v) => {
  let u: Users;
  const shapes = (flag: boolean): FileShapes => ({ provider: v.provider, settlement: v.settlement === "lines" ? "lines" : "totals", importedLinesVerify: flag });
  beforeAll(async () => { u = await seedOrg(v.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()); await runVariant(v, u); });

  it.each(["ENT-SG-SYN", "ENT-US-SYN"])("%s: zero wrong matches; every decision equals the truth, a documented rule on it, or an abstention", async (entityId) => {
    const input = await inputOf(u, entityId);
    const r = reconcile(input);
    const row = judge(v, entityId, input, r, shapes(false));
    table.push(row);
    expect(row.wrongMatches).toEqual([]);
    expect(row.exactNotTruth).toEqual([]);
    expect(row.mismatched).toEqual([]);
    expect(row.truth + row.rule + row.abstain).toBe(row.orders);
    expect(bankLinesExplained(v, entityId, input, r, shapes(false))).toEqual([]);
    // the policy flag is off: an imported bank line never verifies settlement
    expect(r.bridges.filter((b) => b.settlementVerified).map((b) => b.batchId)).toEqual([]);
  });

  it("with the imported-bank-line flag on (an Admin's decision, for this check only), provider clearing nets to zero for every tied, verified batch", async () => {
    for (const entityId of ["ENT-SG-SYN", "ENT-US-SYN"]) {
      await updateMerchantPolicy(u.admin, entityId, { allowImportedBankLinesAsVerified: true }, 1, key());
      try {
        const input = await inputOf(u, entityId);
        const r = reconcile(input);
        const journals = proposeJournals(input, r);
        const tied = r.bridges.filter((b) => b.tied && b.settlementVerified);
        if (v.settlement === "lines") {
          // every batch the truth ties is tied and verified now
          const truthTied = P.truth.batches.filter((b) => b.entityId === entityId && batchTieable(P.world, P.truth, b.batchId, shapes(true))).map((b) => b.batchId).sort();
          expect(tied.map((b) => b.batchId).sort()).toEqual(truthTied);
        } else expect(tied).toEqual([]); // totals only: nothing ties to a payment, so nothing settles
        const exp = expectationsFor(P.world, P.truth, shapes(true), entityId);
        for (const b of tied) {
          const orders = P.world.batchLines.filter((l) => l.batchId === b.batchId && l.kind === "payment").map((l) => l.orderId);
          const evidenced = orders.every((o) => exp.get(o)?.kind === "truth") && P.truth.batches.find((x) => x.batchId === b.batchId)!.clearingNetsToZero;
          if (evidenced) expect(accountBalance(journals, "provider_clearing", { batchId: b.batchId }), b.batchId).toBe(0n);
        }
        const r2 = view(r);
        // how many orders now equal the generator's raw truth exactly (decision, rule, differences)
        const raw = P.truth.orders.filter((o) => o.entityId === entityId && o.decision !== "not_evaluated" && r2[o.orderId]?.d === o.decision && r2[o.orderId]?.r === o.ruleId
          && JSON.stringify(r2[o.orderId].diffs.map(([a, b]) => [a, String(b)]).sort()) === JSON.stringify(o.differences.map((d) => [d.type, String(d.amountMinor)]).sort())).length;
        const row = table.find((x) => x.variant === v.name && x.entity === entityId);
        if (row) { row.rawOn = raw; row.closedOn = r.records.filter((x) => isClosing(x.explanation.decision)).length; }
        // rc8: with the flag on too, decision 1 closes only what the truth matches exactly
        for (const rec of r.records) if (rec.explanation.history.some((h) => h.ruleId === "M4.exact.no_quote_terms" && h.outcome === "pass"))
          expect([rec.orderId, exactClosureIsTruth(rec, shapes(true))]).toEqual([rec.orderId, true]);
        // and the decisions are the truth's where the files carry it (flag on)
        for (const [o, e] of exp) if (e.kind === "truth" && e.decision !== "any_non_closing") expect([o, r2[o]?.d, r2[o]?.r], o).toEqual([o, e.decision, e.ruleId ?? r2[o]?.r]);
      } finally {
        await updateMerchantPolicy(u.admin, entityId, { allowImportedBankLinesAsVerified: false }, 2, key());
      }
    }
  });
});

describe("properties", () => {
  const V: Variant = { name: "A+quotes · per-line · CSV", provider: "Aq", settlement: "lines", bank: "csv" };
  let base: Record<string, ReturnType<typeof view>>;
  let u: Users;
  beforeAll(async () => {
    u = await seedOrg("prop-base");
    await runVariant(V, u);
    base = Object.fromEntries(await Promise.all(P.world.entitySpecs.map(async (e) => [e.id, view(reconcile(await inputOf(u, e.id)))] as const)));
  });

  it("shuffled file row order gives identical results", async () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const shuffle = (b: Uint8Array) => {
      const text = new TextDecoder().decode(b);
      if (!text.includes("\n") || text.trimStart().startsWith("{") || text.trimStart().startsWith("<") || text.startsWith(":20:") || b[0] === 0x50) return b; // CSV only
      const bom = text.startsWith("﻿") ? "﻿" : "";
      const lines = text.replace(/^﻿/, "").split("\n").filter((l) => l !== "");
      const [head, ...body] = lines;
      const total = body.filter((l) => l.startsWith("TOTAL") || l.startsWith('"TOTAL"'));
      const rows = body.filter((l) => !total.includes(l));
      for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
      return new TextEncoder().encode(bom + [head, ...rows, ...total].join("\n") + "\n");
    };
    const w = await seedOrg("prop-shuffled");
    await runVariant(V, w, { shuffle });
    for (const e of P.world.entitySpecs) expect(view(reconcile(await inputOf(w, e.id))), e.id).toEqual(base[e.id]);
  });

  it("re-running the whole pipeline on the same files changes nothing", async () => {
    const first = await runReconciliation(u.ops, "ENT-SG-SYN", key(), { chain: chainClient() });
    expect(first.body).toMatchObject({ changed: true });
    for (const e of P.world.entitySpecs) {
      for (const f of filesFor(V, e.id)) {
        await expect(createUpload(u.fin, { entityId: e.id, fileType: f.fileType, fileName: f.name, bytes: f.bytes, ...(await accountFields(u.fin, e.id, f.fileType)) }, key())).rejects.toSatisfy((x: unknown) => x instanceof RequestRefused && x.code === "DUPLICATE_UPLOAD");
      }
      const ups = await ownerDb().select().from(t.uploads).where(and(eq(t.uploads.orgId, u.orgId), eq(t.uploads.entityId, e.id)));
      for (const up of ups) expect((await normaliseUpload(up.fileType === "bank_statement" ? u.approver : u.fin, up.id, key())).body).toMatchObject({ changed: false });
      await verifyChainForEntity(u.ops, e.id, chainClient(), { now: new Date(P.world.asOf) });
      expect(view(reconcile(await inputOf(u, e.id))), e.id).toEqual(base[e.id]);
    }
    // the second run writes nothing new: no new difference, write-off or journal; no exception opened or resolved
    const second = (await runReconciliation(u.ops, "ENT-SG-SYN", key(), { chain: chainClient() })).body as Record<string, unknown>;
    expect(second).toMatchObject({ inputSha256: (first.body as Record<string, unknown>).inputSha256, newDifferences: 0, newWriteoffs: 0, supersededWriteoffs: 0, resolvedExceptions: 0, exceptions: (first.body as Record<string, unknown>).exceptions });
    const ex = await ownerDb().select().from(t.reconExceptions).where(eq(t.reconExceptions.orgId, u.orgId));
    expect(ex.length).toBeGreaterThan(0);
    for (const x of ex) expect([x.ownerRole.length > 2, x.reason.length > 10, x.nextStep.length > 10]).toEqual([true, true, true]);
  });
});
