// Which data source answers for each chain (spec section 3, revised 22 Oct, confirmed in week 3):
//   Tron                          TronGrid V1
//   Ethereum, Polygon, Arbitrum   Etherscan API V2, free key (all calls we need work on 1, 137, 42161)
//   BNB Chain, Base, Optimism     official public RPCs (Etherscan's free plan refuses 56, 8453, 10)
// Public RPCs are shared and rate-limited: fine for development, demos and a first pilot only.
//
// Without ETHERSCAN_API_KEY (24 Oct 2026: Etherscan V2 now answers every keyless call with
// "Missing/Invalid API Key"), Ethereum, Polygon and Arbitrum fall back to free public RPCs, so
// the product still runs with no keys at all. D07b sender history on Ethereum then has no source.

import type { EvmChain } from "../types";
import { EtherscanSource, etherscanClassifyBody, EvmFetcher, JsonRpcSource, jsonRpcClassifyBody, type EvmSource } from "./evm";
import { ChainClient, type Transport } from "./http";
import type { LiveDeps } from "./investigate";
import type { ResponseStore } from "./store";
import { tronClassifyBody, TronFetcher } from "./tron";

export type SourcePlan = { kind: "etherscan" } | { kind: "public-rpc"; url: string; minIntervalMs: number };

export const EVM_SOURCES: Record<EvmChain, SourcePlan> = {
  ethereum: { kind: "etherscan" },
  polygon: { kind: "etherscan" },
  arbitrum: { kind: "etherscan" },
  // About 10,000 requests per 5 minutes per IP (spec); eth_getLogs is disabled there, and not needed.
  bsc: { kind: "public-rpc", url: "https://bsc-dataseed.bnbchain.org", minIntervalMs: 100 },
  // Base docs: https://docs.base.org/base-chain/quickstart/connecting-to-base
  base: { kind: "public-rpc", url: "https://mainnet.base.org", minIntervalMs: 200 },
  // Optimism docs: https://docs.optimism.io/op-mainnet/network-information/connecting-to-op
  optimism: { kind: "public-rpc", url: "https://mainnet.optimism.io", minIntervalMs: 200 },
};

/** Keyless fallbacks for the Etherscan chains. All three answered eth_blockNumber on 24 Oct 2026. */
export const KEYLESS_RPC: Record<"ethereum" | "polygon" | "arbitrum", string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
};

export function planFor(chain: EvmChain, etherscanKey: string): SourcePlan {
  const plan = EVM_SOURCES[chain];
  if (plan.kind === "etherscan" && !etherscanKey) return { kind: "public-rpc", url: KEYLESS_RPC[chain as keyof typeof KEYLESS_RPC], minIntervalMs: 150 };
  return plan;
}

export interface FetcherOptions {
  tronKey: string;
  etherscanKey: string;
  store: ResponseStore;
  transport?: Transport;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Tests replay instantly; live use keeps each API's spacing. */
  noSpacing?: boolean;
}

export function buildFetchers(o: FetcherOptions): LiveDeps {
  const common = { store: o.store, transport: o.transport, now: o.now, sleep: o.sleep };
  const spacing = (ms: number) => (o.noSpacing ? 0 : ms);
  // One client per API host, so each keeps its own rate limit.
  // Etherscan's free plan allows 3 calls/s; 350 ms spacing still tripped it during week 3 recording.
  const etherscan = new ChainClient({ ...common, source: "etherscan", minIntervalMs: spacing(400), secretParams: ["apikey"],
    classifyBody: etherscanClassifyBody });
  const sources: Partial<Record<EvmChain, EvmSource>> = {};
  for (const chain of Object.keys(EVM_SOURCES) as EvmChain[]) {
    const plan = planFor(chain, o.etherscanKey);
    sources[chain] = plan.kind === "etherscan"
      ? new EtherscanSource(etherscan, o.etherscanKey, chain)
      : new JsonRpcSource(new ChainClient({ ...common, source: "public-rpc", minIntervalMs: spacing(plan.minIntervalMs),
          classifyBody: jsonRpcClassifyBody }), plan.url, chain);
  }
  return {
    tron: new TronFetcher(new ChainClient({ ...common, source: "trongrid", minIntervalMs: spacing(80), classifyBody: tronClassifyBody }), o.tronKey),
    evm: new EvmFetcher(sources),
    now: o.now,
  };
}
