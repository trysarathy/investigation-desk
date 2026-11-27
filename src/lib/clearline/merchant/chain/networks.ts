/**
 * v1 phase 2.4: per-network chain-reading specs: the finality rule, the token contract allowlist the readers recognise,
 * and the flag that turns live reads on. TRON and Ethereum keep their rc7 behaviour (on whenever their keys are set).
 * Polygon, Base, Arbitrum One and Solana are OFF unless their flag is exactly "1" (CLEARLINE_CHAIN_<NETWORK>=1).
 *
 * Reading a network is not matching on it: the engine still needs the network enabled in network_config and the token
 * in token_config (both unchanged here; enabling them is an approval-only owner action).
 *
 * Token allowlists: only real public contracts verified against an authoritative public source, cited per entry.
 * Where the issuer's own page could not be reached from this build environment, the list is EMPTY on purpose
 * (transfers of that token are then reported as look-alike facts and never as payments).
 */
import type { TokenConfig } from "../types";
import type { ChainNetwork } from "./model";

/**
 * How a transfer becomes final on a network:
 * - "depth": confirmations (head − block + 1) ≥ the network's confirmationsRequired, then a second receipt read must
 *   return the same block (and block hash where the source gives one).
 * - "finalized_tag": the same depth rule AND the block is at or below the node's `finalized` block (eth_getBlockByNumber
 *   "finalized"); on L2s that is the L2 block whose batch is final on Ethereum. Both must hold (the stricter wins).
 * - "commitment": Solana: the transaction is returned under commitment "finalized", the depth rule holds against the
 *   confirmed slot, and a second read returns the same slot.
 */
export type FinalityRule = { kind: "depth" } | { kind: "finalized_tag" } | { kind: "commitment" };

export interface NetworkReadSpec {
  network: ChainNetwork;
  name: string;
  finality: FinalityRule;
  /** Env flag that must be exactly "1" for live reads; undefined = on whenever its provider settings are present (rc7). */
  flag?: string;
  /** Env names of the primary and fallback provider endpoints (an RPC URL may embed a key; it is redacted everywhere). */
  primaryEnv: string;
  fallbackEnv: string;
  tokens: readonly TokenConfig[];
}

/** Circle's published USDC addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses (checked 2026-11-25). */
export const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_ARBITRUM_ONE = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * USDT on Polygon, Arbitrum One and Solana: NOT listed. Tether's own page (tether.to) could not be reached from the
 * build environment, so no address could be verified against the issuer; the lists stay empty until someone checks it
 * and adds the entry with its citation. Tether does not issue USDT on Base (no entry by design, not by omission).
 * Bridged variants (USDC.e on Polygon/Arbitrum, USDbC on Base) are not the native token and are never listed.
 */
export const NETWORK_READ_SPECS: Readonly<Record<ChainNetwork, NetworkReadSpec>> = {
  tron: { network: "tron", name: "TRON", finality: { kind: "depth" }, primaryEnv: "TRONGRID_API_KEY", fallbackEnv: "TRON_FALLBACK_BASE_URL", tokens: [] },
  ethereum: { network: "ethereum", name: "Ethereum", finality: { kind: "depth" }, primaryEnv: "ETHEREUM_RPC_URL", fallbackEnv: "ETHEREUM_FALLBACK_RPC_URL", tokens: [] },
  polygon: {
    network: "polygon", name: "Polygon", finality: { kind: "finalized_tag" }, flag: "CLEARLINE_CHAIN_POLYGON", primaryEnv: "POLYGON_RPC_URL", fallbackEnv: "POLYGON_FALLBACK_RPC_URL",
    tokens: [{ network: "polygon", contract: USDC_POLYGON, symbol: "USDC", decimals: 6 }],
  },
  base: {
    network: "base", name: "Base", finality: { kind: "finalized_tag" }, flag: "CLEARLINE_CHAIN_BASE", primaryEnv: "BASE_RPC_URL", fallbackEnv: "BASE_FALLBACK_RPC_URL",
    tokens: [{ network: "base", contract: USDC_BASE, symbol: "USDC", decimals: 6 }],
  },
  arbitrum_one: {
    network: "arbitrum_one", name: "Arbitrum One", finality: { kind: "finalized_tag" }, flag: "CLEARLINE_CHAIN_ARBITRUM_ONE", primaryEnv: "ARBITRUM_ONE_RPC_URL", fallbackEnv: "ARBITRUM_ONE_FALLBACK_RPC_URL",
    tokens: [{ network: "arbitrum_one", contract: USDC_ARBITRUM_ONE, symbol: "USDC", decimals: 6 }],
  },
  solana: {
    network: "solana", name: "Solana", finality: { kind: "commitment" }, flag: "CLEARLINE_CHAIN_SOLANA", primaryEnv: "SOLANA_RPC_URL", fallbackEnv: "SOLANA_FALLBACK_RPC_URL",
    tokens: [{ network: "solana", contract: USDC_SOLANA_MINT, symbol: "USDC", decimals: 6 }],
  },
};

/** The v1 networks that are read only behind a flag. */
export const FLAGGED_NETWORKS = ["polygon", "base", "arbitrum_one", "solana"] as const satisfies readonly ChainNetwork[];
export type FlaggedNetwork = (typeof FLAGGED_NETWORKS)[number];

/** True only when the network's flag is exactly "1" (TRON and Ethereum have no flag: always true). Default OFF. */
export function networkFlagOn(network: ChainNetwork, env: Record<string, string | undefined>): boolean {
  const f = NETWORK_READ_SPECS[network].flag;
  return f === undefined || env[f] === "1";
}

/** Every token the v1 readers recognise on the flagged networks (TRON and Ethereum come from ../config TOKENS). */
export const V1_NETWORK_TOKENS: readonly TokenConfig[] = FLAGGED_NETWORKS.flatMap((n) => NETWORK_READ_SPECS[n].tokens);

/** EIP-55 mixed-case checksum check for a 0x address (lower- or upper-only addresses are not checksummed). */
export function isEip55Checksummed(address: string, keccakHex: (s: string) => string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const a = address.slice(2), h = keccakHex(a.toLowerCase());
  for (let i = 0; i < 40; i++) {
    const c = a[i];
    if (/[a-f]/.test(c) && parseInt(h[i], 16) >= 8) return false;
    if (/[A-F]/.test(c) && parseInt(h[i], 16) < 8) return false;
  }
  return true;
}
