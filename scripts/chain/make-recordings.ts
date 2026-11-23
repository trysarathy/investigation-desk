// Regenerates the SYNTHETIC recordings in tests/fixtures/chain-recordings/*.json from a small fictional chain model.
// No network: every response below is authored here in the public TronGrid / Ethereum JSON-RPC response shapes.
// Addresses and hashes are fictional (sha256 of a label); the only real values are the public token contracts.
//
//   npx tsx scripts/chain/make-recordings.ts
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { USDC_ETHEREUM, USDT_TRON } from "../../src/lib/clearline/merchant/config";
import {
  EthereumReader, type HttpRequest, type HttpResponse, type RecordedExchange, type RecordingFile, USDT_ETHEREUM, fakeRuntime,
  tronBase58ToHex20, tronHexToBase58,
} from "../../src/lib/clearline/merchant/chain";

const NOTE = "synthetic recording in the public API response shape; fictional addresses and hashes; not captured live";
const OUT = path.join(__dirname, "../../tests/fixtures/chain-recordings");
const h = (label: string, bytes = 32) => createHash("sha256").update(`clearline-fictional:${label}`).digest("hex").slice(0, bytes * 2);
const TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (hex20: string) => "000000000000000000000000" + hex20;
const amt = (n: bigint) => n.toString(16).padStart(64, "0");
const write = (name: string, f: RecordingFile) => writeFileSync(path.join(OUT, name), JSON.stringify(f, null, 2) + "\n");

// ---------------------------------------------------------------- TRON
const T = {
  usdtHex: tronBase58ToHex20(USDT_TRON),
  deposit: h("tron-deposit", 20), sender: h("tron-sender", 20), sender2: h("tron-sender-2", 20), lookalike: h("tron-lookalike-contract", 20),
};
const tb = (hex: string) => tronHexToBase58(hex);
const T0 = Date.UTC(2026, 0, 15, 9, 0, 0); // block 60_000_000 [fictional]
const tronTs = (block: number) => T0 + (block - 60_000_000) * 3000;
const tronTx = (label: string) => h(`tron-tx:${label}`);

function tronInfo(id: string, block: number, logs: { contract: string; from: string; to: string; amount: bigint }[], result: "SUCCESS" | "REVERT" = "SUCCESS") {
  return {
    id, fee: 13_844_850, blockNumber: block, blockTimeStamp: tronTs(block),
    contractResult: [result === "SUCCESS" ? amt(1n) : ""], contract_address: "41" + T.usdtHex,
    receipt: { energy_fee: 13_499_850, energy_usage_total: 64_285, net_usage: 345, result },
    ...(result === "SUCCESS" ? {} : { result: "FAILED", resMessage: "5472616e73666572206661696c6564" }),
    log: logs.map((l) => ({ address: l.contract, topics: [TOPIC, pad(l.from), pad(l.to)], data: amt(l.amount) })),
  };
}
const tronInfoEx = (id: string, body: unknown, note?: string): RecordedExchange => ({ match: { method: "POST", path: "/wallet/gettransactioninfobyid", bodyIncludes: id }, response: { status: 200, body }, ...(note ? { note } : {}) });
const nowBlock = (n: number): RecordedExchange => ({
  match: { method: "POST", path: "/wallet/getnowblock" }, repeat: true,
  response: { status: 200, body: { blockID: n.toString(16).padStart(16, "0") + h(`tron-block:${n}`).slice(16), block_header: { raw_data: { number: n, txTrieRoot: h(`tron-trie:${n}`), witness_address: "41" + h("tron-witness", 20), parentHash: h(`tron-block:${n - 1}`), version: 31, timestamp: tronTs(n) }, witness_signature: h(`tron-sig:${n}`) + h(`tron-sig2:${n}`) } } },
});
const usdtLog = (from: string, amount: bigint) => ({ contract: T.usdtHex, from, to: T.deposit, amount });
const listItem = (id: string, block: number, from: string, value: bigint, token = { symbol: "USDT", address: USDT_TRON, decimals: 6, name: "Tether USD" }) => ({
  transaction_id: id, token_info: token, block_timestamp: tronTs(block), from: tb(from), to: tb(T.deposit), type: "Transfer", value: value.toString(),
});
const listPath = `/v1/accounts/${tb(T.deposit)}/transactions/trc20`;

const normal = tronTx("normal"), lookTx = tronTx("lookalike"), failed = tronTx("failed"), pending = tronTx("not-final"), reorg = tronTx("reorg"), vanish = tronTx("vanish");
const p1 = tronTx("page-1a"), p2 = tronTx("page-1b"), p3 = tronTx("page-2a");
write("tron.json", {
  _note: NOTE,
  scenarios: {
    normal_transfer: {
      description: "125.000000 USDT to the deposit at block 60,000,000; head 60,000,050 (51 confirmations); receipt re-read unchanged → finalised.",
      exchanges: [tronInfoEx(normal, tronInfo(normal, 60_000_000, [usdtLog(T.sender, 125_000_000n)])), nowBlock(60_000_050), tronInfoEx(normal, tronInfo(normal, 60_000_000, [usdtLog(T.sender, 125_000_000n)]), "reorg re-check")],
    },
    lookalike_contract: {
      description: "A Transfer log from a look-alike contract (not USDT) to the deposit, plus a genuine USDT log in the same transaction.",
      exchanges: [
        tronInfoEx(lookTx, tronInfo(lookTx, 60_000_010, [{ contract: T.lookalike, from: T.sender2, to: T.deposit, amount: 500_000_000n }, usdtLog(T.sender, 1_000_000n)])),
        nowBlock(60_000_050),
        tronInfoEx(lookTx, tronInfo(lookTx, 60_000_010, [{ contract: T.lookalike, from: T.sender2, to: T.deposit, amount: 500_000_000n }, usdtLog(T.sender, 1_000_000n)])),
      ],
    },
    failed_transaction: {
      description: "Receipt result REVERT / result FAILED: never a transfer, even though a log-shaped entry is present.",
      exchanges: [tronInfoEx(failed, tronInfo(failed, 60_000_020, [usdtLog(T.sender, 9_000_000n)], "REVERT")), nowBlock(60_000_050)],
    },
    not_yet_final: {
      description: "Block 60,000,040 with head 60,000,050: 11 of 19 confirmations; not final, no re-check, not cached.",
      exchanges: [tronInfoEx(pending, tronInfo(pending, 60_000_040, [usdtLog(T.sender, 42_000_000n)])), nowBlock(60_000_050)],
    },
    reorg_between_reads: {
      description: "First read at block 60,000,000; the re-check finds it at block 60,000,003 → reorged, not final.",
      exchanges: [tronInfoEx(reorg, tronInfo(reorg, 60_000_000, [usdtLog(T.sender, 77_000_000n)])), nowBlock(60_000_050), tronInfoEx(reorg, tronInfo(reorg, 60_000_003, [usdtLog(T.sender, 77_000_000n)]), "moved block")],
    },
    reorg_vanished: {
      description: "First read at block 60,000,000; the re-check returns {} (no such transaction) → reorged.",
      exchanges: [tronInfoEx(vanish, tronInfo(vanish, 60_000_000, [usdtLog(T.sender, 5_000_000n)])), nowBlock(60_000_050), tronInfoEx(vanish, {}, "vanished")],
    },
    unknown_transaction: { description: "TronGrid answers {} for an unknown id.", exchanges: [tronInfoEx(tronTx("unknown"), {})] },
    pagination: {
      description: "Two pages of the v1 TRC-20 listing via fingerprint (page 1 also lists a look-alike token); each candidate verified by receipt.",
      exchanges: [
        {
          match: { method: "GET", path: listPath, query: { only_to: "true", contract_address: USDT_TRON, limit: "200", order_by: "block_timestamp,asc", fingerprint: "" } },
          response: { status: 200, body: { data: [
            listItem(p1, 60_000_001, T.sender, 10_000_000n), listItem(p2, 60_000_002, T.sender2, 20_000_000n),
            listItem(lookTx, 60_000_002, T.sender2, 500_000_000n, { symbol: "USDT", address: tb(T.lookalike), decimals: 6, name: "Tether USD" }),
          ], success: true, meta: { at: T0 + 3_600_000, fingerprint: "fp-fictional-page-2", links: { next: `https://api.trongrid.io${listPath}?fingerprint=fp-fictional-page-2` }, page_size: 3 } } },
        },
        {
          match: { method: "GET", path: listPath, query: { fingerprint: "fp-fictional-page-2" } },
          response: { status: 200, body: { data: [listItem(p3, 60_000_030, T.sender, 30_000_000n)], success: true, meta: { at: T0 + 3_600_000, page_size: 1 } } },
        },
        nowBlock(60_000_045),
        ...[[p1, 60_000_001, T.sender, 10_000_000n], [p2, 60_000_002, T.sender2, 20_000_000n], [p3, 60_000_030, T.sender, 30_000_000n]].flatMap(([id, b, from, a]) => {
          const ex = tronInfoEx(id as string, tronInfo(id as string, b as number, [usdtLog(from as string, a as bigint)]));
          return (b as number) <= 60_000_045 - 18 ? [ex, { ...ex, note: "reorg re-check" }] : [ex];
        }),
      ],
    },
  },
});

// ---------------------------------------------------------------- Ethereum
const E = { deposit: "0x" + h("eth-deposit", 20), sender: "0x" + h("eth-sender", 20), lookalike: "0x" + h("eth-lookalike-contract", 20), usdc: USDC_ETHEREUM.toLowerCase(), usdt: USDT_ETHEREUM.toLowerCase() };
const B0 = 21_000_000, ETS0 = Math.floor(Date.UTC(2026, 0, 15, 9, 0, 0) / 1000); // [fictional]
const ets = (b: number) => ETS0 + (b - B0) * 12;
const bhash = (b: number, fork = "") => "0x" + h(`eth-block${fork}:${b}`);
const ethTx = (label: string) => "0x" + h(`eth-tx:${label}`);
const hex = (n: number | bigint) => "0x" + n.toString(16);
const rpcOk = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });
const elog = (contract: string, from: string, to: string, amount: bigint, tx: string, block: number, logIndex: number, fork = "") => ({
  address: contract, topics: ["0x" + TOPIC, "0x" + pad(from.slice(2)), "0x" + pad(to.slice(2))], data: "0x" + amt(amount),
  blockNumber: hex(block), blockHash: bhash(block, fork), transactionHash: tx, transactionIndex: "0x4", logIndex: hex(logIndex), removed: false,
});
const receipt = (tx: string, block: number, logs: unknown[], status = "0x1", fork = "") => ({
  transactionHash: tx, transactionIndex: "0x4", blockHash: bhash(block, fork), blockNumber: hex(block), from: E.sender, to: E.usdc,
  cumulativeGasUsed: "0x1b2f3", gasUsed: "0xfde8", effectiveGasPrice: "0x3b9aca00", contractAddress: null, logs, logsBloom: "0x" + "0".repeat(512), status, type: "0x2",
});
const block = (b: number, fork = "") => ({ number: hex(b), hash: bhash(b, fork), parentHash: bhash(b - 1, fork), timestamp: hex(ets(b)), gasLimit: "0x1c9c380", gasUsed: "0xe4e1c0", miner: "0x" + h("eth-fee-recipient", 20), transactions: [] });
const rcptEx = (tx: string, body: unknown, note?: string): RecordedExchange => ({ match: { rpcMethod: "eth_getTransactionReceipt", rpcParam0: tx }, response: { status: 200, body: rpcOk(body) }, ...(note ? { note } : {}) });
const blockEx = (b: number, fork = ""): RecordedExchange => ({ match: { rpcMethod: "eth_getBlockByNumber", rpcParam0: hex(b) }, repeat: true, response: { status: 200, body: rpcOk(block(b, fork)) } });
const headEx = (b: number): RecordedExchange => ({ match: { rpcMethod: "eth_blockNumber" }, repeat: true, response: { status: 200, body: rpcOk(hex(b)) } });

const eN = ethTx("normal"), eL = ethTx("lookalike"), eF = ethTx("failed"), eP = ethTx("not-final"), eR = ethTx("reorg");
const usdcLog = (tx: string, b: number, a: bigint, i = 0, fork = "") => elog(E.usdc, E.sender, E.deposit, a, tx, b, i, fork);

// The listing scenario is produced by running the reader against the chain model and keeping the exchanges it made.
const HEAD = B0 + 100;
const L1 = ethTx("list-usdc-final"), L2 = ethTx("list-usdt-pending"), L3 = ethTx("list-lookalike");
const modelLogs = [elog(E.usdc, E.sender, E.deposit, 250_000_000n, L1, HEAD - 40, 7), elog(E.usdt, E.sender, E.deposit, 99_500_000n, L2, HEAD - 3, 2), elog(E.lookalike, E.sender, E.deposit, 1_000_000_000n, L3, HEAD - 20, 1)];
const modelReceipts: Record<string, unknown> = { [L1]: receipt(L1, HEAD - 40, [modelLogs[0]]), [L2]: receipt(L2, HEAD - 3, [modelLogs[1]]), [L3]: receipt(L3, HEAD - 20, [modelLogs[2]]) };
const MAX_SPAN = 16;
async function captureListing(): Promise<RecordedExchange[]> {
  const out: RecordedExchange[] = [];
  const model = async (req: HttpRequest): Promise<HttpResponse> => {
    const j = JSON.parse(req.body!);
    let body: unknown; let match: RecordedExchange["match"] = { rpcMethod: j.method }; let repeat = false;
    if (j.method === "eth_blockNumber") { body = rpcOk(hex(HEAD)); repeat = true; }
    else if (j.method === "eth_getBlockByNumber") { body = rpcOk(block(Number(BigInt(j.params[0])))); match = { ...match, rpcParam0: j.params[0] }; repeat = true; }
    else if (j.method === "eth_getTransactionReceipt") { body = rpcOk(modelReceipts[j.params[0]] ?? null); match = { ...match, rpcParam0: j.params[0] }; }
    else if (j.method === "eth_getLogs") {
      const f = j.params[0]; const from = Number(BigInt(f.fromBlock)), to = Number(BigInt(f.toBlock));
      match = { ...match, rpcParam0: f };
      body = to - from + 1 > MAX_SPAN
        ? { jsonrpc: "2.0", id: j.id, error: { code: -32005, message: `query exceeds max block range ${MAX_SPAN}` } }
        : rpcOk(modelLogs.filter((l) => { const b = Number(BigInt(l.blockNumber)); return b >= from && b <= to; }));
    } else throw new Error(`model: unexpected ${j.method}`);
    if (!out.some((e) => e.repeat && JSON.stringify(e.match) === JSON.stringify(match))) out.push({ match, response: { status: 200, body }, ...(repeat ? { repeat } : {}) });
    return { status: 200, headers: {}, body: JSON.stringify(body) };
  };
  const rt = fakeRuntime({ startMs: ets(HEAD) * 1000 });
  const r = new EthereumReader({ transport: model, runtime: rt, rpcUrl: "https://rpc.example.invalid/", maxLogRange: 64n });
  const o = await r.listIncoming(E.deposit, (ets(HEAD) - 600) * 1000, ets(HEAD) * 1000);
  if (o.status !== "ok" || o.transfers.length !== 2) throw new Error("model listing did not produce the expected outcome");
  return out;
}

async function main() {
  write("ethereum.json", {
    _note: NOTE,
    scenarios: {
      normal_transfer: {
        description: "250.000000 USDC to the deposit at block 21,000,000; head 21,000,056 (57 confirmations); receipt re-read with the same block number and hash → finalised.",
        exchanges: [rcptEx(eN, receipt(eN, B0, [usdcLog(eN, B0, 250_000_000n, 3)])), blockEx(B0), headEx(B0 + 56), rcptEx(eN, receipt(eN, B0, [usdcLog(eN, B0, 250_000_000n, 3)]), "reorg re-check")],
      },
      lookalike_contract: {
        description: "Receipt with a Transfer log from a look-alike contract and a 4-topic (ERC-721-shaped) Transfer log; neither is a configured-token transfer.",
        exchanges: [
          rcptEx(eL, receipt(eL, B0 + 1, [elog(E.lookalike, E.sender, E.deposit, 250_000_000n, eL, B0 + 1, 0), { ...elog(E.lookalike, E.sender, E.deposit, 1n, eL, B0 + 1, 1), topics: ["0x" + TOPIC, "0x" + pad(E.sender.slice(2)), "0x" + pad(E.deposit.slice(2)), "0x" + amt(1n)], data: "0x" }])),
          blockEx(B0 + 1), headEx(B0 + 56),
          rcptEx(eL, receipt(eL, B0 + 1, [elog(E.lookalike, E.sender, E.deposit, 250_000_000n, eL, B0 + 1, 0)])),
        ],
      },
      failed_transaction: { description: "Receipt status 0x0: never a transfer.", exchanges: [rcptEx(eF, receipt(eF, B0 + 2, [], "0x0"))] },
      not_yet_final: {
        description: "Block 21,000,050 with head 21,000,055: 6 of 12 confirmations; not final, not cached.",
        exchanges: [rcptEx(eP, receipt(eP, B0 + 50, [usdcLog(eP, B0 + 50, 10_000_000n)])), blockEx(B0 + 50), headEx(B0 + 55)],
      },
      reorg_between_reads: {
        description: "First receipt in block 21,000,010 (hash A); the re-check returns the same number with a different block hash → reorged.",
        exchanges: [
          rcptEx(eR, receipt(eR, B0 + 10, [usdcLog(eR, B0 + 10, 60_000_000n)])), blockEx(B0 + 10), headEx(B0 + 56),
          rcptEx(eR, receipt(eR, B0 + 10, [usdcLog(eR, B0 + 10, 60_000_000n, 0, ":fork")], "0x1", ":fork"), "same height, different hash"),
        ],
      },
      unknown_transaction: { description: "eth_getTransactionReceipt returns null.", exchanges: [rcptEx(ethTx("unknown"), null)] },
      listing: {
        description: `listIncoming over the last 10 minutes before head ${HEAD}: binary search on block timestamps, eth_getLogs chunks (the node refuses spans over ${MAX_SPAN} blocks, so 64 shrinks to 16), a final USDC transfer, a not-yet-final USDT transfer and a look-alike log.`,
        exchanges: await captureListing(),
      },
    },
  });

  // ---------------------------------------------------------------- resilience (HTTP-level behaviour)
  const rN = eN;
  const okReceipt = rcptEx(rN, receipt(rN, B0, [usdcLog(rN, B0, 250_000_000n, 3)]));
  const status = (s: number, headers: Record<string, string> = {}): RecordedExchange => ({ match: { rpcMethod: "eth_getTransactionReceipt" }, response: { status: s, headers, body: s === 429 ? "Too Many Requests" : "<html>Bad Gateway</html>" } });
  write("resilience.json", {
    _note: NOTE,
    scenarios: {
      rate_limited_then_success: { description: "HTTP 429 with Retry-After: 2, then the receipt; rest of the read succeeds.", exchanges: [status(429, { "Retry-After": "2" }), okReceipt, blockEx(B0), headEx(B0 + 56), { ...okReceipt, note: "reorg re-check" }] },
      server_error_exhaustion: { description: "HTTP 502 on every attempt → unavailable after the attempt limit.", exchanges: [{ ...status(502), repeat: true }] },
      timeout: { description: "The transport times out on every attempt → unavailable.", exchanges: [{ match: { rpcMethod: "eth_getTransactionReceipt" }, throws: "timeout", repeat: true }] },
      timeout_then_success: { description: "One timeout, then the normal read.", exchanges: [{ match: { rpcMethod: "eth_getTransactionReceipt" }, throws: "timeout" }, okReceipt, blockEx(B0), headEx(B0 + 56), { ...okReceipt, note: "reorg re-check" }] },
      client_error_not_retried: { description: "HTTP 401 (bad key): not retried, unavailable at once.", exchanges: [{ match: { rpcMethod: "eth_getTransactionReceipt" }, response: { status: 401, body: { error: "invalid project id" } } }] },
    },
  });
  console.log("wrote tron.json, ethereum.json, resilience.json");
}
void main();
