// Wires the live fetchers from environment variables. Keys are read here and nowhere else.

import "server-only";
import type { LiveDeps } from "./investigate";
import { buildFetchers } from "./sources";
import { FileStore } from "./store";
import { dataDir } from "../data-dir";

export function liveKeysPresent(): boolean {
  return !!process.env.TRONGRID_API_KEY && !!process.env.ETHERSCAN_API_KEY;
}

let deps: { key: string; deps: LiveDeps } | undefined;
let override: LiveDeps | undefined;

/** Tests only: answer chain lookups from a stub instead of the network. */
export function overrideChainDeps(d: LiveDeps | undefined) { override = d; }

/**
 * A missing key never fails here: lookups on that API come back unknown ("chain lookup
 * unavailable: key not set"), and the public-RPC chains still answer.
 */
export function liveDeps(): LiveDeps {
  if (override) return override;
  const tronKey = process.env.TRONGRID_API_KEY ?? "";
  const etherscanKey = process.env.ETHERSCAN_API_KEY ?? "";
  const key = `${tronKey}\0${etherscanKey}\0${dataDir()}`; // in memory only
  if (deps?.key !== key) deps = { key, deps: buildFetchers({ tronKey, etherscanKey, store: new FileStore(dataDir()) }) };
  return deps.deps;
}
