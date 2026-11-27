/**
 * v1 conformance fixtures for the EVM networks read behind a flag (Polygon, Base, Arbitrum One), in each network's real
 * JSON-RPC response shapes: Polygon receipts carry the LogFeeTransfer log of the 0x…1010 system contract, OP-stack (Base)
 * receipts carry l1Fee / l1GasPrice / l1GasUsed, Arbitrum receipts carry gasUsedForL1 / l1BlockNumber and its blocks
 * l1BlockNumber / sendCount. Every address and hash is FICTIONAL (derived from a label); only the configured token
 * contracts are real public addresses (networks.ts). Synthetic, not captured live.
 */
import { createHash } from "node:crypto";
import type { RecordedExchange } from "@/lib/clearline/merchant/chain";
import { NETWORK_READ_SPECS, TRANSFER_TOPIC, type EvmNetwork } from "@/lib/clearline/merchant/chain";

export type L2 = Exclude<EvmNetwork, "ethereum">;
export const EVM_NETWORKS: readonly L2[] = ["polygon", "base", "arbitrum_one"];

const h = (label: string, bytes = 32) => "0x" + createHash("sha256").update(label).digest("hex").slice(0, bytes * 2);
export const addr = (label: string) => h(`addr:${label}`, 20);
export const txh = (label: string) => h(`tx:${label}`);
const hex = (n: bigint | number) => "0x" + BigInt(n).toString(16);
const topicOf = (a: string) => "0x" + a.slice(2).padStart(64, "0");

/** Per network: a realistic block height, block time and the extra receipt / block fields of that chain. */
export const NET: Record<L2, { block: bigint; blockSeconds: number; receiptExtra: Record<string, unknown>; blockExtra: Record<string, unknown> }> = {
  polygon: { block: 64_000_000n, blockSeconds: 2, receiptExtra: {}, blockExtra: { extraData: "0xd78301", difficulty: "0x14" } },
  base: { block: 22_000_000n, blockSeconds: 2, receiptExtra: { l1Fee: "0x2d79883d2000", l1GasPrice: "0x3b9aca00", l1GasUsed: "0x640", l1BaseFeeScalar: "0x8dd", l1BlobBaseFee: "0x1" }, blockExtra: { baseFeePerGas: "0x1b5" } },
  arbitrum_one: { block: 280_000_000n, blockSeconds: 1, receiptExtra: { gasUsedForL1: "0x1a2b", l1BlockNumber: "0x14a3c55" }, blockExtra: { l1BlockNumber: "0x14a3c55", sendCount: "0x5c3f1", sendRoot: h("sendroot") } },
};

export const DEPOSIT = addr("deposit");
export const PAYER = addr("payer");
export const LOOKALIKE = addr("lookalike-usdc"); // a fictional contract with the same symbol: never a payment
export const usdcOf = (n: L2) => NETWORK_READ_SPECS[n].tokens[0].contract;
/** The fixtures' reference time: 2026-01-15T09:00:00Z (the reader runtime starts at 10:00Z). */
export const TX_TIME_S = Date.UTC(2026, 0, 15, 9) / 1000;

const rpc = (result: unknown) => ({ status: 200, body: { jsonrpc: "2.0", id: 1, result } });

export function blockBody(n: L2, number: bigint, opts: { hashLabel?: string; timestamp?: number } = {}) {
  const base = NET[n];
  return {
    number: hex(number), hash: h(`block:${n}:${number}:${opts.hashLabel ?? "canonical"}`), parentHash: h(`block:${n}:${number - 1n}:canonical`),
    timestamp: hex(opts.timestamp ?? TX_TIME_S + Number(number - base.block) * base.blockSeconds), gasLimit: "0x1c9c380", gasUsed: "0xe4e1c0",
    miner: addr(`${n}-sequencer`), transactions: [], ...base.blockExtra,
  };
}

export function transferLog(n: L2, o: { contract: string; from: string; to: string; amount: bigint; logIndex: number; tx: string; block: bigint; blockHash: string }) {
  return {
    address: o.contract.toLowerCase(), topics: [TRANSFER_TOPIC, topicOf(o.from), topicOf(o.to)], data: "0x" + o.amount.toString(16).padStart(64, "0"),
    blockNumber: hex(o.block), blockHash: o.blockHash, transactionHash: o.tx, transactionIndex: "0x2", logIndex: hex(o.logIndex), removed: false,
  };
}

/** Polygon PoS: the LogFeeTransfer log every transaction emits from the 0x…1010 system contract (4 topics, not a Transfer). */
const polygonFeeLog = (tx: string, block: bigint, blockHash: string, logIndex: number) => ({
  address: "0x0000000000000000000000000000000000001010",
  topics: ["0x4dfe1bbbcf077ddc3e01291eea2d5c70c2b422b415d95645b9adcfd678cb1d63", topicOf("0x0000000000000000000000000000000000001010"), topicOf(PAYER), topicOf(addr("polygon-validator"))],
  data: "0x" + "0".repeat(63) + "1" + "0".repeat(63) + "2" + "0".repeat(63) + "3" + "0".repeat(63) + "4" + "0".repeat(63) + "5",
  blockNumber: hex(block), blockHash, transactionHash: tx, transactionIndex: "0x2", logIndex: hex(logIndex), removed: false,
});

export function receiptBody(n: L2, o: { tx: string; block: bigint; blockHash: string; status?: "0x1" | "0x0"; logs: unknown[] }) {
  const logs = n === "polygon" ? [...o.logs, polygonFeeLog(o.tx, o.block, o.blockHash, o.logs.length)] : o.logs;
  return {
    transactionHash: o.tx, transactionIndex: "0x2", blockHash: o.blockHash, blockNumber: hex(o.block), from: PAYER, to: usdcOf(n).toLowerCase(),
    cumulativeGasUsed: "0x1b2f3", gasUsed: "0xfde8", effectiveGasPrice: "0x3b9aca00", contractAddress: null, logs, logsBloom: "0x" + "0".repeat(512),
    status: o.status ?? "0x1", type: "0x2", ...NET[n].receiptExtra,
  };
}

export const AMOUNT = 250_000_000n; // 250.000000 USDC
export const HEAD_OFFSET = 199n; // head = block + 199 → 200 confirmations (≥ 128 / 12 / 20)

export interface EvmScenario { description: string; tx: string; exchanges: RecordedExchange[] }

/**
 * getTransfer scenarios: normal (final), not_finalized_tag (deep enough, but above the node's finalized block),
 * lookalike, failed, reorg (second receipt read has another block hash).
 */
export function evmScenarios(n: L2): Record<"normal" | "not_finalized_tag" | "lookalike" | "failed" | "reorg", EvmScenario> {
  const block = NET[n].block;
  const blockHash = blockBody(n, block).hash;
  const head = block + HEAD_OFFSET;
  const scen = (label: string, o: { contract?: string; status?: "0x1" | "0x0"; finalized?: bigint; secondHashLabel?: string }) => {
    const tx = txh(`${n}:${label}`);
    const logs = [transferLog(n, { contract: o.contract ?? usdcOf(n), from: PAYER, to: DEPOSIT, amount: AMOUNT, logIndex: 0, tx, block, blockHash })];
    const second = o.secondHashLabel ? blockBody(n, block, { hashLabel: o.secondHashLabel }).hash : blockHash;
    const ex: RecordedExchange[] = [
      { match: { rpcMethod: "eth_getTransactionReceipt", rpcParam0: tx }, response: rpc(receiptBody(n, { tx, block, blockHash, status: o.status, logs })) },
      { match: { rpcMethod: "eth_getBlockByNumber", rpcParam0: hex(block) }, repeat: true, response: rpc(blockBody(n, block)) },
      { match: { rpcMethod: "eth_blockNumber" }, repeat: true, response: rpc(hex(head)) },
      { match: { rpcMethod: "eth_getBlockByNumber", rpcParam0: "finalized" }, repeat: true, response: rpc(blockBody(n, o.finalized ?? block + 100n)) },
      { match: { rpcMethod: "eth_getTransactionReceipt", rpcParam0: tx }, response: rpc(receiptBody(n, { tx, block, blockHash: second, status: o.status, logs })) },
    ];
    return { tx, exchanges: ex };
  };
  return {
    normal: { description: `250 USDC on ${n}, 200 confirmations, below the finalized block, re-read unchanged → final`, ...scen("normal", {}) },
    not_finalized_tag: { description: `deep enough by count, but the node's finalized block is below it → seen, not final`, ...scen("not-finalized", { finalized: block - 1n }) },
    lookalike: { description: "a Transfer log from a fictional same-symbol contract: a look-alike fact, never a payment", ...scen("lookalike", { contract: LOOKALIKE }) },
    failed: { description: "receipt status 0x0: never a transfer", ...scen("failed", { status: "0x0" }) },
    reorg: { description: "the second receipt read names another block hash → reorged", ...scen("reorg", { secondHashLabel: "uncle" }) },
  };
}
