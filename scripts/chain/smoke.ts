// Manual smoke test of the READ-ONLY chain readers against mainnet. Never run in CI or under a test runner (refused).
//
//   TRONGRID_API_KEY=… ETHEREUM_RPC_URL=… npm run chain:smoke
//   (optional TRONGRID_BASE_URL, default https://api.trongrid.io; behind an HTTPS proxy on Node ≥ 24 add NODE_USE_ENV_PROXY=1)
//
// Keys come from the environment only (no .env loader exists in this repo, so export them in your shell). The script
// prints hosts, truncated hashes, amounts, blocks, confirmations and finality: never a key or a full URL.
//
// It DISCOVERS two public historical transfers instead of hard-coding hashes:
//   TRON:     GET /v1/contracts/{USDT}/events?event_name=Transfer&only_confirmed=true&limit=1 (≥ 100 blocks old)
//   Ethereum: eth_getLogs for the USDC Transfer topic over ~50 blocks ending 1,000 blocks below head
// then reads each one by transaction hash through TronReader / EthereumReader (receipt, head, reorg re-check).
// Nothing is signed or sent: the only calls are reads. Exit codes: 0 ok, 2 refused / missing config, 1 read failed.
import { USDC_ETHEREUM, USDT_TRON } from "../../src/lib/clearline/merchant/config";
import {
  DEFAULT_RATE_LIMITS, DEFAULT_RETRY, type EthereumReader, RateLimiter, Secrets, TRANSFER_TOPIC, type TransferOutcome, type TronReader,
  fetchTransport, hostOf, isTestOrCi, liveReadersFromEnv, resilientRequest, systemRuntime,
} from "../../src/lib/clearline/merchant/chain";

const env = process.env;
const fail = (code: number, msg: string): never => { console.error(`chain:smoke: ${msg}`); process.exit(code); };

if (isTestOrCi(env)) fail(2, "refused: CI or a test runner is set; this smoke test is manual only.");
if (!env.TRONGRID_API_KEY) fail(2, "TRONGRID_API_KEY is not set.");
if (!env.ETHEREUM_RPC_URL) fail(2, "ETHEREUM_RPC_URL is not set.");

const tronBase = (env.TRONGRID_BASE_URL ?? "https://api.trongrid.io").replace(/\/+$/, "");
const secrets = new Secrets([env.TRONGRID_API_KEY, ...Secrets.fromUrl(env.ETHEREUM_RPC_URL)]);
const transport = fetchTransport();
const say = (s: string) => console.log(secrets.redact(s));
const short = (h: string) => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);
const units = (v: bigint, d: number) => { const s = v.toString().padStart(d + 1, "0"); return `${s.slice(0, -d)}.${s.slice(-d)}`; };

async function getJson(source: string, req: { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string }, what: string, limit = DEFAULT_RATE_LIMITS.trongrid): Promise<unknown> {
  const r = await resilientRequest({ transport, limiter: new RateLimiter(limit, systemRuntime), retry: DEFAULT_RETRY, rt: systemRuntime, secrets, source }, req, what);
  if (!r.ok) return fail(1, `host unreachable or chain data unavailable: ${secrets.redact(r.reason)}`);
  try { return JSON.parse(r.response.body); } catch { return fail(1, `${source} ${what} at ${hostOf(req.url, secrets)}: response is not JSON`); }
}

async function discoverTron(tron: TronReader): Promise<string> {
  const head = await tron.head();
  if (!head.ok) return fail(1, `host unreachable or chain data unavailable: ${head.reason}`);
  // ~3 s blocks: ask for events older than 100 blocks (plus margin), then check the block age exactly.
  const maxTs = Date.now() - 150 * 3_000;
  const q = new URLSearchParams({ event_name: "Transfer", only_confirmed: "true", limit: "1", max_block_timestamp: String(maxTs), order_by: "block_timestamp,desc" });
  const j = (await getJson("trongrid", { url: `${tronBase}/v1/contracts/${USDT_TRON}/events?${q}`, method: "GET", headers: { accept: "application/json", "TRON-PRO-API-KEY": env.TRONGRID_API_KEY! } }, "v1/contracts/events")) as { data?: { transaction_id?: string; block_number?: number }[] };
  const ev = j.data?.[0];
  if (!ev?.transaction_id || typeof ev.block_number !== "number") return fail(1, "TronGrid returned no confirmed USDT Transfer event to test with.");
  if (head.head.number - BigInt(ev.block_number) < 100n) return fail(1, "the discovered TRON event is less than 100 blocks old; run again.");
  return ev.transaction_id;
}

async function discoverEthereum(eth: EthereumReader): Promise<string> {
  const head = await eth.headNumber();
  if (!head.ok) return fail(1, `host unreachable or chain data unavailable: ${head.reason}`);
  const to = head.head - 1_000n, from = to - 49n;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), address: USDC_ETHEREUM, topics: [TRANSFER_TOPIC] }] });
  const j = (await getJson("ethereum-rpc", { url: env.ETHEREUM_RPC_URL!, method: "POST", headers: { "content-type": "application/json" }, body }, "eth_getLogs", DEFAULT_RATE_LIMITS["ethereum-rpc"])) as { result?: { transactionHash?: string; topics?: string[] }[]; error?: unknown };
  const log = j.result?.find((l) => l.topics?.length === 3 && typeof l.transactionHash === "string");
  if (!log?.transactionHash) return fail(1, "no USDC Transfer log found in the discovery window (or the RPC refused eth_getLogs).");
  return log.transactionHash;
}

function report(network: string, hash: string, o: TransferOutcome): boolean {
  if (o.status !== "ok") { say(`${network}: ${short(hash)} → ${o.status}: ${o.reason}`); return false; }
  const t = o.transfers[0];
  if (!t) { say(`${network}: ${short(hash)} → no configured-token transfer in the receipt`); return false; }
  const hosts = [...new Set(o.evidence.map((e) => e.host))].join(", ");
  say(`${network}: tx ${short(hash)}  ${units(t.amountBaseUnits, t.decimals)} ${t.symbol}  block ${t.blockNumber}  confirmations ${t.confirmations}  finalised ${t.finalised}  (via ${hosts})`);
  return true;
}

async function main() {
  const readers = liveReadersFromEnv({ ...env, CLEARLINE_CHAIN_LIVE: "1" }, { transport }); // the gate still refuses CI / tests
  if (!readers.tron || !readers.ethereum) return fail(2, "readers not configured.");
  const tronHash = await discoverTron(readers.tron);
  const ok1 = report("tron", tronHash, await readers.tron.getTransfer(tronHash));
  const ethHash = await discoverEthereum(readers.ethereum);
  const ok2 = report("ethereum", ethHash, await readers.ethereum.getTransfer(ethHash));
  if (!ok1 || !ok2) fail(1, "at least one read did not return a transfer.");
  say("chain:smoke: ok");
}

main().catch((e) => fail(1, `unexpected error: ${secrets.redact(String((e as Error)?.message ?? e))}`));
