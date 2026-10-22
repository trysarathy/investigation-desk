// Replays a recorded live fixture against any workspace and settings, offline and keyless.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchFacts, type Workspace } from "../../../src/lib/chain/investigate";
import { buildFetchers } from "../../../src/lib/chain/sources";
import { MemoryStore } from "../../../src/lib/chain/store";
import type { Settings } from "../../../src/lib/types";
import { LIVE_CASES } from "./cases";
import { replayTransport, type Recording } from "./replay";

export const loadRecording = (name: string): Recording =>
  JSON.parse(readFileSync(path.join(__dirname, `${name}.json`), "utf8"));

export async function replayFacts(name: string, ws: Workspace, settings: Settings) {
  const c = LIVE_CASES.find((x) => x.name === name)!;
  const rec = loadRecording(name);
  const now = () => new Date(rec.recordedAt);
  const deps = buildFetchers({ tronKey: "test-key", etherscanKey: "test-key", store: new MemoryStore(),
    transport: replayTransport(rec), now, sleep: async () => {}, noSpacing: true });
  return fetchFacts(c.hash, ws, deps, settings);
}
