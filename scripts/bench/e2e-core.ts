/**
 * rc7 phase 3b end-to-end benchmark (core). Seeds a fresh LIVE synthetic organisation through the REAL upload
 * pipeline (store → map → validate → confirm, a bank statement by a second person → normalise), then runs a
 * reconciliation per entity with its database reads and writes, against recorded synthetic chain data. Every value
 * comes from the seeded synthetic generator (src/lib/clearline/synthetic): no real data. Prints nothing itself; the
 * caller prints the timings.
 *
 * Size: `months` synthetic months of `paymentsPerMonth` payments each (8 × 1,250 = 10,000 payments and about 530
 * bank lines). The mapping a person would confirm for each synthetic file layout is below.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { runReconciliation } from "../../src/server/merchant";
import { writeIngested } from "../../src/server/merchant-store";
import { RecordingChainClient, recordingOf } from "../../src/lib/clearline/merchant/chain";
import { MONTH_PRESET_PARAMS, generateWorld, renderFiles, toEnginePolicy, type SyntheticFile, type SyntheticFileKind, type SyntheticWorld } from "../../src/lib/clearline/synthetic";
import type { ColumnMapping, FileType, Mapping } from "../../src/lib/clearline/mapping";

export interface BenchOptions { months?: number; paymentsPerMonth?: number; seed?: number; tag?: string; rowByRow?: boolean }
export interface BenchResult {
  orgId: string; slug: string; payments: number; bankLines: number; uploads: number; rows: number;
  decisions: Record<string, number>; timingsMs: Record<string, number>; totalMs: number;
}

const SGT = { dateFormat: "dmy", defaultUtcOffsetMinutes: 480 } as const;
const STATUS_A: Record<string, string> = { Paid: "paid", Completed: "paid", Underpaid: "underpaid", Overpaid: "overpaid", "Partially paid": "partially_paid", Confirming: "pending" };

/** What a person confirms for each synthetic file layout (on top of the header suggestions). */
function confirmations(kind: string, cur: string, account?: string): { set: Record<string, ColumnMapping>; drop: string[]; shape?: Mapping["shape"] } {
  switch (kind) {
    case "order_list_csv": return { set: { issued_at: { header: "Issued (local)", ...SGT }, status: { header: "Status", statusValueMap: { open: "open", void: "void" } } }, drop: [] };
    case "provider_export_a": return {
      set: { executed_rate: { header: "Rate" }, credited_fiat: { header: `Credited (${cur})` }, batch_id: { header: "Settled In" }, paid_at: { header: "Created (SGT)", ...SGT },
        currency: { constant: cur }, status: { header: "Status", statusValueMap: STATUS_A }, token_contract: { derive: "network_and_symbol" } },
      drop: ["quote_rate", "created_at"],
    };
    case "settlement_lines": return { shape: "per_payment_lines", set: { line_type: { header: "line_type", statusValueMap: { payment: "payment", refund: "refund", fee: "fee" } }, line_amount: { header: "amount", deductionSign: "negative" } }, drop: [] };
    case "bank_csv": return { set: { value_date: { header: "Value Date", dateFormat: "dmy" }, booking_date: { header: "Booking Date", dateFormat: "dmy" }, bank_account: { constant: account! }, amount: { header: "Amount", decimalSeparator: "," } }, drop: [] };
    default: throw new Error(`no mapping for ${kind}`);
  }
}
const TYPE: Record<string, FileType> = { order_list_csv: "orders_invoices", provider_export_a: "provider_export", settlement_lines: "settlement_report", bank_csv: "bank_statement" };

export async function runBench(owner: Db, opts: BenchOptions = {}): Promise<BenchResult> {
  const months = opts.months ?? 8, per = opts.paymentsPerMonth ?? 1_250, seed = opts.seed ?? 7_000;
  const timings: Record<string, number> = {};
  const lap = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const t0 = performance.now(); try { return await fn(); } finally { timings[name] = (timings[name] ?? 0) + performance.now() - t0; } };
  const started = performance.now();

  // 1. synthetic months (pure; seeded)
  const worlds: SyntheticWorld[] = [];
  const files: SyntheticFile[][] = [];
  await lap("generate", async () => {
    for (let i = 0; i < months; i++) {
      const month = new Date(Date.UTC(2026, 3 + i, 1)).toISOString().slice(0, 7); // consecutive months from 2026-04
      const w = generateWorld(MONTH_PRESET_PARAMS({ seed: seed + i, month, overrides: { paymentCount: per } }));
      worlds.push(w);
      files.push(await renderFiles(w, { kinds: Object.keys(TYPE) as SyntheticFileKind[] }));
    }
  });

  // 2. a fresh live organisation with the synthetic entities, policies and members (owner connection, like the CLI)
  const slug = `bench-${opts.tag ?? randomUUID().slice(0, 8)}`;
  const w0 = worlds[0];
  const users: Record<string, TenantContext> = {};
  const accounts: Record<string, string> = {};
  const orgId = await lap("seed_org", async () => {
    const id = await createOrganization(owner, { slug, name: `Benchmark ${slug} (synthetic)`, seed: "empty", dataMode: "live" });
    for (const e of w0.entities) {
      const p = toEnginePolicy(w0.policy, e.functionalCurrency);
      await owner.insert(t.merchantEntities).values({ orgId: id, id: e.id, name: e.name, functionalCurrency: e.functionalCurrency, ledger: "xero", timezone: e.timeZone.name, utcOffsetMinutes: e.timeZone.utcOffsetMinutes });
      await owner.insert(t.merchantPolicy).values({
        orgId: id, entityId: e.id, toleranceBps: p.tolerancePct, toleranceAbsMinor: p.toleranceAbsMinor, toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor,
        approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: p.senderFeeBoundBaseUnits.toString(),
      });
      // v1: a bank statement upload names the entity's bank account (masked number only; synthetic)
      const [acct] = await owner.insert(t.bankAccounts).values({ orgId: id, entityId: e.id, currency: e.functionalCurrency, displayName: `${e.id} operating (synthetic)`, accountLast4: "0001", bankName: "Synthetic Bank" }).returning({ id: t.bankAccounts.id });
      accounts[e.id] = acct.id;
      for (const w of worlds) await owner.transaction((tx) => writeIngested(tx, id, e.id, { fxRates: w.fxRates.filter((r) => r.pair.endsWith(`/${e.functionalCurrency}`)), addressFacts: w.addressFacts }, { chainSource: "recorded_fixture" }));
    }
    for (const role of ["finance", "approver", "payment_ops"] as const) {
      const email = `${role}@${slug}.example`;
      const uid = await createUser(owner, { email, name: `${role} (synthetic)`, password: `bench-${randomUUID()}` });
      await grantMembership(owner, { orgSlug: slug, email, role });
      users[role] = await resolveTenant({ userId: uid, name: email, email }, slug);
    }
    return id;
  });

  // 3. every file through the real pipeline, per entity
  let n = 0, uploads = 0, rows = 0;
  const key = () => `bench-${slug}-${++n}`;
  for (const [i, w] of worlds.entries()) {
    for (const spec of w.entitySpecs) {
      const cur = w.entities.find((e) => e.id === spec.id)!.functionalCurrency;
      const mine = files[i].filter((f) => (f.kind !== "provider_export_a" || f.entityId === spec.id) && (f.kind !== "bank_csv" || f.account === spec.bankAccountId));
      for (const kind of ["order_list_csv", "provider_export_a", "settlement_lines", "bank_csv"]) {
        const f = mine.find((x) => x.kind === kind)!;
        const fileType = TYPE[kind];
        const up = await lap("upload_store", () => createUpload(users.finance, { entityId: spec.id, fileType, fileName: f.name, bytes: f.bytes, ...(fileType === "bank_statement" ? { bankAccountId: accounts[spec.id] } : {}) }, key()));
        const c = confirmations(kind, cur, f.account);
        const proposal = Object.fromEntries(Object.entries(up.suggestion?.suggestion.proposal ?? {}).filter(([k]) => !c.drop.includes(k)).map(([k, x]) => [k, { header: x.header }]));
        const used = new Set(Object.values(c.set).map((x) => x.header).filter(Boolean));
        for (const [k, x] of Object.entries(proposal)) if (used.has(x.header) && !(k in c.set)) delete proposal[k];
        await lap("upload_map", () => setUploadMapping(users.finance, up.upload.id, { mapping: { fileType, ...(c.shape ? { shape: c.shape } : {}), columns: { ...proposal, ...c.set } } }, key()));
        const v = (await lap("upload_validate", () => validateUpload(users.finance, up.upload.id, key()))).body;
        const confirmer = fileType === "bank_statement" ? users.approver : users.finance;
        await lap("upload_confirm", () => decideUpload(confirmer, up.upload.id, { decision: "confirm", reason: "Synthetic benchmark file (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key()));
        await lap(`normalise_${fileType}`, () => normaliseUpload(confirmer, up.upload.id, key(), undefined, { rowByRow: opts.rowByRow }));
        uploads++; rows += v.counts.rows;
      }
    }
  }

  // 4. reconcile each entity (chain verification against recorded synthetic chain data, then the run's reads and writes)
  const chain = () => new RecordingChainClient(recordingOf(worlds.flatMap((w) => w.transfers)), { now: worlds.at(-1)!.asOf });
  const decisions: Record<string, number> = {};
  for (const e of w0.entitySpecs) {
    const r = (await lap("reconcile_with_chain_verify", () => runReconciliation(users.payment_ops, e.id, key(), { chain: chain() }))).body;
    const c = r.runCounts ?? { matched: 0, withDifference: 0, review: 0, exceptions: 0 };
    for (const [k, v] of Object.entries({ matched: c.matched, with_difference: c.withDifference, review: c.review, exceptions: r.exceptions ?? 0, records: r.records ?? 0 })) decisions[k] = (decisions[k] ?? 0) + Number(v);
  }
  const totalMs = performance.now() - started;
  return {
    orgId, slug, payments: worlds.reduce((s, w) => s + w.orders.length, 0), bankLines: worlds.reduce((s, w) => s + w.bankLines.length, 0), uploads, rows, decisions,
    timingsMs: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)])), totalMs: Math.round(totalMs),
  };
}
