/**
 * Shared builders for the rc6 acceptance fixtures. All names, addresses and hashes are fictional; the only real
 * values are the public USDT (TRON) and USDC (Ethereum) contracts.
 */
import { NETWORKS, TOKENS, USDC_ETHEREUM, USDT_TRON } from "../config";
import { TEST_MODE_LABEL, type ChainTransfer, type NetworkId, type ProviderPaymentRecord, type Quote, type TokenRef } from "../types";

export const label = TEST_MODE_LABEL;
export const USDT: TokenRef = { network: "tron", contract: USDT_TRON };
export const USDC: TokenRef = { network: "ethereum", contract: USDC_ETHEREUM };
export const networks = NETWORKS;
export const tokens = TOKENS;
export const UTC = { name: "UTC", utcOffsetMinutes: 0 };
export const SGT = { name: "Asia/Singapore", utcOffsetMinutes: 480 };
export const GST = { name: "Asia/Dubai", utcOffsetMinutes: 240 };

/** "1000.00" → 1000000000n (6-decimal base units). */
export const units = (text: string): bigint => {
  const [w, f = ""] = text.split(".");
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0"));
};
/** "1350.00" → 135000n (2-decimal minor units). */
export const minor = (text: string): bigint => {
  const neg = text.startsWith("-");
  const [w, f = ""] = text.replace("-", "").split(".");
  const v = BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
  return neg ? -v : v;
};

const addr = (network: NetworkId, tag: string): string => (network === "tron" ? `T_FICTIONAL_${tag}` : `0xfict${tag.toLowerCase()}`);
export const depositAddress = (token: TokenRef, tag: string): string => addr(token.network, `DEP_${tag}`);
export const walletAddress = (network: NetworkId, tag: string): string => addr(network, tag);
export const txHash = (network: NetworkId, tag: string): string => (network === "tron" ? `fict_tron_tx_${tag}` : `0xfict_eth_tx_${tag}`);

export function quote(orderId: string, token: TokenRef, quoted: string, rate: string, createdAt: string, minutesValid = 30, tag = orderId): Quote {
  const expiresAt = new Date(Date.parse(createdAt) + minutesValid * 60_000).toISOString();
  return {
    quoteId: `Q-${orderId.replace("BK-", "")}`, orderId, token, network: token.network, quotedBaseUnits: units(quoted), rate,
    rateSource: "Fictional Rate Desk", rateAt: createdAt, createdAt, expiresAt, depositAddress: depositAddress(token, tag),
  };
}

export function transfer(token: TokenRef, tag: string, to: string, from: string, amount: string, timestamp: string, block: number, confirmations = 40): ChainTransfer {
  return {
    network: token.network, tokenContract: token.contract, txHash: txHash(token.network, tag), logIndex: 0, from, to,
    amountBaseUnits: units(amount), decimals: 6, block, timestamp, confirmations,
  };
}

export function record(id: string, t: ChainTransfer, ref: ProviderPaymentRecord["ref"], statusClaim: ProviderPaymentRecord["statusClaim"], credited: string, executedRate: string, batchId?: string): ProviderPaymentRecord {
  return {
    providerPaymentId: id, ref, transferRef: { network: t.network, txHash: t.txHash, logIndex: t.logIndex }, statusClaim,
    receivedBaseUnits: t.amountBaseUnits, creditedMinor: minor(credited), executedRate, ...(batchId ? { batchId } : {}),
  };
}
