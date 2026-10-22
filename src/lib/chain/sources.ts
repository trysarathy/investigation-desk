import { FallbackSource } from "./adapters";
// Which data source answers for each chain (spec section 3, revised 22 Oct, confirmed in week 3):
//   Tron                          TronGrid V1
//   Ethereum, Polygon, Arbitrum   Etherscan API V2, free key (all calls we need work on 1, 137, 42161)
//   BNB Chain, Base, Optimism     official public RPCs (Etherscan's free plan refuses 56, 8453, 10)
// Public RPCs are shared and rate-limited: fine for development, demos and a first pilot only.

import type { EvmChain } from "../types";
import {
  EtherscanSource,
  etherscanClassifyBody,
  EvmFetcher,
  JsonRpcSource,
  jsonRpcClassifyBody,
  type EvmSource,
} from "./evm";
import { ChainClient, type Transport } from "./http";
import type { LiveDeps } from "./investigate";
import type { ResponseStore } from "./store";
import { tronClassifyBody, TronFetcher } from "./tron";

export type SourcePlan =
  | { kind: "etherscan" }
  | { kind: "public-rpc"; url: string; minIntervalMs: number };

export const EVM_SOURCES: Record<EvmChain, SourcePlan> = {
  ethereum: { kind: "etherscan" },
  polygon: { kind: "etherscan" },
  arbitrum: { kind: "etherscan" },
  // About 10,000 requests per 5 minutes per IP (spec); eth_getLogs is disabled there, and not needed.
  bsc: {
    kind: "public-rpc",
    url: "https://bsc-dataseed.bnbchain.org",
    minIntervalMs: 100,
  },
  // Base docs: https://docs.base.org/base-chain/quickstart/connecting-to-base
  base: {
    kind: "public-rpc",
    url: "https://mainnet.base.org",
    minIntervalMs: 200,
  },
  // Optimism docs: https://docs.optimism.io/op-mainnet/network-information/connecting-to-op
  optimism: {
    kind: "public-rpc",
    url: "https://mainnet.optimism.io",
    minIntervalMs: 200,
  },
};

export interface FetcherOptions {
  tronKey: string;
  etherscanKey: string;
  store: ResponseStore;
  transport?: Transport;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Tests replay instantly; live use keeps each API's spacing. */
  noSpacing?: boolean;
  /** Operator-configured read-only RPC URLs, never accepted from requests. */
  rpcFallbacks?: Partial<Record<EvmChain, string>>;
}

export function buildFetchers(o: FetcherOptions): LiveDeps {
  const common = {
    store: o.store,
    transport: o.transport,
    now: o.now,
    sleep: o.sleep,
  };
  const spacing = (ms: number) => (o.noSpacing ? 0 : ms);
  // One client per API host, so each keeps its own rate limit.
  // Etherscan's free plan allows 3 calls/s; 350 ms spacing still tripped it during week 3 recording.
  const etherscan = new ChainClient({
    ...common,
    source: "etherscan",
    minIntervalMs: spacing(400),
    secretParams: ["apikey"],
    classifyBody: etherscanClassifyBody,
  });
  const sources: Partial<Record<EvmChain, EvmSource>> = {};
  for (const [chain, plan] of Object.entries(EVM_SOURCES) as [
    EvmChain,
    SourcePlan,
  ][]) {
    sources[chain] =
      plan.kind === "etherscan"
        ? o.etherscanKey
          ? new EtherscanSource(etherscan, o.etherscanKey, chain)
          : undefined
        : new JsonRpcSource(
            new ChainClient({
              ...common,
              source: "public-rpc",
              minIntervalMs: spacing(plan.minIntervalMs),
              classifyBody: jsonRpcClassifyBody,
            }),
            plan.url,
            chain,
          );
  }
  for (const [chain, url] of Object.entries(o.rpcFallbacks ?? {}) as [
    EvmChain,
    string,
  ][]) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:")
      throw new Error("RPC fallbacks require HTTPS");
    const fallback = new JsonRpcSource(
      new ChainClient({
        ...common,
        source: "public-rpc",
        minIntervalMs: spacing(100),
        classifyBody: jsonRpcClassifyBody,
      }),
      url,
      chain,
    );
    sources[chain] = new FallbackSource([
      ...(sources[chain] ? [sources[chain]!] : []),
      fallback,
    ]);
  }
  return {
    tron: new TronFetcher(
      new ChainClient({
        ...common,
        source: "trongrid",
        minIntervalMs: spacing(80),
        classifyBody: tronClassifyBody,
      }),
      o.tronKey,
    ),
    evm: new EvmFetcher(sources),
    now: o.now,
  };
}
