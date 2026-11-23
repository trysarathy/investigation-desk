/** Shared helpers for the chain reader tests: recorded scenarios, deterministic runtime, and a real-fetch guard. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, vi } from "vitest";
import {
  EthereumReader, type EthereumReaderOptions, MemoryChainFactCache, type RecordingFile, TronReader, type TronReaderOptions, fakeRuntime, recordedTransport,
} from "@/lib/clearline/merchant/chain";

const DIR = path.resolve(__dirname, "../../fixtures/chain-recordings");
export const recording = (file: "tron" | "ethereum" | "resilience"): RecordingFile => JSON.parse(readFileSync(path.join(DIR, `${file}.json`), "utf8"));
export const scenario = (file: "tron" | "ethereum" | "resilience", name: string) => {
  const s = recording(file).scenarios[name];
  if (!s) throw new Error(`no scenario ${file}/${name}`);
  return s;
};

/** Any call to the real global fetch fails the file. */
export function guardRealFetch(): void {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => { spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("real fetch called in tests"); }); });
  afterAll(() => { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); });
}

export const RPC_URL = "https://rpc.example.invalid/";

export function tronReader(name: string, o: Partial<TronReaderOptions> = {}) {
  const transport = recordedTransport(scenario("tron", name).exchanges);
  const rt = fakeRuntime({ startMs: Date.UTC(2026, 0, 15, 10), seed: 7 });
  const cache = new MemoryChainFactCache();
  return { reader: new TronReader({ transport, runtime: rt, cache, apiKey: "test-placeholder-key", ...o }), transport, rt, cache };
}

export function ethReader(file: "ethereum" | "resilience", name: string, o: Partial<EthereumReaderOptions> = {}) {
  const transport = recordedTransport(scenario(file, name).exchanges);
  const rt = fakeRuntime({ startMs: Date.UTC(2026, 0, 15, 10), seed: 7 });
  const cache = new MemoryChainFactCache();
  return { reader: new EthereumReader({ transport, runtime: rt, cache, rpcUrl: RPC_URL, ...o }), transport, rt, cache };
}

/** Hash ids used in the recordings (fictional): the first receipt request body of a scenario names it. */
export function txOf(file: "tron" | "ethereum" | "resilience", name: string): string {
  const ex = scenario(file, name).exchanges[0];
  if (typeof ex.match.rpcParam0 === "string") return ex.match.rpcParam0;
  if (ex.match.bodyIncludes) return ex.match.bodyIncludes;
  throw new Error("scenario has no tx id");
}
