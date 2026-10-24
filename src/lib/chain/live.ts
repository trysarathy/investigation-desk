// Wires the live fetchers from environment variables. Keys are read here and nowhere else.

import "server-only";
import type { LiveDeps } from "./investigate";
import { buildFetchers } from "./sources";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { FileStore, MemoryStore } from "./store";
import { demoTransport } from "../demo/transport";
import type { Recording } from "../demo/recordings";
import { dataDir } from "../data-dir";

export function liveKeysPresent(): boolean {
  return !!process.env.TRONGRID_API_KEY && !!process.env.ETHERSCAN_API_KEY;
}

/**
 * Live lookups no longer need keys: TronGrid answers keyless, and without an Etherscan key the
 * Etherscan chains use public RPCs (sources.ts). LIVE_LOOKUPS=off turns live lookups off.
 */
export function liveLookupsEnabled(): boolean {
  return process.env.LIVE_LOOKUPS !== "off";
}

let deps: { key: string; deps: LiveDeps } | undefined;
let override: LiveDeps | undefined;

/** Tests only: answer chain lookups from a stub instead of the network. */
export function overrideChainDeps(d: LiveDeps | undefined) { override = d; }

/**
 * A missing key never fails here: lookups on that API come back unknown ("chain lookup
 * unavailable: key not set"), and the public-RPC chains still answer.
 */
let offline: LiveDeps | undefined;

/**
 * OFFLINE_REPLAY_DIR=tests/fixtures/real answers chain lookups from recorded real responses, with
 * no network: the demo still works when the meeting room's internet doesn't. A request that wasn't
 * recorded fails, which pauses the case; nothing is guessed.
 */
function offlineDeps(dir: string): LiveDeps {
  if (offline) return offline;
  const recs = readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Recording)
    .filter((r) => Array.isArray(r.exchanges));
  offline = buildFetchers({ tronKey: "", etherscanKey: "", store: new MemoryStore(), transport: demoTransport(recs), noSpacing: true });
  return offline;
}

export function liveDeps(): LiveDeps {
  if (override) return override;
  if (process.env.OFFLINE_REPLAY_DIR) return offlineDeps(process.env.OFFLINE_REPLAY_DIR);
  const tronKey = process.env.TRONGRID_API_KEY ?? "";
  const etherscanKey = process.env.ETHERSCAN_API_KEY ?? "";
  const key = `${tronKey}\0${etherscanKey}\0${dataDir()}`; // in memory only
  if (deps?.key !== key) deps = { key, deps: buildFetchers({ tronKey, etherscanKey, store: new FileStore(dataDir()) }) };
  return deps.deps;
}
