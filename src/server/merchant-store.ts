import "server-only";
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import {
  NETWORKS, localDate, toFiatMinor,
  type BankLine, type ChainTransfer, type ChainUnavailable, type FiatCurrency, type Invoice, type MerchantEntity, type MerchantPolicy, type NetworkId, type PaymentLink,
  type ProviderPaymentRecord, type Quote, type ReconcileInput, type SettlementBatch, type SettlementBatchLine, type SettlementPaymentLine,
} from "@/lib/clearline/merchant";
import { TEST_MODE_LABEL } from "@/lib/clearline/merchant/types";
import { normAddress } from "@/lib/clearline/merchant/config";
import type { Tx } from "./db/client";
import * as t from "./db/schema";

/**
 * rc6 merchant rows ↔ the pure engine's ReconcileInput. `loadReconcileInput` reads one entity's rows (inside the
 * caller's RLS-scoped transaction) in canonical order, so the same rows always give the same input and input hash.
 * `writeIngested` stores what the adapters produced; facts are insert-only (a chain transfer may only change its
 * confirmations and finality). Test mode · illustrative data.
 */

/** JSON-safe copy: BigInt as decimal strings (jsonb cannot hold BigInt). */
export function plain<T>(v: T): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => [k, plain(x)]));
  return v;
}

/** Like plain(), but a Date becomes its ISO string (plain() turns a Date into {}). For values read back for display, never for hashing. */
export function plainForDisplay<T>(v: T): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(plainForDisplay);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => [k, plainForDisplay(x)]));
  return v;
}

/** numeric(24,10) comes back as "1.3500000000": trim to at least 4 decimals [ASSUMPTION: rates are quoted to ≥ 4 places]. */
export function normRate(r: string): string {
  const [w, f = ""] = r.split(".");
  let frac = f.replace(/0+$/, "");
  if (frac.length < 4) frac = frac.padEnd(4, "0");
  return `${w}.${frac}`;
}

const dbNetwork = (n: string): NetworkId => (n === "arbitrum-one" ? "arbitrum_one" : n) as NetworkId;
const iso = (d: Date) => d.toISOString();
const INVOICE_STATUS: Record<string, Invoice["status"]> = { void: "void", paid: "closed", closed_with_difference: "closed" };
const BIG = (v: string | bigint | null | undefined): bigint => BigInt(v ?? 0);
const EPOCH = new Date(0);

export class MissingEntity extends Error {}

export async function loadReconcileInput(tx: Tx, orgId: string, entityId: string): Promise<ReconcileInput> {
  const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, orgId), eq(t.merchantEntities.id, entityId)));
  if (!ent) throw new MissingEntity(entityId);
  const [pol] = await tx.select().from(t.merchantPolicy).where(and(eq(t.merchantPolicy.orgId, orgId), eq(t.merchantPolicy.entityId, entityId)));
  if (!pol) throw new MissingEntity(`policy of ${entityId}`);
  const entity: MerchantEntity = { id: ent.id, name: ent.name, functionalCurrency: ent.functionalCurrency as FiatCurrency, ledger: ent.ledger, timeZone: { name: ent.timezone, utcOffsetMinutes: ent.utcOffsetMinutes } };
  const policy: MerchantPolicy = {
    tolerancePct: pol.toleranceBps, toleranceAbsMinor: pol.toleranceAbsMinor, toleranceCombine: pol.toleranceCombine === "smaller" ? "smaller" : "larger", writeoffThresholdMinor: pol.writeoffThresholdMinor,
    approverRoles: pol.approverRoles as string[], allowImportedBankLinesAsVerified: pol.allowImportedBankLinesAsVerified, senderFeeBoundBaseUnits: BigInt(pol.senderFeeBoundBaseUnits),
  };
  const netRows = await tx.select().from(t.networkConfig);
  const networks = NETWORKS.map((n) => { const r = netRows.find((x) => dbNetwork(x.network) === n.network); return r ? { ...n, confirmationsRequired: r.confirmationsRequired, enabled: r.enabled } : n; });
  const tokens = (await tx.select().from(t.tokenConfig).orderBy(asc(t.tokenConfig.network), asc(t.tokenConfig.contract)))
    .map((k) => ({ network: dbNetwork(k.network), contract: k.contract, symbol: k.symbol, decimals: k.decimals }));

  const inv = await tx.select().from(t.invoices).where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.entityId, entityId))).orderBy(asc(t.invoices.orderId));
  const orderIds = inv.map((i) => i.orderId);
  // v1: a token-priced invoice (migration 0040) has no fiat amount: the engine gets 0n, never used, and its token price
  const invoices: Invoice[] = inv.map((i) => ({
    orderId: i.orderId, entityId, amountMinor: i.amountMinor ?? 0n, currency: i.currency as FiatCurrency, status: INVOICE_STATUS[i.status] ?? "open",
    ...(i.priceTokenAmount !== null && i.priceNetwork !== null && i.priceTokenContract !== null
      ? { price: { token: { network: dbNetwork(i.priceNetwork), contract: i.priceTokenContract }, baseUnits: BigInt(i.priceTokenAmount) } } : {}),
  }));
  const qs = orderIds.length ? await tx.select().from(t.merchantQuotes).where(and(eq(t.merchantQuotes.orgId, orgId), inArray(t.merchantQuotes.orderId, orderIds))).orderBy(asc(t.merchantQuotes.quoteId)) : [];
  // rc7: terms an uploaded export did not carry are NULL. The engine gets placeholders it never uses, and the list of
  // unknown terms, so the order abstains (M3.quote.terms_unknown). Nothing is derived to fill them.
  const quotes: Quote[] = qs.map((q) => {
    const unknown = [...(q.rate === null ? ["rate" as const] : []), ...(q.quotedBaseUnits === null ? ["quoted_amount" as const] : []), ...(q.createdAt === null || q.expiresAt === null ? ["window" as const] : [])];
    return {
      quoteId: q.quoteId, orderId: q.orderId, token: { network: dbNetwork(q.network), contract: q.tokenContract }, network: dbNetwork(q.network), quotedBaseUnits: BigInt(q.quotedBaseUnits ?? 0),
      rate: q.rate === null ? "0" : normRate(q.rate), rateSource: q.rateSource ?? "not in the file", rateAt: iso(q.rateAt ?? q.createdAt ?? EPOCH), createdAt: iso(q.createdAt ?? EPOCH),
      expiresAt: iso(q.expiresAt ?? EPOCH), depositAddress: q.depositAddress, ...(unknown.length ? { unknown } : {}),
    };
  });
  const ls = orderIds.length ? await tx.select().from(t.paymentLinks).where(and(eq(t.paymentLinks.orgId, orgId), inArray(t.paymentLinks.orderId, orderIds))).orderBy(asc(t.paymentLinks.linkId)) : [];
  const paymentLinks: PaymentLink[] = ls.map((l) => {
    // the upload pipeline always records a link's quote and token (normalise); only a hand-made row could lack them
    if (!l.quoteId || !l.tokenContract) throw new Error(`payment link ${l.linkId} lacks the fields reconciliation needs`);
    // rc7: an uploaded export gives a payment, not its link's own window: unknown (placeholders, never used to decide)
    const window = l.createdAt && l.expiresAt ? { createdAt: iso(l.createdAt), expiresAt: iso(l.expiresAt) } : { createdAt: iso(EPOCH), expiresAt: iso(EPOCH), windowUnknown: true as const };
    // rc8: a link row whose file gives no requested (quoted) amount: unknown, so the order abstains instead of the run failing
    const requested = l.requestedBaseUnits ? { requestedBaseUnits: BigInt(l.requestedBaseUnits) } : { requestedBaseUnits: 0n, requestedUnknown: true as const };
    return { linkId: l.linkId, orderId: l.orderId, quoteId: l.quoteId, kind: l.kind as PaymentLink["kind"], token: { network: dbNetwork(l.network), contract: l.tokenContract }, depositAddress: l.depositAddress, ...requested, ...window };
  });
  const qIds = quotes.map((q) => q.quoteId), lIds = paymentLinks.map((l) => l.linkId);
  const refs = [...(qIds.length ? [inArray(t.providerPaymentRecords.quoteId, qIds)] : []), ...(lIds.length ? [inArray(t.providerPaymentRecords.linkId, lIds)] : [])];
  const prs = refs.length ? await tx.select().from(t.providerPaymentRecords).where(and(eq(t.providerPaymentRecords.orgId, orgId), or(...refs))).orderBy(asc(t.providerPaymentRecords.providerPaymentId)) : [];
  const providerRecords: ProviderPaymentRecord[] = prs.map((p) => {
    const r = p.record as { ref: ProviderPaymentRecord["ref"]; transferRef?: ProviderPaymentRecord["transferRef"]; displayedStatus?: string; executedRate: string; logIndexUnknown?: boolean };
    return {
      providerPaymentId: p.providerPaymentId, ref: r.ref, ...(r.transferRef ? { transferRef: r.transferRef } : {}), statusClaim: p.statusClaim as ProviderPaymentRecord["statusClaim"],
      ...(r.displayedStatus ? { displayedStatus: r.displayedStatus } : {}), receivedBaseUnits: BIG(p.receivedBaseUnits), creditedMinor: BIG(p.creditedMinor),
      ...(p.creditedCurrency ? { creditedCurrency: p.creditedCurrency as FiatCurrency } : {}), executedRate: r.executedRate,
      ...(p.feeMinor !== null ? { feeMinor: p.feeMinor } : {}), ...(p.batchId ? { batchId: p.batchId } : {}), ...(r.transferRef && r.logIndexUnknown ? { logIndexUnknown: true as const } : {}),
    };
  });
  const required = (n: string) => networks.find((x) => x.network === n)?.confirmationsRequired ?? 1;
  const all = await tx.select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, orgId), eq(t.chainTransfers.entityId, entityId)))
    .orderBy(asc(t.chainTransfers.network), asc(t.chainTransfers.txHash), asc(t.chainTransfers.logIndex), asc(t.chainTransfers.source));
  // rc7: a provider file's claimed transfer is a claim, not a fact. The engine reads chain facts only; the claim is on
  // the provider record. A claim no chain read has covered yet is "chain data unavailable", never "nothing arrived".
  const ct = all.filter((c) => c.source !== "provider_export");
  const chainUnavailable = await unavailableReads(tx, orgId, entityId, all);
  const transfers: ChainTransfer[] = ct.map((c) => ({
    network: dbNetwork(c.network), txHash: c.txHash, logIndex: c.logIndex, tokenContract: c.tokenContract, ...(c.claimedSymbol ? { claimedSymbol: c.claimedSymbol } : {}),
    from: c.fromAddress, to: c.toAddress, amountBaseUnits: BigInt(c.amountBaseUnits), decimals: c.decimals, block: c.block, timestamp: iso(c.blockTime),
    // a transfer marked not final (e.g. after a reorg) stays pending for the engine whatever its count
    confirmations: c.finalised ? c.confirmations : Math.min(c.confirmations, required(c.network) - 1),
    ...(c.priorHops ? { priorHops: c.priorHops as ChainTransfer["priorHops"] } : {}),
    // rc8: where the fact came from (only a chain_client read can close an order without quote terms)
    source: c.source as NonNullable<ChainTransfer["source"]>,
  }));
  const bs = await tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, orgId), eq(t.settlementBatches.entityId, entityId))).orderBy(asc(t.settlementBatches.batchId));
  const batches: SettlementBatch[] = bs.map((b) => ({
    batchId: b.batchId, providerDay: localDate(iso(b.dayStart), b.dayUtcOffsetMinutes), providerTimeZone: { name: b.dayTimezone, utcOffsetMinutes: b.dayUtcOffsetMinutes },
    currency: b.currency as FiatCurrency, targetBankAccount: b.targetBankAccount, grossMinor: b.grossMinor, feesMinor: b.feesMinor, refundsMinor: b.refundsMinor, netMinor: b.netMinor,
  }));
  const bIds = batches.map((b) => b.batchId);
  const bl = bIds.length ? await tx.select().from(t.settlementBatchLines).where(and(eq(t.settlementBatchLines.orgId, orgId), inArray(t.settlementBatchLines.batchId, bIds)))
    .orderBy(asc(t.settlementBatchLines.batchId), asc(t.settlementBatchLines.lineNo)) : [];
  const batchLines: SettlementBatchLine[] = bl.map((l) => ({
    batchId: l.batchId, kind: l.kind as SettlementBatchLine["kind"], ...(l.kind === "payment" ? { providerPaymentId: l.ref } : { refundId: l.ref }), orderId: l.orderId ?? "", amountMinor: l.amountMinor,
  }));
  // v1: per-payment settlement lines of this entity's batches (absent from the input when there are none)
  const spl = bIds.length ? await tx.select().from(t.settlementPaymentLines).where(and(eq(t.settlementPaymentLines.orgId, orgId), eq(t.settlementPaymentLines.entityId, entityId), inArray(t.settlementPaymentLines.batchId, bIds)))
    .orderBy(asc(t.settlementPaymentLines.batchId), asc(t.settlementPaymentLines.lineKey)) : [];
  const settlementPaymentLines: SettlementPaymentLine[] = spl.map((l) => ({
    batchId: l.batchId, providerPaymentId: l.providerPaymentId, ...(l.kind === "refund" ? { kind: "refund" as const, refundId: l.refundId ?? "" } : {}), ...(l.orderId ? { orderId: l.orderId } : {}), currency: l.currency as FiatCurrency,
    grossMinor: l.grossMinor, feeMinor: l.feeMinor, netMinor: l.netMinor, ...(l.settlementDate ? { settlementDate: l.settlementDate } : {}),
  }));
  const bk = await tx.select().from(t.bankLines).where(and(eq(t.bankLines.orgId, orgId), eq(t.bankLines.entityId, entityId))).orderBy(asc(t.bankLines.lineId));
  // [ASSUMPTION] a seeded fictional feed line ('seed_fictional') counts as a bank feed in test mode; csv_import never does.
  // rc7: an uploaded statement line ('file_import') is imported, not bank-authenticated, exactly like csv_import.
  const imported = (s: string) => s === "csv_import" || s === "file_import";
  // v1 Phase 0.5: whether the statement each imported line came from was confirmed by a second person (someone other
  // than the uploader), read from the stored confirmation, never from the file. It sets the line's bank evidence level
  // (imported_two_person_confirmed); nothing here can make a line bank-authenticated.
  const confirmed = await secondPersonConfirmed(tx, orgId, bk);
  const bankLines: BankLine[] = bk.map((b) => ({ bankLineId: b.lineId, account: b.account, currency: b.currency as FiatCurrency, valueDate: b.valueDate, amountMinor: b.amountMinor, description: b.description, source: imported(b.source) ? "csv_import" : "bank_feed", provenance: b.provenance ?? b.source,
    ...(imported(b.source) && confirmed.has(b.lineId) ? { secondPersonConfirmed: true as const } : {}) }));
  const fx = await tx.select().from(t.fxRates).where(and(eq(t.fxRates.orgId, orgId), eq(t.fxRates.entityId, entityId))).orderBy(asc(t.fxRates.pair), asc(t.fxRates.source), asc(t.fxRates.observedAt));
  // v1 (decision 9): recorded fiat rates INTO the entity's currency (USD/SGD for the SGD entity); shown, never used to tie
  const fr = await tx.select().from(t.fiatRates).where(and(eq(t.fiatRates.orgId, orgId), eq(t.fiatRates.quoteCurrency, ent.functionalCurrency)))
    .orderBy(asc(t.fiatRates.baseCurrency), asc(t.fiatRates.asOf), asc(t.fiatRates.sourceLabel));
  const fiatRates = fr.map((r) => ({ pair: `${r.baseCurrency}/${r.quoteCurrency}`, rate: normRate(r.rate), asOf: iso(r.asOf), source: r.sourceLabel }));
  const af = await tx.select().from(t.addressFacts).where(eq(t.addressFacts.orgId, orgId)).orderBy(asc(t.addressFacts.network), asc(t.addressFacts.address), asc(t.addressFacts.fact));
  return {
    label: TEST_MODE_LABEL, entity, policy, networks, tokens, invoices, quotes, paymentLinks, transfers, providerRecords, batches, batchLines,
    ...(settlementPaymentLines.length ? { settlementPaymentLines } : {}), bankLines,
    fxRates: fx.map((r) => ({ pair: r.pair, rate: normRate(r.rate), source: r.source, timestamp: iso(r.observedAt) })),
    ...(fiatRates.length ? { fiatRates } : {}),
    addressFacts: af.map((a) => ({ network: dbNetwork(a.network), address: a.address, fact: a.fact as ReconcileInput["addressFacts"][number]["fact"] })),
    ...(chainUnavailable.length ? { chainUnavailable } : {}),
  };
}

/**
 * v1 Phase 0.5: the imported bank lines whose statement a second person confirmed: an rc5 statement import that is
 * 'imported' with a confirmer other than its importer, or a v1 bank-statement upload with a confirmer other than its
 * uploader that was not rejected. Anything else (no confirmer, the same person, a seeded line) is not confirmed.
 */
async function secondPersonConfirmed(tx: Tx, orgId: string, lines: (typeof t.bankLines.$inferSelect)[]): Promise<Set<string>> {
  const importIds = [...new Set(lines.filter((l) => l.source === "csv_import" && l.importId).map((l) => l.importId!))];
  const uploadIds = [...new Set(lines.filter((l) => l.source === "file_import" && l.uploadId).map((l) => l.uploadId!))];
  const okImports = new Set(importIds.length ? (await tx.select({ id: t.statementImports.id, by: t.statementImports.importedBy, conf: t.statementImports.confirmedBy, status: t.statementImports.status })
    .from(t.statementImports).where(and(eq(t.statementImports.orgId, orgId), inArray(t.statementImports.id, importIds))))
    .filter((r) => r.status === "imported" && r.conf !== null && r.conf !== r.by).map((r) => r.id) : []);
  const okUploads = new Set(uploadIds.length ? (await tx.select({ id: t.uploads.id, by: t.uploads.uploadedBy, conf: t.uploads.confirmedBy, status: t.uploads.status, type: t.uploads.fileType })
    .from(t.uploads).where(and(eq(t.uploads.orgId, orgId), inArray(t.uploads.id, uploadIds))))
    .filter((r) => r.type === "bank_statement" && r.status !== "rejected" && r.conf !== null && r.conf !== r.by).map((r) => r.id) : []);
  return new Set(lines.filter((l) => (l.source === "csv_import" && l.importId && okImports.has(l.importId)) || (l.source === "file_import" && l.uploadId && okUploads.has(l.uploadId))).map((l) => l.lineId));
}

const txNorm = (network: string, h: string) => (network === "tron" ? h.toLowerCase().replace(/^0x/, "") : h.toLowerCase());

/**
 * rc7 phase 2: the chain reads that could not be done for this entity (the latest read of each address or transaction
 * is `unavailable`), plus every provider-claimed transaction no read has covered and no chain fact confirms yet.
 */
async function unavailableReads(tx: Tx, orgId: string, entityId: string, transfers: (typeof t.chainTransfers.$inferSelect)[]): Promise<ChainUnavailable[]> {
  // Every run records its chain reads, so this table grows by a few hundred rows a day. When no read of the entity is
  // `unavailable` (the usual case), only the transaction reads can matter below (the provider-claim check); the
  // address reads cannot produce an output. Both filters are leakproof, so PostgreSQL applies them before the
  // per-row RLS check instead of checking every read. Same result as reading every row.
  const where = and(eq(t.chainReads.orgId, orgId), eq(t.chainReads.entityId, entityId));
  // v1: a `conflicting` read (two providers disagree) is loaded exactly like an unavailable one, typed as conflicting
  const anyUnavailable = (await tx.select({ id: t.chainReads.id }).from(t.chainReads).where(and(where, or(eq(t.chainReads.status, "unavailable"), eq(t.chainReads.status, "conflicting")))).limit(1)).length > 0;
  const reads = await tx.select().from(t.chainReads).where(anyUnavailable ? where : and(where, isNotNull(t.chainReads.txHash)))
    .orderBy(asc(t.chainReads.at), asc(t.chainReads.id));
  const latest = new Map<string, typeof reads[number]>();
  for (const r of reads) {
    const n = dbNetwork(r.network);
    // ids order rows written in one run arbitrarily; within one instant an unavailable read wins (never hide an outage)
    const k = r.address !== null ? `a|${n}|${normAddress(n, r.address)}` : `t|${n}|${txNorm(n, r.txHash!)}`;
    const prev = latest.get(k);
    // within one instant a conflicting read wins over everything, then an unavailable one
    const rank = (x: typeof r) => (x.status === "conflicting" ? 2 : x.status === "unavailable" ? 1 : 0);
    if (!prev || prev.at.getTime() < r.at.getTime() || (prev.at.getTime() === r.at.getTime() && rank(r) >= rank(prev) && rank(r) > 0)) latest.set(k, r);
  }
  const out: ChainUnavailable[] = [...latest.values()].filter((r) => r.status === "unavailable" || r.status === "conflicting").map((r) => ({
    network: dbNetwork(r.network), ...(r.address !== null ? { address: r.address } : { txHash: r.txHash! }), source: r.host ? `${r.source} (${r.host})` : r.source,
    reason: r.reason ?? (r.status === "conflicting" ? "chain data conflicting" : "chain data unavailable"), at: iso(r.at), ...(r.status === "conflicting" ? { kind: "conflicting" as const } : {}),
  }));
  const facts = new Set(transfers.filter((c) => c.source !== "provider_export").map((c) => `${dbNetwork(c.network)}|${txNorm(c.network, c.txHash)}`));
  const seen = new Set<string>();
  for (const c of transfers) {
    if (c.source !== "provider_export") continue;
    const n = dbNetwork(c.network), k = `${n}|${txNorm(n, c.txHash)}`;
    if (facts.has(k) || latest.has(`t|${k}`) || seen.has(k)) continue;
    seen.add(k);
    out.push({ network: n, txHash: c.txHash, source: "not read", reason: "This transaction, claimed by a provider file, has not been read from the chain yet", at: iso(c.observedAt) });
  }
  return out.sort((a, b) => (`${a.network}|${a.address ?? a.txHash}` < `${b.network}|${b.address ?? b.txHash}` ? -1 : 1));
}

/** What one ingestion stores: adapter outputs (and bank lines / address facts, which are not adapter data). */
export type IngestParts = Partial<Pick<ReconcileInput, "invoices" | "quotes" | "paymentLinks" | "providerRecords" | "transfers" | "batches" | "batchLines" | "bankLines" | "fxRates" | "addressFacts">>;
export interface IngestOptions { chainSource: "recorded_fixture" | "chain_client" | "seed_fictional"; bankSource?: "bank_feed" | "seed_fictional"; finalised?: (t: ChainTransfer) => boolean }

/** Insert-only for facts; a transfer seen again only updates its confirmations and finality. Returns rows written. */
export async function writeIngested(tx: Tx, orgId: string, entityId: string, p: IngestParts, opts: IngestOptions): Promise<Record<string, number>> {
  const n: Record<string, number> = {};
  const count = (k: string, rows: unknown[]) => { n[k] = (n[k] ?? 0) + rows.length; };
  const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, orgId), eq(t.merchantEntities.id, entityId)));
  if (!ent) throw new MissingEntity(entityId);
  const quotes = p.quotes ?? [];
  if (p.invoices?.length) count("invoices", await tx.insert(t.invoices).values(p.invoices.map((i) => ({
    orgId, orderId: i.orderId, entityId, currency: i.currency, status: i.status === "void" ? "void" : "open",
    // v1: a token-priced invoice stores its token price and no fiat amount (exactly one pricing mode, migration 0040)
    ...(i.price ? { amountMinor: null, priceNetwork: i.price.token.network === "arbitrum_one" ? "arbitrum-one" : i.price.token.network, priceTokenContract: i.price.token.contract, priceTokenAmount: i.price.baseUnits.toString() }
      : { amountMinor: i.amountMinor }),
    // [ASSUMPTION] an invoice's issue time is its first quote's creation (the export carries no invoice date)
    issuedAt: new Date(quotes.filter((q) => q.orderId === i.orderId).map((q) => q.createdAt).sort()[0] ?? "2026-01-01T00:00:00.000Z"),
  }))).onConflictDoNothing().returning({ id: t.invoices.orderId }));
  if (quotes.length) count("quotes", await tx.insert(t.merchantQuotes).values(quotes.map((q) => ({
    orgId, quoteId: q.quoteId, orderId: q.orderId, network: q.network, tokenContract: q.token.contract, quotedBaseUnits: q.quotedBaseUnits.toString(), rate: q.rate,
    rateSource: q.rateSource, rateAt: new Date(q.rateAt), createdAt: new Date(q.createdAt), expiresAt: new Date(q.expiresAt), depositAddress: q.depositAddress,
  }))).onConflictDoNothing().returning({ id: t.merchantQuotes.quoteId }));
  const allQuotes = await tx.select().from(t.merchantQuotes).where(eq(t.merchantQuotes.orgId, orgId));
  const tokenRows = await tx.select().from(t.tokenConfig);
  const decimalsOf = (network: string, contract: string) => {
    const k = tokenRows.find((x) => dbNetwork(x.network) === network && x.contract === contract);
    if (!k) throw new Error(`token ${contract} on ${network} is not configured`);
    return k.decimals;
  };
  if (p.paymentLinks?.length) count("paymentLinks", await tx.insert(t.paymentLinks).values(p.paymentLinks.map((l) => {
    const q = allQuotes.find((x) => x.quoteId === l.quoteId);
    if (!q) throw new Error(`link ${l.linkId}: unknown quote ${l.quoteId}`);
    return {
      orgId, linkId: l.linkId, orderId: l.orderId, kind: l.kind, network: l.token.network, depositAddress: l.depositAddress, tokenContract: l.token.contract, quoteId: l.quoteId,
      requestedBaseUnits: l.requestedBaseUnits.toString(), requestedMinor: q.rate === null ? null : toFiatMinor(l.requestedBaseUnits, decimalsOf(l.token.network, l.token.contract), normRate(q.rate), ent.functionalCurrency as FiatCurrency),
      createdAt: new Date(l.createdAt), expiresAt: new Date(l.expiresAt),
    };
  })).onConflictDoNothing().returning({ id: t.paymentLinks.linkId }));
  if (p.providerRecords?.length) count("providerRecords", await tx.insert(t.providerPaymentRecords).values(p.providerRecords.map((r) => ({
    orgId, providerPaymentId: r.providerPaymentId, quoteId: r.ref.quoteId ?? null, linkId: r.ref.linkId ?? null, statusClaim: r.statusClaim,
    receivedBaseUnits: r.receivedBaseUnits.toString(), creditedMinor: r.creditedMinor, creditedCurrency: ent.functionalCurrency, executedRate: r.executedRate,
    feeMinor: r.feeMinor ?? null, batchId: r.batchId ?? null, record: plain({ ...r, note: "provider statuses are claims, not proof" }) as object,
  }))).onConflictDoNothing().returning({ id: t.providerPaymentRecords.providerPaymentId }));
  for (const c of p.transfers ?? []) {
    const finalised = opts.finalised ? opts.finalised(c) : true;
    const row = {
      orgId, network: c.network, txHash: c.txHash, logIndex: c.logIndex, tokenContract: c.tokenContract, fromAddress: c.from, toAddress: c.to,
      amountBaseUnits: c.amountBaseUnits.toString(), decimals: c.decimals, block: c.block, blockTime: new Date(c.timestamp), confirmations: c.confirmations, finalised,
      source: opts.chainSource, entityId, claimedSymbol: c.claimedSymbol ?? null, priorHops: c.priorHops ? (plain(c.priorHops) as object) : null,
    };
    count("transfers", await tx.insert(t.chainTransfers).values(row).onConflictDoUpdate({
      target: [t.chainTransfers.orgId, t.chainTransfers.network, t.chainTransfers.txHash, t.chainTransfers.logIndex, t.chainTransfers.source],
      set: { confirmations: row.confirmations, finalised: row.finalised, block: row.block },
    }).returning({ id: t.chainTransfers.txHash }));
  }
  if (p.batches?.length) count("batches", await tx.insert(t.settlementBatches).values(p.batches.map((b) => {
    const start = Date.parse(`${b.providerDay}T00:00:00.000Z`) - b.providerTimeZone.utcOffsetMinutes * 60_000;
    return {
      orgId, batchId: b.batchId, entityId, dayStart: new Date(start), dayEnd: new Date(start + 86_400_000), dayTimezone: b.providerTimeZone.name, dayUtcOffsetMinutes: b.providerTimeZone.utcOffsetMinutes,
      currency: b.currency, targetBankAccount: b.targetBankAccount, grossMinor: b.grossMinor, feesMinor: b.feesMinor, refundsMinor: b.refundsMinor, netMinor: b.netMinor,
    };
  })).onConflictDoNothing().returning({ id: t.settlementBatches.batchId }));
  const lineRows = [...new Set((p.batchLines ?? []).map((l) => l.batchId))].flatMap((batchId) =>
    (p.batchLines ?? []).filter((l) => l.batchId === batchId).sort((a, b) => ((a.kind + (a.providerPaymentId ?? a.refundId)) < (b.kind + (b.providerPaymentId ?? b.refundId)) ? -1 : 1))
      .map((l, i) => ({ orgId, batchId, lineNo: i + 1, kind: l.kind, ref: (l.kind === "payment" ? l.providerPaymentId : l.refundId) ?? "", amountMinor: l.amountMinor, orderId: l.orderId })));
  if (lineRows.length) count("batchLines", await tx.insert(t.settlementBatchLines).values(lineRows).onConflictDoNothing().returning({ id: t.settlementBatchLines.lineNo }));
  if (p.bankLines?.length) count("bankLines", await tx.insert(t.bankLines).values(p.bankLines.map((b) => ({
    orgId, lineId: b.bankLineId, account: b.account, currency: b.currency, valueDate: b.valueDate, amountMinor: b.amountMinor, description: b.description,
    source: b.source === "csv_import" ? "csv_import" : (opts.bankSource ?? "bank_feed"), entityId, provenance: b.provenance,
  }))).onConflictDoNothing().returning({ id: t.bankLines.lineId }));
  if (p.fxRates?.length) count("fxRates", await tx.insert(t.fxRates).values(p.fxRates.map((r) => ({ orgId, pair: r.pair, rate: r.rate, source: r.source, observedAt: new Date(r.timestamp), entityId })))
    .onConflictDoNothing().returning({ id: t.fxRates.pair }));
  if (p.addressFacts?.length) count("addressFacts", await tx.insert(t.addressFacts).values(p.addressFacts.map((a) => ({ orgId, network: a.network, address: a.address, fact: a.fact })))
    .onConflictDoNothing().returning({ id: t.addressFacts.address }));
  return n;
}
