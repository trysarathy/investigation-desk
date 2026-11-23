/**
 * Seeded synthetic "world" for Clearline merchant reconciliation: invoices, quotes, payment links, chain transfers,
 * provider payment records, settlement batches, bank lines and FX rates for one month. Every name, address, hash and
 * account is FICTIONAL (see fictional.ts); the only real values are the three public token contracts.
 *
 * Pure and deterministic: one seeded PRNG (prng.ts), and every instant derives from the month (or an injected `asOf`).
 * The world records, per order, the situation it was BUILT to show (`design`), from which truth.ts derives the
 * expected engine outcome under a given tolerance policy.
 */
import { bpsOf, toFiatMinor } from "../merchant/amounts";
import { NETWORKS } from "../merchant/config";
import type {
  AddressFact, BankLine, ChainTransfer, FiatCurrency, FxRate, Invoice, MerchantEntity, NetworkConfig, NetworkId, PaymentLink,
  ProviderPaymentRecord, ProviderStatusClaim, Quote, SettlementBatch, SettlementBatchLine, TimeZoneRef, TokenConfig, TokenRef, TransferRef,
} from "../merchant/types";
import {
  FICTIONAL_EMAIL_DOMAIN, SYNTHETIC_LABEL, USDC_ETH_CONTRACT, USDT_ETH_CONTRACT, USDT_TRON_CONTRACT, fictionalAddress, fictionalTxHash,
} from "./fictional";
import { TARGET_POLICY, type SyntheticPolicy } from "./policy";
import { createRng } from "./prng";
import { DAY_MS, MIN_MS, addDays, dateAt, iso, isBusinessDay, ms, nextBusinessDay, parseMonth } from "./time";

// ---------------------------------------------------------------- situations

/** What an order was built to show. */
export const SCENARIOS = [
  "exact", "duplicate_amount", "amount_coincidence", "sender_side_fee",
  "underpayment_within", "underpayment_beyond", "overpayment_within", "overpayment_beyond",
  "requote_within", "requote_beyond", "rate_difference", "credit_mismatch",
  "partial_open", "partial_completed", "held_by_provider", "unknown_batch",
  "pending_claimed_paid", "pending_claim", "no_chain_transfer", "lookalike_token",
  "late_settlement", "policy_band_small", "policy_band_large", "unpaid",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** Transfers that belong to no order, plus refunds (settlement-level events). */
export const EXTRAS = ["unattributed", "unattributed_amount_coincidence", "disabled_network", "lookalike_unattributed", "refund"] as const;
export type Extra = (typeof EXTRAS)[number];

/** Default share of orders per situation; "exact" takes the remainder. [ASSUMPTION] chosen for coverage, not from data. */
export const DEFAULT_MIX: Readonly<Record<Exclude<Scenario, "exact">, number>> = {
  duplicate_amount: 0.01, amount_coincidence: 0.01, sender_side_fee: 0.05,
  underpayment_within: 0.02, underpayment_beyond: 0.02, overpayment_within: 0.02, overpayment_beyond: 0.015,
  requote_within: 0.015, requote_beyond: 0.01, rate_difference: 0.03, credit_mismatch: 0.004,
  partial_open: 0.015, partial_completed: 0.015, held_by_provider: 0.0075, unknown_batch: 0.005,
  pending_claimed_paid: 0.004, pending_claim: 0.004, no_chain_transfer: 0.004, lookalike_token: 0.004,
  late_settlement: 0.02, policy_band_small: 0.005, policy_band_large: 0.005, unpaid: 0.02,
};
/** Extras as a share of paymentCount (at least one each). */
export const DEFAULT_EXTRAS: Readonly<Record<Extra, number>> = {
  unattributed: 0.004, unattributed_amount_coincidence: 0.002, disabled_network: 0.002, lookalike_unattributed: 0.001, refund: 0.005,
};

// ---------------------------------------------------------------- world types

export interface WorldEntitySpec { id: string; name: string; code: string; currency: FiatCurrency; timeZone: TimeZoneRef; ledger: string; bankAccountId: string; share: number }
export interface BankAccountSpec { accountId: string; currency: FiatCurrency; bankName: string; holderName: string; openingBalanceMinor: bigint }

export interface WorldParams {
  seed: number;
  /** YYYY-MM */
  month: string;
  paymentCount: number;
  entities?: readonly WorldEntitySpec[];
  bankAccounts?: readonly BankAccountSpec[];
  chains?: readonly ("tron" | "ethereum")[];
  /** Share of orders per situation (exact takes the rest). */
  mix?: Partial<Record<Exclude<Scenario, "exact">, number>>;
  extras?: Partial<Record<Extra, number>>;
  /** Minimum orders per situation (default 1, so every situation is present). */
  minPerScenario?: number;
  /** Only the first N days of the month carry payments (small presets). Default: every day. */
  activeDays?: number;
  /** Provider fee on each settlement batch's gross, basis points. [ASSUMPTION] 100 = 1%. */
  providerFeeBps?: number;
  policy?: SyntheticPolicy;
  /** Observation instant for confirmations ("now" of the data). Default: midnight UTC after the last active day. */
  asOf?: string;
  providerName?: string;
}

export interface Customer { customerId: string; name: string; email: string; wallets: Partial<Record<NetworkId, string[]>> }

/** The engine-relevant outcome of steps 1–3, fixed by how the order was built. */
export interface EarlyOutcome { decision: "suggested_for_review" | "exception"; step: 1 | 2 | 3; ruleId: string; owner: "Payment Operations" | "Treasury" | "Finance Controller" }

export interface PaymentDesign {
  providerPaymentId: string;
  transferKey?: string;
  /** Merchant-day (entity time zone) and provider-day (UTC) of the transfer the record points to, when it exists. */
  merchantDay?: string;
  transferProviderDay?: string;
  batchId?: string;
  held: boolean;
  creditedMinor: bigint;
}

export interface OrderDesign {
  scenario: Scenario;
  /** Every transfer that genuinely reached a deposit address issued for this order (the only correct attachments). */
  transferKeys: string[];
  early?: EarlyOutcome;
  tokenDiff?: { type: "sender_side_fee" | "underpayment" | "overpayment"; amountMinor: bigint };
  rateDiff?: { type: "rate_difference" | "requote_after_expiry"; amountMinor: bigint };
  /** Provider credit that is not received × executed rate (an unexplained difference). */
  unexplainedMinor?: bigint;
  /** credited − invoice while a balance link is open (negative). */
  partialOpenMinor?: bigint;
  payments: PaymentDesign[];
  /** Order ids this order shares an amount with (duplicate amount / amount-only coincidence). */
  lookAlikeOrderIds: string[];
  /** Situations beyond the scenario (e.g. day_boundary, shared_sender). */
  tags: string[];
}

export interface WorldOrder {
  orderId: string;
  entityId: string;
  customerId: string;
  issuedAt: string;
  description: string;
  invoice: Invoice;
  quoteIds: string[];
  linkIds: string[];
  design: OrderDesign;
}

/** Display facts about a provider record, for the file writers (what an export would show). */
export interface PaymentMeta {
  providerPaymentId: string;
  orderId: string;
  entityId: string;
  currency: FiatCurrency;
  createdAt: string;
  network: NetworkId;
  tokenSymbol: string;
  tokenContract: string;
  quotedBaseUnits: bigint;
  depositAddress: string;
  payerWallet?: string;
  displayedStatus: string;
  indicativeFeeMinor: bigint;
}

export interface TransferMeta {
  key: string;
  entityId: string;
  /** The order whose issued address it reached, or null for a transfer that belongs to no order. */
  orderId: string | null;
  extra?: Exclude<Extra, "refund">;
  /** For an amount-only coincidence: the order whose quoted amount it equals (but does NOT belong to). */
  coincidesWithOrderId?: string;
}

export interface RefundEvent { refundId: string; orderId: string; entityId: string; batchId: string; amountMinor: bigint }

export interface BankLineMeta { bankLineId: string; kind: "settlement" | "non_settlement"; batchId?: string; reason: string }

export interface SyntheticWorld {
  label: typeof SYNTHETIC_LABEL;
  seed: number;
  month: string;
  asOf: string;
  activeDays: number;
  providerName: string;
  providerFeeBps: number;
  policy: SyntheticPolicy;
  entities: MerchantEntity[];
  entitySpecs: WorldEntitySpec[];
  bankAccounts: BankAccountSpec[];
  networks: NetworkConfig[];
  tokens: TokenConfig[];
  customers: Customer[];
  orders: WorldOrder[];
  quotes: Quote[];
  paymentLinks: PaymentLink[];
  transfers: ChainTransfer[];
  transferMeta: TransferMeta[];
  providerRecords: ProviderPaymentRecord[];
  paymentMeta: PaymentMeta[];
  batches: SettlementBatch[];
  batchLines: SettlementBatchLine[];
  refunds: RefundEvent[];
  bankLines: BankLine[];
  bankLineMeta: BankLineMeta[];
  fxRates: FxRate[];
  addressFacts: AddressFact[];
  /** Every fictional address and hash the generator created (for the fictional-only guard). */
  generated: { addresses: string[]; txHashes: string[] };
}

// ---------------------------------------------------------------- defaults

export const SGT: TimeZoneRef = { name: "Asia/Singapore", utcOffsetMinutes: 480 };
export const UTC: TimeZoneRef = { name: "UTC", utcOffsetMinutes: 0 };

export const DEFAULT_ENTITIES: readonly WorldEntitySpec[] = [
  { id: "ENT-SG-SYN", code: "SG", name: "Kestrelbay Synthetic Pte. Ltd. (fictional)", currency: "SGD", timeZone: SGT, ledger: "LEDGER-SG-SYN", bankAccountId: "FICT-SGD-OPS-0001", share: 0.7 },
  { id: "ENT-US-SYN", code: "US", name: "Kestrelbay Synthetic Pte. Ltd., USD book (fictional)", currency: "USD", timeZone: SGT, ledger: "LEDGER-US-SYN", bankAccountId: "FICT-USD-OPS-0002", share: 0.3 },
];
export const DEFAULT_BANK_ACCOUNTS: readonly BankAccountSpec[] = [
  { accountId: "FICT-SGD-OPS-0001", currency: "SGD", bankName: "Fictional Harbour Bank (fictional)", holderName: "Kestrelbay Synthetic Pte. Ltd. (fictional)", openingBalanceMinor: 18_245_037n },
  { accountId: "FICT-USD-OPS-0002", currency: "USD", bankName: "Fictional Harbour Bank (fictional)", holderName: "Kestrelbay Synthetic Pte. Ltd. (fictional)", openingBalanceMinor: 6_412_250n },
];

const TOKENS_ALL: readonly TokenConfig[] = [
  { network: "tron", contract: USDT_TRON_CONTRACT, symbol: "USDT", decimals: 6 },
  { network: "ethereum", contract: USDC_ETH_CONTRACT, symbol: "USDC", decimals: 6 },
  { network: "ethereum", contract: USDT_ETH_CONTRACT, symbol: "USDT", decimals: 6 },
];
const BLOCK_MS: Readonly<Partial<Record<NetworkId, number>>> = { tron: 3_000, ethereum: 12_000, polygon: 2_000 };
const BLOCK_BASE: Readonly<Partial<Record<NetworkId, number>>> = { tron: 70_400_000, ethereum: 23_850_000, polygon: 79_100_000 };

export const transferKey = (r: TransferRef): string => `${r.network}|${r.txHash}|${r.logIndex}`;
const U = 1_000_000n; // 6-decimal token base units
const cents = (n: bigint) => n * 10_000n; // token hundredths → base units

// ---------------------------------------------------------------- generator

interface Plan { scenario: Scenario; entity: WorldEntitySpec; day: number; tsMs: number; boundary: boolean; key: number }

export function generateWorld(params: WorldParams): SyntheticWorld {
  const rng = createRng(params.seed);
  const r = {
    plan: rng.fork("plan"), addr: rng.fork("addresses"), amt: rng.fork("amounts"), time: rng.fork("time"), fx: rng.fork("fx"),
    bank: rng.fork("bank"), extra: rng.fork("extras"), cust: rng.fork("customers"),
  };
  const { startMs, days } = parseMonth(params.month);
  const activeDays = Math.min(params.activeDays ?? days, days);
  if (activeDays < 4) throw new RangeError("activeDays must be at least 4");
  const asOfMs = params.asOf ? ms(params.asOf) : startMs + activeDays * DAY_MS;
  const policy = params.policy ?? TARGET_POLICY;
  const feeBps = params.providerFeeBps ?? 100;
  const providerName = params.providerName ?? "Fictional Pay Provider";
  const entitySpecs = [...(params.entities ?? DEFAULT_ENTITIES)];
  const bankAccounts = [...(params.bankAccounts ?? DEFAULT_BANK_ACCOUNTS)];
  const chains = new Set<NetworkId>(params.chains ?? ["tron", "ethereum"]);
  const tokens = TOKENS_ALL.filter((t) => chains.has(t.network));
  if (tokens.length === 0) throw new RangeError("at least one chain is required");
  const networks = NETWORKS.map((n) => ({ ...n }));
  const entities: MerchantEntity[] = entitySpecs.map((e) => ({ id: e.id, name: e.name, functionalCurrency: e.currency, ledger: e.ledger, timeZone: e.timeZone }));
  const acctOf = (e: WorldEntitySpec) => {
    const a = bankAccounts.find((b) => b.accountId === e.bankAccountId);
    if (!a || a.currency !== e.currency) throw new RangeError(`entity ${e.id} needs a ${e.currency} bank account`);
    return a;
  };
  entitySpecs.forEach(acctOf);

  // ---- fictional identifiers (unique)
  const addresses = new Set<string>();
  const hashes = new Set<string>();
  const newAddress = (network: NetworkId): string => {
    for (;;) { const a = fictionalAddress(network === "tron" ? "tron" : "ethereum", r.addr); if (!addresses.has(a)) { addresses.add(a); return a; } }
  };
  const newHash = (network: NetworkId): string => {
    for (;;) { const h = fictionalTxHash(network === "tron" ? "tron" : "ethereum", r.addr); if (!hashes.has(h)) { hashes.add(h); return h; } }
  };

  // ---- customers and well-known (fictional) exchange wallets
  const customers: Customer[] = [];
  const nCustomers = Math.max(12, Math.ceil(params.paymentCount / 4));
  for (let i = 1; i <= nCustomers; i++) {
    const id = String(i).padStart(4, "0");
    const wallets: Customer["wallets"] = {};
    for (const n of chains) wallets[n] = Array.from({ length: r.cust.int(1, 2) }, () => newAddress(n));
    customers.push({ customerId: `C-${id}`, name: `Fictional Customer ${id}`, email: `buyer${id}@${FICTIONAL_EMAIL_DOMAIN}`, wallets });
  }
  const exchangeWallets: Partial<Record<NetworkId, string[]>> = {};
  for (const n of chains) exchangeWallets[n] = [newAddress(n), newAddress(n), newAddress(n)];
  const addressFacts: AddressFact[] = [];
  for (const n of chains) for (const a of exchangeWallets[n]!) addressFacts.push({ network: n, address: a, fact: "exchange_hot_wallet" });
  for (const c of customers.slice(0, Math.ceil(customers.length / 3))) for (const n of chains) addressFacts.push({ network: n, address: c.wallets[n]![0], fact: "registered_wallet" });

  // ---- FX rates: one per day and pair [ASSUMPTION: a daily rate desk fix at 00:00 UTC is the quote rate].
  const fxRates: FxRate[] = [];
  const rateOf = new Map<string, string>();
  let sgd = 13_480; // 1.3480 in 1/10000
  for (let d = -2; d < days + 7; d++) {
    const date = dateAt(startMs + d * DAY_MS, 0);
    sgd = Math.min(13_650, Math.max(13_300, sgd + r.fx.int(-15, 15)));
    const usdcSgd = sgd + r.fx.int(-4, 4);
    const usdtUsd = r.fx.pick([9_998, 9_999, 10_000, 10_000, 10_000, 10_001]);
    const put = (pair: string, v: number) => {
      const rate = `${Math.floor(v / 10_000)}.${String(v % 10_000).padStart(4, "0")}`;
      rateOf.set(`${pair}|${date}`, rate);
      fxRates.push({ pair, rate, source: "Fictional Rate Desk", timestamp: `${date}T00:00:00.000Z` });
    };
    put("USDT/SGD", sgd); put("USDC/SGD", usdcSgd); put("USDT/USD", usdtUsd); put("USDC/USD", 10_000);
  }
  const fx = (symbol: string, cur: FiatCurrency, atMs: number): string => {
    const v = rateOf.get(`${symbol}/${cur}|${dateAt(atMs, 0)}`);
    if (!v) throw new RangeError(`no FX rate for ${symbol}/${cur} at ${iso(atMs)}`);
    return v;
  };

  // ---- allocate situations
  const mix = { ...DEFAULT_MIX, ...(params.mix ?? {}) };
  const minEach = params.minPerScenario ?? 1;
  const counts = new Map<Scenario, number>();
  let used = 0;
  for (const s of SCENARIOS) {
    if (s === "exact") continue;
    const units = s === "duplicate_amount" || s === "amount_coincidence" ? 2 : 1; // these come in pairs of orders
    const c = Math.max(minEach, Math.round((mix[s] * params.paymentCount) / units));
    counts.set(s, c);
    used += c * units;
  }
  const exactCount = params.paymentCount - used;
  if (exactCount < 2) throw new RangeError(`paymentCount ${params.paymentCount} is too small for the situation mix (needs > ${used + 1})`);
  counts.set("exact", exactCount);

  const pickEntity = (): WorldEntitySpec => r.plan.weighted(entitySpecs.map((e) => [e, e.share] as const));
  // UTC hour weights: SGT business hours (UTC 0–10) heaviest; UTC 16–24 is the next merchant day in SGT.
  const HOURS = Array.from({ length: 24 }, (_, h) => [h, h < 10 ? 6 : h < 16 ? 3 : 1.4] as const);
  const lastDay = activeDays;
  const timeOn = (day: number, opts: { maxHour?: number; minHour?: number } = {}): number => {
    for (;;) {
      const h = r.time.weighted(HOURS);
      if ((opts.maxHour !== undefined && h > opts.maxHour) || (opts.minHour !== undefined && h < opts.minHour)) continue;
      const t = startMs + (day - 1) * DAY_MS + h * 3_600_000 + r.time.int(0, 3_599) * 1000;
      if (t > asOfMs - 30 * MIN_MS) continue; // anything not built to be pending is long final
      return t;
    }
  };
  const plans: Plan[] = [];
  let key = 0;
  let forcedBoundary = 0;
  for (const s of SCENARIOS) {
    for (let i = 0; i < counts.get(s)!; i++) {
      const entity = pickEntity();
      let day = r.plan.int(1, lastDay);
      let tsMs: number;
      let boundary = false;
      if (s === "pending_claimed_paid" || s === "pending_claim") { day = lastDay; tsMs = asOfMs; } // set precisely later
      else if (s === "late_settlement") { day = r.plan.int(1, lastDay - 1); tsMs = timeOn(day, { maxHour: 15 }); }
      else if (s === "partial_completed") { day = r.plan.int(1, lastDay - 3); tsMs = timeOn(day, { maxHour: 15 }); }
      else if (s === "exact" && forcedBoundary < 2 * entitySpecs.length && day < lastDay) { tsMs = timeOn(day, { minHour: 16 }); forcedBoundary++; }
      else tsMs = timeOn(day);
      if (s !== "pending_claimed_paid" && s !== "pending_claim") boundary = dateAt(tsMs, entity.timeZone.utcOffsetMinutes) !== dateAt(tsMs, 0);
      plans.push({ scenario: s, entity, day, tsMs, boundary, key: key++ });
    }
  }
  plans.sort((a, b) => a.tsMs - b.tsMs || a.key - b.key);

  // ---- builders
  const orders: WorldOrder[] = [];
  const quotes: Quote[] = [];
  const paymentLinks: PaymentLink[] = [];
  const transfers: ChainTransfer[] = [];
  const transferMeta: TransferMeta[] = [];
  const providerRecords: ProviderPaymentRecord[] = [];
  const paymentMeta: PaymentMeta[] = [];
  const seqByEntity = new Map<string, number>();
  const yymm = params.month.slice(2, 4) + params.month.slice(5, 7);
  let paySeq = 0;
  const batchIdFor = (e: WorldEntitySpec, utcDate: string) => `B-${e.currency}-${utcDate.replace(/-/g, "")}`;
  const pickToken = (): TokenConfig => {
    const opts = tokens.map((t) => [t, t.network === "tron" ? 55 : t.symbol === "USDC" ? 30 : 15] as const);
    return r.plan.weighted(opts);
  };
  const tron = tokens.find((t) => t.network === "tron");
  const eth = tokens.filter((t) => t.network === "ethereum");
  const tref = (t: TokenConfig): TokenRef => ({ network: t.network, contract: t.contract });
  const confirmationsAt = (network: NetworkId, tMs: number) => Math.floor((asOfMs - tMs) / BLOCK_MS[network]!);
  const blockAt = (network: NetworkId, tMs: number) => BLOCK_BASE[network]! + Math.floor((tMs - startMs) / BLOCK_MS[network]!);
  const amountBetween = (lo: number, hi: number): bigint => cents(BigInt(r.amt.int(lo * 100, hi * 100)));
  const logUniformAmount = (lo: number, hi: number): bigint => {
    const v = Math.exp(Math.log(lo) + r.amt.next() * (Math.log(hi) - Math.log(lo)));
    return cents(BigInt(Math.max(1, Math.round(v * 100))));
  };
  const fiat = (base: bigint, rate: string, cur: FiatCurrency) => toFiatMinor(base, 6, rate, cur);

  function makeTransfer(o: { token: TokenConfig | { network: NetworkId; contract: string; symbol?: string }; to: string; from: string; amount: bigint; tMs: number; meta: Omit<TransferMeta, "key">; claimedSymbol?: string }): ChainTransfer {
    const network = o.token.network;
    const claimedSymbol = o.claimedSymbol ?? ("symbol" in o.token ? o.token.symbol : undefined);
    const t: ChainTransfer = {
      network, txHash: newHash(network), logIndex: network === "tron" ? 0 : r.addr.int(0, 240), tokenContract: o.token.contract,
      ...(claimedSymbol ? { claimedSymbol } : {}), from: o.from, to: o.to, amountBaseUnits: o.amount, decimals: 6,
      block: blockAt(network, o.tMs), timestamp: iso(o.tMs), confirmations: confirmationsAt(network, o.tMs),
    };
    transfers.push(t);
    transferMeta.push({ key: transferKey(t), ...o.meta });
    return t;
  }

  function makeRecord(o: {
    order: WorldOrder; entity: WorldEntitySpec; ref: ProviderPaymentRecord["ref"]; transfer?: ChainTransfer; fakeRef?: TransferRef; omitRef?: boolean;
    status: ProviderStatusClaim; displayed: string; received: bigint; credited: bigint; rate: string; batchId?: string; createdMs: number;
    token: TokenConfig; quoted: bigint; deposit: string; payer?: string; held?: boolean;
  }): ProviderPaymentRecord {
    paySeq++;
    const pid = `PAY-${yymm}-${String(paySeq).padStart(6, "0")}`;
    const transferRef = o.omitRef ? undefined : o.fakeRef ?? (o.transfer ? { network: o.transfer.network, txHash: o.transfer.txHash, logIndex: o.transfer.logIndex } : undefined);
    const rec: ProviderPaymentRecord = {
      providerPaymentId: pid, ref: o.ref, ...(transferRef ? { transferRef } : {}), statusClaim: o.status, displayedStatus: o.displayed,
      receivedBaseUnits: o.received, creditedMinor: o.credited, executedRate: o.rate, ...(o.batchId ? { batchId: o.batchId } : {}),
    };
    providerRecords.push(rec);
    paymentMeta.push({
      providerPaymentId: pid, orderId: o.order.orderId, entityId: o.entity.id, currency: o.entity.currency, createdAt: iso(o.createdMs), network: o.token.network,
      tokenSymbol: o.token.symbol, tokenContract: o.token.contract, quotedBaseUnits: o.quoted, depositAddress: o.deposit, ...(o.payer ? { payerWallet: o.payer } : {}),
      displayedStatus: o.displayed, indicativeFeeMinor: bpsOf(o.credited, feeBps),
    });
    const real = !o.omitRef && !o.fakeRef && !!o.transfer;
    o.order.design.payments.push({
      providerPaymentId: pid, ...(real ? { transferKey: transferKey(o.transfer!), merchantDay: dateAt(ms(o.transfer!.timestamp), o.entity.timeZone.utcOffsetMinutes), transferProviderDay: dateAt(ms(o.transfer!.timestamp), 0) } : {}),
      ...(o.batchId ? { batchId: o.batchId } : {}), held: !!o.held, creditedMinor: o.credited,
    });
    return rec;
  }

  function newOrder(plan: Plan, issuedMs: number, invoiceMinor: bigint, customer: Customer): WorldOrder {
    const n = (seqByEntity.get(plan.entity.id) ?? 0) + 1;
    seqByEntity.set(plan.entity.id, n);
    const orderId = `${plan.entity.code}-${yymm}-${String(n).padStart(5, "0")}`;
    const o: WorldOrder = {
      orderId, entityId: plan.entity.id, customerId: customer.customerId, issuedAt: iso(issuedMs),
      description: r.plan.pick(["Wholesale order (fictional)", "Subscription renewal (fictional)", "Hardware order (fictional)", "Services invoice (fictional)", "Event booking (fictional)"]),
      invoice: { orderId, entityId: plan.entity.id, amountMinor: invoiceMinor, currency: plan.entity.currency, status: "open" },
      quoteIds: [], linkIds: [], design: { scenario: plan.scenario, transferKeys: [], payments: [], lookAlikeOrderIds: [], tags: plan.boundary ? ["day_boundary"] : [] },
    };
    orders.push(o);
    return o;
  }

  function newQuote(o: WorldOrder, token: TokenConfig, quoted: bigint, rate: string, createdMs: number, validMin = 30): Quote {
    const q: Quote = {
      quoteId: `QT-${o.orderId}`, orderId: o.orderId, token: tref(token), network: token.network, quotedBaseUnits: quoted, rate,
      rateSource: "Fictional Rate Desk", rateAt: iso(createdMs - (createdMs % DAY_MS)), createdAt: iso(createdMs), expiresAt: iso(createdMs + validMin * MIN_MS),
      depositAddress: newAddress(token.network),
    };
    quotes.push(q);
    o.quoteIds.push(q.quoteId);
    return q;
  }

  /** One standard order: quote → one transfer → one provider record. */
  function standard(plan: Plan, opts: {
    token?: TokenConfig; quoted?: bigint; received?: (quoted: bigint, rate: string, cur: FiatCurrency) => bigint; status?: ProviderStatusClaim; displayed?: string;
    execRate?: (rate: string) => string; lateMin?: number; batchDayOffset?: number; unbatched?: boolean; held?: boolean; omitRef?: boolean;
    creditDelta?: bigint; from?: string; unknownBatch?: boolean; customer?: Customer; tMs?: number; qCreatedMs?: number;
  } = {}) {
    const e = plan.entity;
    const cur = e.currency;
    const token = opts.token ?? pickToken();
    const tMs = opts.tMs ?? plan.tsMs;
    const late = opts.lateMin ?? 0;
    const qCreated = opts.qCreatedMs ?? (late > 0 ? tMs - (30 + late) * MIN_MS : tMs - r.time.int(60, 25 * 60) * 1000);
    const rate = fx(token.symbol, cur, qCreated);
    const quoted = opts.quoted ?? logUniformAmount(25, 9_000);
    const customer = opts.customer ?? r.plan.pick(customers);
    const o = newOrder(plan, qCreated - r.time.int(0, 180) * MIN_MS, fiat(quoted, rate, cur), customer);
    const q = newQuote(o, token, quoted, rate, qCreated);
    const received = opts.received ? opts.received(quoted, rate, cur) : quoted;
    const exec = opts.execRate ? opts.execRate(rate) : rate;
    const from = opts.from ?? r.plan.pick(customer.wallets[token.network]!);
    const t = makeTransfer({ token, to: q.depositAddress, from, amount: received, tMs, meta: { entityId: e.id, orderId: o.orderId } });
    o.design.transferKeys.push(transferKey(t));
    const utcDay = dateAt(tMs, 0);
    const batchId = opts.unbatched ? undefined : opts.unknownBatch ? `${batchIdFor(e, utcDay)}-02` : batchIdFor(e, addDays(utcDay, opts.batchDayOffset ?? 0));
    const credited = fiat(received, exec, cur) + (opts.creditDelta ?? 0n);
    makeRecord({
      order: o, entity: e, ref: { quoteId: q.quoteId }, transfer: t, omitRef: opts.omitRef, status: opts.status ?? "paid", displayed: opts.displayed ?? "Paid",
      received, credited, rate: exec, batchId, createdMs: tMs, token, quoted, deposit: q.depositAddress, payer: from, held: opts.held,
    });
    return { o, q, t, token, rate, quoted, received, exec, credited, qCreated };
  }

  /** A second order quoted just after the first, on the same UTC day (same rate), paid within its window. */
  const sibling = (qA: number, tA: number): { qB: number; tB: number } => {
    let qB = qA + r.time.int(1, 4) * MIN_MS;
    if (dateAt(qB, 0) !== dateAt(qA, 0)) qB = qA;
    const tB = Math.min(Math.max(tA, qB + MIN_MS) + r.time.int(0, 3) * MIN_MS, qB + 29 * MIN_MS);
    return { qB, tB };
  };
  const tokenPart = (received: bigint, rate: string, cur: FiatCurrency, inv: bigint) => fiat(received, rate, cur) - inv;
  const ratePart = (received: bigint, exec: string, rate: string, cur: FiatCurrency) => fiat(received, exec, cur) - fiat(received, rate, cur);
  const shiftRate = (rate: string, deltaTenThousandths: number): string => {
    const v = Number(rate.replace(".", "")) + deltaTenThousandths;
    return `${Math.floor(v / 10_000)}.${String(v % 10_000).padStart(4, "0")}`;
  };
  const fixedOf = (cur: FiatCurrency) => policy.fixedMinor[cur];
  /** Small, policy-independent gap: 0 < |gap| ≤ min(0.5% of the invoice, fixed). Retries the draw until it holds. */
  const smallGapTokens = (cur: FiatCurrency): [number, number] => (cur === "USD" ? [2.1, 4.8] : [2.1, 3.4]);

  // ---- materialise plans
  const unpaidOrders: { o: WorldOrder; token: TokenConfig; quoted: bigint }[] = [];
  const exactOrders: { o: WorldOrder; token: TokenConfig; quoted: bigint; batchId: string; credited: bigint }[] = [];
  for (const plan of plans) {
    const e = plan.entity;
    const cur = e.currency;
    switch (plan.scenario) {
      case "exact": {
        const x = standard(plan);
        exactOrders.push({ o: x.o, token: x.token, quoted: x.quoted, batchId: x.o.design.payments[0].batchId!, credited: x.credited });
        break;
      }
      case "late_settlement": standard(plan, { batchDayOffset: 1 }); break;
      case "duplicate_amount": {
        const token = pickToken();
        const quoted = amountBetween(200, 3_000);
        const shared = r.plan.chance(0.5) ? r.plan.pick(exchangeWallets[token.network]!) : undefined;
        const a = standard(plan, { token, quoted, ...(shared ? { from: shared } : {}) });
        const { qB, tB } = sibling(a.qCreated, plan.tsMs);
        const b = standard({ ...plan, tsMs: tB, boundary: dateAt(tB, e.timeZone.utcOffsetMinutes) !== dateAt(tB, 0) }, { token, quoted, qCreatedMs: qB, tMs: tB, ...(shared ? { from: shared } : {}) });
        if (b.o.invoice.amountMinor !== a.o.invoice.amountMinor) throw new Error("duplicate_amount: invoices must be identical (same day, same rate)");
        a.o.design.lookAlikeOrderIds.push(b.o.orderId); b.o.design.lookAlikeOrderIds.push(a.o.orderId);
        if (shared) { a.o.design.tags.push("shared_sender"); b.o.design.tags.push("shared_sender"); }
        break;
      }
      case "amount_coincidence": {
        const token = pickToken();
        const qa = amountBetween(1_000, 5_000);
        const a = standard({ ...plan, scenario: "exact" }, { token, quoted: qa });
        a.o.design.scenario = "amount_coincidence";
        const [lo, hi] = smallGapTokens(cur);
        for (;;) {
          const s = amountBetween(lo, hi);
          const qb = qa + s;
          const rate = a.rate;
          const gap = tokenPart(qa, rate, cur, fiat(qb, rate, cur));
          if (gap === 0n || -gap > fixedOf(cur) || -gap > bpsOf(fiat(qb, rate, cur), policy.toleranceBps)) continue;
          const { qB, tB } = sibling(a.qCreated, plan.tsMs);
          const b = standard({ ...plan, tsMs: tB, boundary: dateAt(tB, e.timeZone.utcOffsetMinutes) !== dateAt(tB, 0) }, { token, quoted: qb, qCreatedMs: qB, tMs: tB, received: () => qa, status: "underpaid", displayed: "Underpaid" });
          if (b.rate !== rate) throw new Error("amount_coincidence: both orders must quote on the same day");
          b.o.design.tokenDiff = { type: "underpayment", amountMinor: tokenPart(qa, rate, cur, b.o.invoice.amountMinor) };
          a.o.design.lookAlikeOrderIds.push(b.o.orderId); b.o.design.lookAlikeOrderIds.push(a.o.orderId);
          b.o.design.tags.push("received_equals_other_order_quote");
          break;
        }
        break;
      }
      case "sender_side_fee": {
        const token = pickToken();
        const fee = amountBetween(0.5, 2.0);
        const x = standard(plan, { token, quoted: amountBetween(1_000, 6_000), received: (q) => q - fee, displayed: "Completed", from: r.plan.pick(exchangeWallets[token.network]!) });
        x.o.design.tokenDiff = { type: "sender_side_fee", amountMinor: tokenPart(x.received, x.rate, cur, x.o.invoice.amountMinor) };
        x.o.design.tags.push("exchange_sender");
        break;
      }
      case "underpayment_within": case "overpayment_within": {
        const over = plan.scenario === "overpayment_within";
        const [lo, hi] = over ? [0.1, smallGapTokens(cur)[1]] : smallGapTokens(cur);
        const gapTok = amountBetween(lo, hi);
        const x = standard(plan, { quoted: amountBetween(1_000, 6_000), received: (q) => (over ? q + gapTok : q - gapTok), status: over ? "overpaid" : "underpaid", displayed: over ? "Overpaid" : "Underpaid" });
        x.o.design.tokenDiff = { type: over ? "overpayment" : "underpayment", amountMinor: tokenPart(x.received, x.rate, cur, x.o.invoice.amountMinor) };
        break;
      }
      case "underpayment_beyond": case "overpayment_beyond": {
        const over = plan.scenario === "overpayment_beyond";
        const pct = BigInt(r.amt.int(500, 2_000)); // 5%–20% in basis points
        const x = standard(plan, { quoted: amountBetween(800, 6_000), received: (q) => { const d = cents((q * pct) / 10_000n / 10_000n); return over ? q + d : q - d; }, status: over ? "overpaid" : "underpaid", displayed: over ? "Overpaid" : r.plan.pick(["Underpaid", "Completed"]) });
        x.o.design.tokenDiff = { type: over ? "overpayment" : "underpayment", amountMinor: tokenPart(x.received, x.rate, cur, x.o.invoice.amountMinor) };
        break;
      }
      case "rate_difference": case "requote_within": case "requote_beyond": {
        const requote = plan.scenario !== "rate_difference";
        const beyond = plan.scenario === "requote_beyond";
        const token = pickToken();
        const quoted = amountBetween(1_000, 6_000);
        // Choose the executed-rate shift before building, so the rate part lands where the situation needs it.
        const lateMin = requote ? r.time.int(3, 25) : 0;
        const qCreatedMs = requote ? plan.tsMs - (30 + lateMin) * MIN_MS : plan.tsMs - r.time.int(1, 25) * MIN_MS;
        const probeRate = fx(token.symbol, cur, qCreatedMs);
        let delta = 0;
        for (;;) {
          delta = beyond ? r.amt.pick([-1, 1]) * r.amt.int(70, 160) : r.amt.pick([-1, 1]) * r.amt.int(1, 9);
          const rp = ratePart(quoted, shiftRate(probeRate, delta), probeRate, cur);
          const inv = fiat(quoted, probeRate, cur);
          const maxBand = bpsOf(inv, policy.toleranceBps) > fixedOf(cur) ? bpsOf(inv, policy.toleranceBps) : fixedOf(cur);
          if (beyond ? (rp < 0n ? -rp : rp) > maxBand : rp !== 0n && (rp < 0n ? -rp : rp) <= fixedOf(cur) && (rp < 0n ? -rp : rp) <= bpsOf(inv, policy.toleranceBps)) break;
        }
        const x = standard(plan, { token, quoted, lateMin, qCreatedMs, execRate: (rate) => shiftRate(rate, delta), status: requote ? "re_quoted" : "paid", displayed: requote ? "Completed" : "Paid" });
        if (x.rate !== probeRate) throw new Error("rate scenario: quote rate moved");
        x.o.design.rateDiff = { type: requote ? "requote_after_expiry" : "rate_difference", amountMinor: ratePart(x.received, x.exec, x.rate, cur) };
        break;
      }
      case "credit_mismatch": {
        const delta = BigInt(r.amt.pick([-1, 1]) * r.amt.int(1, 60));
        const x = standard(plan, { quoted: amountBetween(500, 4_000), creditDelta: delta });
        x.o.design.unexplainedMinor = delta;
        break;
      }
      case "held_by_provider": {
        const x = standard(plan, { status: "held_for_review", displayed: "Completed", unbatched: true, held: true });
        x.o.design.early = { decision: "exception", step: 3, ruleId: "M3.batch.held_by_provider", owner: "Treasury" };
        x.o.design.tags.push("misleading_completed");
        break;
      }
      case "unknown_batch": {
        const x = standard(plan, { displayed: "Completed", unknownBatch: true, omitRef: true });
        x.o.design.early = { decision: "exception", step: 3, ruleId: "M3.batch.unknown_batch", owner: "Payment Operations" };
        break;
      }
      case "pending_claimed_paid": case "pending_claim": {
        const token = pickToken();
        const ageS = token.network === "tron" ? r.time.int(6, 54) : r.time.int(24, 140);
        const claimed = plan.scenario === "pending_claimed_paid";
        const x = standard(plan, {
          token, tMs: asOfMs - ageS * 1000, status: claimed ? "paid" : "pending", displayed: claimed ? "Completed" : "Confirming",
          ...(claimed ? {} : { unbatched: true, omitRef: true }),
        });
        x.o.design.early = { decision: "suggested_for_review", step: 1, ruleId: "M1.finality.pending", owner: "Payment Operations" };
        x.o.design.tags.push("not_final");
        if (claimed) x.o.design.tags.push("misleading_completed");
        break;
      }
      case "no_chain_transfer": {
        const token = pickToken();
        const qCreated = plan.tsMs - r.time.int(2, 20) * MIN_MS;
        const rate = fx(token.symbol, cur, qCreated);
        const quoted = logUniformAmount(50, 5_000);
        const customer = r.plan.pick(customers);
        const o = newOrder(plan, qCreated - r.time.int(0, 120) * MIN_MS, fiat(quoted, rate, cur), customer);
        const q = newQuote(o, token, quoted, rate, qCreated);
        makeRecord({
          order: o, entity: e, ref: { quoteId: q.quoteId }, fakeRef: { network: token.network, txHash: newHash(token.network), logIndex: 0 }, status: "paid", displayed: "Completed",
          received: quoted, credited: fiat(quoted, rate, cur), rate, createdMs: plan.tsMs, token, quoted, deposit: q.depositAddress,
        });
        o.design.early = { decision: "exception", step: 2, ruleId: "M2.reference.no_chain_transfer", owner: "Payment Operations" };
        o.design.tags.push("misleading_completed");
        break;
      }
      case "lookalike_token": {
        const token = tron ?? tokens[0];
        const qCreated = plan.tsMs - r.time.int(2, 20) * MIN_MS;
        const rate = fx(token.symbol, cur, qCreated);
        const quoted = logUniformAmount(50, 5_000);
        const customer = r.plan.pick(customers);
        const o = newOrder(plan, qCreated - r.time.int(0, 120) * MIN_MS, fiat(quoted, rate, cur), customer);
        const q = newQuote(o, token, quoted, rate, qCreated);
        const fake = { network: token.network, contract: newAddress(token.network) };
        const t = makeTransfer({ token: fake, claimedSymbol: token.symbol, to: q.depositAddress, from: r.plan.pick(customer.wallets[token.network]!), amount: quoted, tMs: plan.tsMs, meta: { entityId: e.id, orderId: o.orderId } });
        o.design.transferKeys.push(transferKey(t));
        o.design.early = { decision: "exception", step: 1, ruleId: "M1.identity.lookalike_token", owner: "Treasury" };
        break;
      }
      case "unpaid": {
        const token = pickToken();
        const qCreated = plan.tsMs;
        const rate = fx(token.symbol, cur, qCreated);
        const quoted = amountBetween(100, 4_000);
        const o = newOrder(plan, qCreated - r.time.int(0, 120) * MIN_MS, fiat(quoted, rate, cur), r.plan.pick(customers));
        newQuote(o, token, quoted, rate, qCreated);
        unpaidOrders.push({ o, token, quoted });
        break;
      }
      case "policy_band_small": case "policy_band_large": {
        const large = plan.scenario === "policy_band_large";
        const over = r.amt.chance(0.5);
        const token = pickToken();
        const qCreatedMs = plan.tsMs - r.time.int(1, 25) * MIN_MS;
        const probeRate = fx(token.symbol, cur, qCreatedMs);
        let quoted = 0n, gapTok = 0n;
        for (;;) {
          quoted = large ? amountBetween(3_000, 7_000) : amountBetween(120, 360);
          gapTok = large ? amountBetween(5, Math.floor(Number(quoted / U) * 0.004)) : amountBetween(2.1, smallGapTokens(cur)[1]);
          const inv = fiat(quoted, probeRate, cur);
          const g = tokenPart(over ? quoted + gapTok : quoted - gapTok, probeRate, cur, inv);
          const a = g < 0n ? -g : g;
          const pct = bpsOf(inv, policy.toleranceBps);
          const fixed = fixedOf(cur);
          // small: pct < |gap| ≤ fixed (inside the larger band, outside the smaller); large: fixed < |gap| ≤ pct.
          if (large ? a > fixed && a <= pct : a > pct && a <= fixed) break;
        }
        const x = standard(plan, { token, quoted, qCreatedMs, received: (q) => (over ? q + gapTok : q - gapTok), status: over ? "overpaid" : "underpaid", displayed: over ? "Overpaid" : "Underpaid" });
        if (x.rate !== probeRate) throw new Error("policy scenario: quote rate moved");
        x.o.design.tokenDiff = { type: over ? "overpayment" : "underpayment", amountMinor: tokenPart(x.received, x.rate, cur, x.o.invoice.amountMinor) };
        x.o.design.tags.push("policy_sensitive");
        break;
      }
      case "partial_open": case "partial_completed": {
        const completed = plan.scenario === "partial_completed";
        const t1 = tron ?? tokens[0];
        const otherChain = eth.length ? r.plan.pick(eth) : t1;
        const qCreated = plan.tsMs - r.time.int(2, 20) * MIN_MS;
        const rate = fx(t1.symbol, cur, qCreated);
        const customer = r.plan.pick(customers);
        let quoted = 0n, part1 = 0n;
        for (;;) {
          quoted = cents(BigInt(r.amt.int(1_500, 8_000)) * 100n); // whole tokens
          part1 = completed ? (quoted * BigInt(r.amt.int(40, 70))) / 100n / U * U : cents((quoted * BigInt(r.amt.int(35, 70))) / 100n / 10_000n);
          if (!completed) break;
          // A completed split must round additively, so it ties to the cent with no unexplained rate part.
          if (fiat(part1, rate, cur) + fiat(quoted - part1, rate, cur) === fiat(quoted, rate, cur)) break;
        }
        const o = newOrder(plan, qCreated - r.time.int(0, 120) * MIN_MS, fiat(quoted, rate, cur), customer);
        const q = newQuote(o, t1, quoted, rate, qCreated, 60);
        const full: PaymentLink = { linkId: `PL-${o.orderId}-F`, orderId: o.orderId, quoteId: q.quoteId, kind: "full", token: tref(t1), depositAddress: q.depositAddress, requestedBaseUnits: quoted, createdAt: q.createdAt, expiresAt: q.expiresAt };
        const from1 = r.plan.pick(customer.wallets[t1.network]!);
        const tr1 = makeTransfer({ token: t1, to: full.depositAddress, from: from1, amount: part1, tMs: plan.tsMs, meta: { entityId: e.id, orderId: o.orderId } });
        o.design.transferKeys.push(transferKey(tr1));
        const balToken = r.plan.chance(0.6) ? otherChain : t1;
        const balToken2 = completed ? otherChain : balToken;
        const balCreated = plan.tsMs + r.time.int(10, 180) * MIN_MS;
        const bal: PaymentLink = {
          linkId: `PL-${o.orderId}-B`, orderId: o.orderId, quoteId: q.quoteId, kind: "balance", token: tref(balToken2), depositAddress: newAddress(balToken2.network),
          requestedBaseUnits: quoted - part1, createdAt: iso(balCreated), expiresAt: iso(balCreated + 72 * 60 * MIN_MS),
        };
        paymentLinks.push(full, bal);
        o.linkIds.push(full.linkId, bal.linkId);
        const credited1 = fiat(part1, rate, cur);
        makeRecord({
          order: o, entity: e, ref: { linkId: full.linkId }, transfer: tr1, status: "partially_paid", displayed: "Partially paid", received: part1, credited: credited1, rate,
          batchId: batchIdFor(e, dateAt(plan.tsMs, 0)), createdMs: plan.tsMs, token: t1, quoted, deposit: full.depositAddress, payer: from1,
        });
        if (completed) {
          const t2Ms = Math.min(balCreated + r.time.int(1, 3) * DAY_MS - r.time.int(0, 600) * MIN_MS, balCreated + 71 * 60 * MIN_MS);
          const from2 = r.plan.chance(0.5) ? r.plan.pick(exchangeWallets[balToken2.network]!) : r.plan.pick(customer.wallets[balToken2.network]!);
          const tr2 = makeTransfer({ token: balToken2, to: bal.depositAddress, from: from2, amount: quoted - part1, tMs: t2Ms, meta: { entityId: e.id, orderId: o.orderId } });
          o.design.transferKeys.push(transferKey(tr2));
          makeRecord({
            order: o, entity: e, ref: { linkId: bal.linkId }, transfer: tr2, status: "paid", displayed: "Completed", received: quoted - part1, credited: fiat(quoted - part1, rate, cur), rate,
            batchId: batchIdFor(e, dateAt(t2Ms, 0)), createdMs: t2Ms, token: balToken2, quoted: quoted - part1, deposit: bal.depositAddress, payer: from2,
          });
          if (balToken2.network !== t1.network) o.design.tags.push("two_chains");
        } else {
          o.design.partialOpenMinor = credited1 - o.invoice.amountMinor;
        }
        break;
      }
    }
  }

  // ---- transfers that belong to no order
  const extras = { ...DEFAULT_EXTRAS, ...(params.extras ?? {}) };
  const nExtra = (x: Extra) => Math.max(1, Math.round(extras[x] * params.paymentCount));
  const extraTime = () => timeOn(r.extra.int(1, lastDay));
  for (let i = 0; i < nExtra("unattributed"); i++) {
    const token = r.extra.pick(tokens);
    const c = r.extra.pick(customers);
    makeTransfer({ token, to: newAddress(token.network), from: r.extra.pick(c.wallets[token.network]!), amount: logUniformAmount(20, 4_000), tMs: extraTime(), meta: { entityId: r.extra.pick(entitySpecs).id, orderId: null, extra: "unattributed" } });
  }
  for (let i = 0; i < nExtra("unattributed_amount_coincidence"); i++) {
    const target = unpaidOrders.length && (i % 2 === 0 || exactOrders.length === 0) ? r.extra.pick(unpaidOrders) : r.extra.pick(exactOrders);
    const c = r.extra.pick(customers);
    makeTransfer({
      token: target.token, to: newAddress(target.token.network), from: r.extra.pick(c.wallets[target.token.network]!), amount: target.quoted, tMs: extraTime(),
      meta: { entityId: target.o.entityId, orderId: null, extra: "unattributed_amount_coincidence", coincidesWithOrderId: target.o.orderId },
    });
  }
  for (let i = 0; i < nExtra("disabled_network"); i++) {
    const fake = { network: "polygon" as const, contract: newAddress("polygon"), symbol: "USDC" };
    makeTransfer({ token: fake, to: newAddress("polygon"), from: newAddress("polygon"), amount: logUniformAmount(20, 2_000), tMs: extraTime(), meta: { entityId: r.extra.pick(entitySpecs).id, orderId: null, extra: "disabled_network" } });
  }
  for (let i = 0; i < nExtra("lookalike_unattributed"); i++) {
    const token = tron ?? tokens[0];
    makeTransfer({ token: { network: token.network, contract: newAddress(token.network) }, claimedSymbol: token.symbol, to: newAddress(token.network), from: newAddress(token.network), amount: logUniformAmount(20, 2_000), tMs: extraTime(), meta: { entityId: r.extra.pick(entitySpecs).id, orderId: null, extra: "lookalike_unattributed" } });
  }

  // ---- settlement batches (one per entity and UTC provider day)
  const byBatch = new Map<string, { e: WorldEntitySpec; day: string; recs: ProviderPaymentRecord[] }>();
  const entityOfPid = new Map(paymentMeta.map((m) => [m.providerPaymentId, entitySpecs.find((e) => e.id === m.entityId)!]));
  const realBatchIds = new Set<string>();
  for (const rec of providerRecords) {
    if (!rec.batchId || /-02$/.test(rec.batchId)) continue;
    const e = entityOfPid.get(rec.providerPaymentId)!;
    const day = `${rec.batchId.slice(-8, -4)}-${rec.batchId.slice(-4, -2)}-${rec.batchId.slice(-2)}`;
    const g = byBatch.get(rec.batchId) ?? { e, day, recs: [] };
    g.recs.push(rec);
    byBatch.set(rec.batchId, g);
    realBatchIds.add(rec.batchId);
  }
  const batchLines: SettlementBatchLine[] = [];
  const orderOfPid = new Map(paymentMeta.map((m) => [m.providerPaymentId, m.orderId]));
  const sortedBatchIds = [...byBatch.keys()].sort();
  for (const id of sortedBatchIds) {
    for (const rec of byBatch.get(id)!.recs) batchLines.push({ batchId: id, kind: "payment", providerPaymentId: rec.providerPaymentId, orderId: orderOfPid.get(rec.providerPaymentId)!, amountMinor: rec.creditedMinor });
  }
  const gross = new Map(sortedBatchIds.map((id) => [id, byBatch.get(id)!.recs.reduce((t, x) => t + x.creditedMinor, 0n)]));
  // Refunds netted in a later batch of the same entity.
  const refunds: RefundEvent[] = [];
  const refundTotals = new Map<string, bigint>();
  const refundable = exactOrders.filter((x) => realBatchIds.has(x.batchId));
  for (let i = 0; i < nExtra("refund") && refundable.length; i++) {
    const src = r.extra.pick(refundable);
    const later = sortedBatchIds.filter((id) => byBatch.get(id)!.e.id === src.o.entityId && id > src.batchId && byBatch.get(id)!.day <= addDays(byBatch.get(src.batchId)!.day, 6));
    if (!later.length) continue;
    const target = r.extra.pick(later);
    const amount = r.extra.chance(0.6) ? src.credited : (src.credited * BigInt(r.extra.int(30, 70))) / 100n;
    const g = gross.get(target)!;
    const already = refundTotals.get(target) ?? 0n;
    if (g - bpsOf(g, feeBps) - already - amount <= 0n || refunds.some((x) => x.orderId === src.o.orderId)) continue;
    const refundId = `RF-${yymm}-${String(refunds.length + 1).padStart(4, "0")}`;
    refunds.push({ refundId, orderId: src.o.orderId, entityId: src.o.entityId, batchId: target, amountMinor: amount });
    refundTotals.set(target, already + amount);
    batchLines.push({ batchId: target, kind: "refund", refundId, orderId: src.o.orderId, amountMinor: amount });
  }
  const batches: SettlementBatch[] = sortedBatchIds.map((id) => {
    const g = byBatch.get(id)!;
    const grossMinor = gross.get(id)!;
    const feesMinor = bpsOf(grossMinor, feeBps);
    const refundsMinor = refundTotals.get(id) ?? 0n;
    return { batchId: id, providerDay: g.day, providerTimeZone: UTC, currency: g.e.currency, targetBankAccount: g.e.bankAccountId, grossMinor, feesMinor, refundsMinor, netMinor: grossMinor - feesMinor - refundsMinor };
  });

  // ---- bank lines: each batch settles on the next business day after its provider day, some one business day later.
  const rawBank: { line: Omit<BankLine, "bankLineId">; meta: Omit<BankLineMeta, "bankLineId"> }[] = [];
  for (const b of batches) {
    let valueDate = nextBusinessDay(b.providerDay);
    if (r.bank.chance(0.15)) valueDate = nextBusinessDay(valueDate);
    rawBank.push({
      line: { account: b.targetBankAccount, currency: b.currency, valueDate, amountMinor: b.netMinor, description: `${providerName.toUpperCase()} SETTLEMENT ${b.batchId}`, source: "bank_feed", provenance: `synthetic statement ${b.targetBankAccount} ${params.month}` },
      meta: { kind: "settlement", batchId: b.batchId, reason: `Net of settlement batch ${b.batchId}.` },
    });
  }
  for (const a of bankAccounts) {
    const businessDays = Array.from({ length: activeDays }, (_, i) => dateAt(startMs + i * DAY_MS, 0)).filter(isBusinessDay);
    const others: [string, bigint, string, string][] = [
      [businessDays[Math.min(businessDays.length - 1, 2)], -BigInt(r.bank.int(2_500, 4_500)), "ACCOUNT MAINTENANCE FEE (FICTIONAL)", "Bank's monthly account fee: not a settlement."],
      [businessDays[Math.floor(businessDays.length / 2)], -(a.openingBalanceMinor / 10n + BigInt(r.bank.int(0, 99_999))), "OUTWARD TRANSFER TO FICTIONAL SUPPLIER LTD", "Merchant's own outgoing payment: not a settlement."],
      [businessDays[businessDays.length - 1], BigInt(r.bank.int(500, 9_000)), "CREDIT INTEREST (FICTIONAL)", "Interest credited by the bank: not a settlement."],
    ];
    for (const [valueDate, amountMinor, description, reason] of others)
      rawBank.push({ line: { account: a.accountId, currency: a.currency, valueDate, amountMinor, description, source: "bank_feed", provenance: `synthetic statement ${a.accountId} ${params.month}` }, meta: { kind: "non_settlement", reason } });
  }
  rawBank.sort((x, y) => (x.line.account < y.line.account ? -1 : x.line.account > y.line.account ? 1 : x.line.valueDate < y.line.valueDate ? -1 : x.line.valueDate > y.line.valueDate ? 1 : x.line.description < y.line.description ? -1 : 1));
  const bankLines: BankLine[] = [];
  const bankLineMeta: BankLineMeta[] = [];
  rawBank.forEach((x, i) => {
    const bankLineId = `BL-${x.line.currency}-${String(i + 1).padStart(5, "0")}`;
    bankLines.push({ bankLineId, ...x.line });
    bankLineMeta.push({ bankLineId, ...x.meta });
  });

  return {
    label: SYNTHETIC_LABEL, seed: params.seed, month: params.month, asOf: iso(asOfMs), activeDays, providerName, providerFeeBps: feeBps, policy,
    entities, entitySpecs, bankAccounts, networks, tokens, customers, orders, quotes, paymentLinks, transfers, transferMeta, providerRecords, paymentMeta,
    batches, batchLines, refunds, bankLines, bankLineMeta, fxRates, addressFacts,
    generated: { addresses: [...addresses].sort(), txHashes: [...hashes].sort() },
  };
}
