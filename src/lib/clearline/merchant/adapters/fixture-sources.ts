/**
 * The engine fixtures expressed as what a provider, a chain recording and a rate feed would deliver, so the seed and
 * the tests put data in through the adapters (not by writing engine objects directly). All values are fictional
 * except the two public token contracts. Test mode · illustrative data.
 */
import { FIAT_DECIMALS, TOKENS, normAddress } from "../config";
import { TEST_MODE_LABEL, type MerchantEntity, type MerchantPolicy, type ReconcileInput } from "../types";
import { fromUnits } from "./common";
import type { ProviderMapping } from "./provider-export";
import type { ProviderExportResult } from "./provider-export";
import type { SettlementResult } from "./settlement";

/** Column mapping of the fictional provider's export (Northwind Pay (fictional)). */
export const NORTHWIND_EXPORT_MAPPING: ProviderMapping = {
  provider: "Northwind Pay (fictional)",
  columns: {
    "Order": "orderId", "Order amount": "orderAmount", "Order currency": "orderCurrency",
    "Quote": "quoteId", "Quote network": "quoteNetwork", "Quote token": "quoteTokenContract", "Quote deposit address": "quoteDepositAddress",
    "Quoted amount": "quotedAmount", "Quote rate": "quoteRate", "Rate source": "quoteRateSource", "Rate time": "quoteRateAt",
    "Quote created": "quoteCreatedAt", "Quote expires": "quoteExpiresAt",
    "Link": "linkId", "Link kind": "linkKind", "Link network": "linkNetwork", "Link token": "linkTokenContract", "Link deposit address": "linkDepositAddress",
    "Link amount": "linkRequestedAmount", "Link created": "linkCreatedAt", "Link expires": "linkExpiresAt",
    "Payment": "providerPaymentId", "Tx hash": "txHash", "Log index": "logIndex", "Status": "statusClaim", "Dashboard status": "displayedStatus",
    "Received": "receivedAmount", "Credited": "creditedAmount", "Executed rate": "executedRate", "Fee": "feeAmount", "Batch": "batchId",
  },
};

const decimalsOf = (network: string, contract: string) => TOKENS.find((t) => t.network === network && normAddress(network, t.contract) === normAddress(network, contract))?.decimals ?? 6;

/** One export row per provider payment, plus one per quote/link that has no payment yet. */
export function providerExportRows(input: ReconcileInput): Record<string, string>[] {
  const fd = FIAT_DECIMALS[input.entity.functionalCurrency];
  const base = (orderId: string, quoteId: string) => {
    const inv = input.invoices.find((i) => i.orderId === orderId)!;
    const q = input.quotes.find((x) => x.quoteId === quoteId)!;
    return {
      "Order": inv.orderId, "Order amount": fromUnits(inv.amountMinor, FIAT_DECIMALS[inv.currency]), "Order currency": inv.currency,
      "Quote": q.quoteId, "Quote network": q.network, "Quote token": q.token.contract, "Quote deposit address": q.depositAddress,
      "Quoted amount": fromUnits(q.quotedBaseUnits, decimalsOf(q.network, q.token.contract)), "Quote rate": q.rate, "Rate source": q.rateSource,
      "Rate time": q.rateAt, "Quote created": q.createdAt, "Quote expires": q.expiresAt,
    };
  };
  const linkCols = (linkId?: string): Record<string, string> => {
    const l = input.paymentLinks.find((x) => x.linkId === linkId);
    return l ? {
      "Link": l.linkId, "Link kind": l.kind, "Link network": l.token.network, "Link token": l.token.contract, "Link deposit address": l.depositAddress,
      "Link amount": fromUnits(l.requestedBaseUnits, decimalsOf(l.token.network, l.token.contract)), "Link created": l.createdAt, "Link expires": l.expiresAt,
    } : {};
  };
  const rows: Record<string, string>[] = [];
  const covered = new Set<string>();
  for (const r of input.providerRecords) {
    const link = input.paymentLinks.find((l) => l.linkId === r.ref.linkId);
    const quoteId = link?.quoteId ?? r.ref.quoteId!;
    const orderId = input.quotes.find((q) => q.quoteId === quoteId)!.orderId;
    covered.add(`${quoteId}|${link?.linkId ?? ""}`);
    const tok = link?.token ?? input.quotes.find((q) => q.quoteId === quoteId)!.token;
    rows.push({
      ...base(orderId, quoteId), ...linkCols(link?.linkId), "Payment": r.providerPaymentId,
      ...(r.transferRef ? { "Tx hash": r.transferRef.txHash, "Log index": String(r.transferRef.logIndex) } : {}),
      "Status": r.statusClaim, ...(r.displayedStatus ? { "Dashboard status": r.displayedStatus } : {}),
      "Received": fromUnits(r.receivedBaseUnits, decimalsOf(tok.network, tok.contract)), "Credited": fromUnits(r.creditedMinor, fd), "Executed rate": r.executedRate,
      ...(r.feeMinor !== undefined ? { "Fee": fromUnits(r.feeMinor, fd) } : {}), ...(r.batchId ? { "Batch": r.batchId } : {}),
    });
  }
  for (const q of input.quotes) {
    const links = input.paymentLinks.filter((l) => l.quoteId === q.quoteId);
    for (const linkId of links.length ? links.map((l) => l.linkId) : [undefined]) {
      if (!covered.has(`${q.quoteId}|${linkId ?? ""}`)) rows.push({ ...base(q.orderId, q.quoteId), ...linkCols(linkId) });
    }
  }
  return rows;
}

export function toCsv(rows: readonly Record<string, string>[], header: readonly string[]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header.map(cell).join(","), ...rows.map((r) => header.map((h) => cell(r[h] ?? "")).join(","))].join("\n") + "\n";
}

export function settlementReport(input: ReconcileInput) {
  const fd = (c: keyof typeof FIAT_DECIMALS) => FIAT_DECIMALS[c];
  return {
    label: TEST_MODE_LABEL,
    batches: input.batches.map((b) => ({
      batchId: b.batchId, providerDay: b.providerDay, providerTimeZone: b.providerTimeZone, currency: b.currency, targetBankAccount: b.targetBankAccount,
      gross: fromUnits(b.grossMinor, fd(b.currency)), fees: fromUnits(b.feesMinor, fd(b.currency)), refunds: fromUnits(b.refundsMinor, fd(b.currency)), net: fromUnits(b.netMinor, fd(b.currency)),
    })),
    lines: input.batchLines.map((l) => ({
      batchId: l.batchId, kind: l.kind, ...(l.providerPaymentId ? { providerPaymentId: l.providerPaymentId } : {}), ...(l.refundId ? { refundId: l.refundId } : {}),
      orderId: l.orderId, amount: fromUnits(l.amountMinor, fd(input.batches.find((b) => b.batchId === l.batchId)?.currency ?? input.entity.functionalCurrency)),
    })),
  };
}

export function chainRecording(input: ReconcileInput) {
  return {
    label: TEST_MODE_LABEL,
    transfers: input.transfers.map((t) => ({
      network: t.network, txHash: t.txHash, logIndex: t.logIndex, tokenContract: t.tokenContract, ...(t.claimedSymbol ? { claimedSymbol: t.claimedSymbol } : {}),
      from: t.from, to: t.to, amountBaseUnits: t.amountBaseUnits.toString(), decimals: t.decimals, block: t.block, timestamp: t.timestamp, confirmations: t.confirmations,
      ...(t.priorHops ? { priorHops: t.priorHops.map((h) => ({ ...h })) } : {}),
    })),
  };
}

export const fxFeed = (input: ReconcileInput) => input.fxRates.map((r) => ({ pair: r.pair, rate: r.rate, source: r.source, observedAt: r.timestamp }));

/** The deposit addresses an entity watches: every quote's and every link's. */
export const watchedAddresses = (input: Pick<ReconcileInput, "quotes" | "paymentLinks">) =>
  [...input.quotes.map((q) => ({ network: q.network, address: q.depositAddress })), ...input.paymentLinks.map((l) => ({ network: l.token.network, address: l.depositAddress }))]
    .filter((x, i, xs) => xs.findIndex((y) => y.network === x.network && y.address === x.address) === i);

/** Assemble the engine input from adapter outputs (plus bank lines and address facts, which are not adapter data). */
export function assembleInput(base: { entity: MerchantEntity; policy: MerchantPolicy; networks: ReconcileInput["networks"]; tokens: ReconcileInput["tokens"] },
  parts: { provider: ProviderExportResult; settlement: SettlementResult; transfers: ReconcileInput["transfers"]; fxRates: ReconcileInput["fxRates"]; bankLines: ReconcileInput["bankLines"]; addressFacts: ReconcileInput["addressFacts"] }): ReconcileInput {
  return {
    label: TEST_MODE_LABEL, ...base,
    invoices: parts.provider.invoices, quotes: parts.provider.quotes, paymentLinks: parts.provider.paymentLinks, providerRecords: parts.provider.providerRecords,
    transfers: parts.transfers, batches: parts.settlement.batches, batchLines: parts.settlement.batchLines, bankLines: parts.bankLines, fxRates: parts.fxRates, addressFacts: parts.addressFacts,
  };
}
