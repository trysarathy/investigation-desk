/**
 * v1 E1: every host Clearline's server may call, by purpose. Adding a host is a reviewed code change here (or, for an
 * operator-configured endpoint such as an RPC URL, the deployment's own setting). tests/platform/outbound-fetch.test.ts
 * checks that every https host literal in the outbound modules is listed.
 */
import { policyWithUrls, type OutboundPolicy } from "./safe-fetch";

/** Legacy investigation desk chain lookups (src/lib/chain): TronGrid, Etherscan, Blockscout and keyless public RPCs. */
export const CHAIN_LEGACY_POLICY: OutboundPolicy = {
  name: "chain-legacy",
  hosts: [
    "api.trongrid.io", "api.etherscan.io", "eth.blockscout.com",
    "bsc-dataseed.bnbchain.org", "mainnet.base.org", "mainnet.optimism.io",
    "eth.drpc.org", "polygon.drpc.org", "arb1.arbitrum.io",
  ],
};

/**
 * Merchant chain readers (src/lib/clearline/merchant/chain): TronGrid (or TRONGRID_BASE_URL) and the configured RPC URLs'
 * hosts: Ethereum, the primary/fallback providers per network and the flagged networks (wave 2: c4's environment names,
 * src/lib/clearline/merchant/chain/networks.ts). An unset variable adds nothing.
 */
export const MERCHANT_CHAIN_URL_ENVS = [
  "TRONGRID_BASE_URL", "TRON_FALLBACK_BASE_URL", "ETHEREUM_RPC_URL", "ETHEREUM_FALLBACK_RPC_URL",
  "POLYGON_RPC_URL", "POLYGON_FALLBACK_RPC_URL", "BASE_RPC_URL", "BASE_FALLBACK_RPC_URL",
  "ARBITRUM_ONE_RPC_URL", "ARBITRUM_ONE_FALLBACK_RPC_URL", "SOLANA_RPC_URL", "SOLANA_FALLBACK_RPC_URL",
] as const;
export function merchantChainPolicy(env: Readonly<Record<string, string | undefined>>): OutboundPolicy {
  return policyWithUrls("chain-merchant", ["api.trongrid.io"], MERCHANT_CHAIN_URL_ENVS.map((k) => env[k]));
}

/**
 * Accounting ledgers (src/lib/accounting): Xero (OAuth token + API) and the QuickBooks SANDBOX only. The production
 * QuickBooks host is deliberately absent: QuickBooks is not offered and next.config.mjs refuses QBO_ENV=production.
 */
export const LEDGER_POLICY: OutboundPolicy = {
  name: "ledger",
  hosts: ["identity.xero.com", "api.xero.com", "sandbox-quickbooks.api.intuit.com"],
};

/** AI explanations (src/lib/ai): the Anthropic API, or the operator's ANTHROPIC_BASE_URL host when one is set. */
export function aiPolicy(env: Readonly<Record<string, string | undefined>> = process.env): OutboundPolicy {
  return policyWithUrls("ai", ["api.anthropic.com"], [env.ANTHROPIC_BASE_URL]);
}
