import type { EvmFetcher } from "../chain/evm";
import { TRANSFER_TOPIC } from "../chain/abi";
import { toBaseUnits } from "../requests/lifecycle";
import type { Observation } from "../requests/types";
import type { RawResponse } from "../types";

const hash = (x: unknown): x is string => typeof x === "string" && /^0x[0-9a-f]{64}$/i.test(x);
const uint = (x: unknown): number => typeof x === "string" && /^0x[0-9a-f]+$/i.test(x) ? Number(BigInt(x)) : NaN;
const equal = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** Re-read the exact Ethereum transfer before an accounting write. No cached observations establish finality. */
export async function postingFinality(evm: EvmFetcher, observations: Observation[]): Promise<string> {
  const source = evm.source("ethereum");
  if (!source || !observations.length) throw new Error("No live Ethereum finality source or payment evidence.");
  const raws: RawResponse[] = [];
  const call = (method: Parameters<typeof source.call>[0], params: unknown[]) => source.call(method, params, { ttlSec: 0 }, raws);
  const head = await call("eth_getBlockByNumber", ["finalized", false]) as { number?: unknown; hash?: unknown } | null;
  const finalized = uint(head?.number);
  if (!Number.isSafeInteger(finalized) || finalized <= 0 || !hash(head?.hash)) throw new Error("Ethereum finality is unavailable.");
  for (const o of observations) {
    if (o.chain !== "ethereum" || o.demo || o.source !== "live" || !hash(o.hash) || !Number.isSafeInteger(o.logIndex) || o.logIndex < 0)
      throw new Error("The payment is not live Ethereum transfer evidence.");
    const receipt = await call("eth_getTransactionReceipt", [o.hash]) as {
      transactionHash?: unknown; blockNumber?: unknown; blockHash?: unknown; status?: unknown;
      logs?: { logIndex?: unknown; address?: unknown; topics?: unknown; data?: unknown; removed?: unknown; transactionHash?: unknown; blockHash?: unknown; blockNumber?: unknown }[];
    } | null;
    const height = uint(receipt?.blockNumber);
    if (!receipt || !equal(receipt.transactionHash, o.hash) || receipt.status !== "0x1" || !hash(receipt.blockHash)
      || !Number.isSafeInteger(height) || height <= 0 || height !== o.blockNumber || height > finalized)
      throw new Error("The payment is missing, changed, failed or not finalized. Look it up again.");
    const block = await call("eth_getBlockByNumber", [receipt.blockNumber, false]) as { number?: unknown; hash?: unknown; timestamp?: unknown } | null;
    const seconds = uint(block?.timestamp);
    if (!block || uint(block.number) !== height || !equal(block.hash, receipt.blockHash)
      || (height === finalized && !equal(block.hash, head!.hash as string))
      || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds * 1000 !== Date.parse(o.blockTime ?? ""))
      throw new Error("The payment block or payment date changed. Look it up again.");
    const logs = Array.isArray(receipt.logs) ? receipt.logs.filter((l) => uint(l.logIndex) === o.logIndex) : [];
    const l = logs[0];
    const topics = l?.topics;
    if (logs.length !== 1 || l.removed === true || !equal(l.transactionHash, o.hash) || !equal(l.blockHash, receipt.blockHash)
      || uint(l.blockNumber) !== height || !equal(l.address, o.tokenContract)
      || !Array.isArray(topics) || topics.length !== 3 || !equal(topics[0], `0x${TRANSFER_TOPIC}`)
      || !/^0x[0-9a-f]{40}$/i.test(o.from) || !/^0x[0-9a-f]{40}$/i.test(o.to)
      || !equal(topics[1], `0x${o.from.slice(2).padStart(64, "0")}`) || !equal(topics[2], `0x${o.to.slice(2).padStart(64, "0")}`)
      || !hash(l.data) || BigInt(l.data) !== BigInt(toBaseUnits(o.amount)))
      throw new Error("The exact token transfer changed or is unavailable. Look it up again.");
  }
  return `Ethereum finalized block ${finalized}; checked ${observations.map((o) => o.key).join(", ")}; response SHA-256: ${raws.map((r) => r.sha256).join(", ") || "test source"}.`;
}
