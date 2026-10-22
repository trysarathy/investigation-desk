// Wires the live fetchers from environment variables. Keys are read here and nowhere else.

import "server-only";
import path from "node:path";
import { etherscanClassifyBody, EvmFetcher } from "./evm";
import { ChainClient } from "./http";
import { FileStore } from "./store";
import { tronClassifyBody, TronFetcher } from "./tron";
import type { LiveDeps } from "./investigate";

export function liveKeysPresent(): boolean {
  return !!process.env.TRONGRID_API_KEY && !!process.env.ETHERSCAN_API_KEY;
}

let deps: LiveDeps | undefined;

export function liveDeps(): LiveDeps {
  if (deps) return deps;
  const store = new FileStore(path.join(process.cwd(), ".data"));
  deps = {
    // TronGrid allows about 15 requests/s per key; Etherscan's free plan 3/s. Stay under both.
    tron: new TronFetcher(new ChainClient({ source: "trongrid", minIntervalMs: 80, store, classifyBody: tronClassifyBody }),
      process.env.TRONGRID_API_KEY ?? ""),
    evm: new EvmFetcher(new ChainClient({ source: "etherscan", minIntervalMs: 350, store, secretParams: ["apikey"],
      classifyBody: etherscanClassifyBody }), process.env.ETHERSCAN_API_KEY ?? ""),
  };
  return deps;
}
