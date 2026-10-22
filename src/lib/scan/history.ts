import { createHash } from "node:crypto";
import { sameAddress } from "../address";
import { explorerTxUrl } from "../catalogue";
import { formatUnits } from "../chain/abi";
import type { DepositChain } from "../types";
import type { ScanTransfer } from "./types";
import { FileStore } from "../chain/store";
import path from "node:path";
const contracts: Partial<Record<DepositChain, string[]>> = {
  tron: ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"],
  ethereum: [
    "0xdac17f958d2ee523a2206206994597c13d831ec7",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  ],
};
export function signalFor(
  chain: DepositChain,
  contract: string,
  amount: string,
): ScanTransfer["signal"] {
  if (
    contracts[chain] &&
    !contracts[chain]!.some((c) => sameAddress(c, contract))
  )
    return "contract_mismatch";
  return /^0(?:\.0+)?$/.test(amount) ? "zero_value" : "none";
}
export interface HistoryPage {
  rows: ScanTransfer[];
  next?: string;
  complete: boolean;
  sources?: { url: string; sha256: string; fetchedAt: string }[];
}
/** Fixed provider hosts: no user-controlled URL or arbitrary fetch. Provider errors never mean empty history. */
export async function historyPage(
  chain: DepositChain,
  address: string,
  start: number,
  end: number,
  cursor?: string,
): Promise<HistoryPage> {
  if (chain === "ethereum" && !process.env.ETHERSCAN_API_KEY)
    return blockscoutHistory(address, start, end, cursor);
  let url: URL;
  const headers: Record<string, string> = {};
  if (chain === "tron") {
    url = new URL(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`,
    );
    Object.entries({
      only_to: "true",
      only_confirmed: "true",
      limit: "200",
      min_timestamp: String(start),
      max_timestamp: String(end),
      order_by: "block_timestamp,desc",
      ...(cursor ? { fingerprint: cursor } : {}),
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    if (process.env.TRONGRID_API_KEY)
      headers["TRON-PRO-API-KEY"] = process.env.TRONGRID_API_KEY;
  } else {
    if (!process.env.ETHERSCAN_API_KEY)
      throw Error(
        "Etherscan history key not configured. BNB history also needs an eligible provider plan.",
      );
    url = new URL("https://api.etherscan.io/v2/api");
    Object.entries({
      chainid: chain === "bsc" ? "56" : "1",
      module: "account",
      action: "tokentx",
      address,
      startblock: "0",
      endblock: "99999999",
      sort: "desc",
      page: cursor ?? "1",
      offset: "100",
      apikey: process.env.ETHERSCAN_API_KEY,
    }).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok)
    throw Error(`History provider HTTP ${res.status}; coverage incomplete`);
  const body = await res.text(),
    sha = createHash("sha256").update(body).digest("hex");
  url.searchParams.delete("apikey");
  await new FileStore(path.join(process.cwd(), ".data")).saveRaw({
    source: chain === "tron" ? "trongrid" : "etherscan",
    chain,
    request: { method: "GET", url: url.toString() },
    status: res.status,
    fetchedAt: new Date().toISOString(),
    body,
    sha256: sha,
  });
  const j = JSON.parse(body);
  if (chain === "tron" && j.success === false)
    throw Error("TronGrid refused history");
  if (chain !== "tron" && !Array.isArray(j.result))
    throw Error("History unavailable: provider key, plan or rate limit");
  const raw = chain === "tron" ? j.data : j.result;
  if (!Array.isArray(raw)) throw Error("Invalid provider history response");
  const rows: ScanTransfer[] = [];
  for (let index = 0; index < raw.length; index++) {
    const r = raw[index];
    if (chain === "tron" && r.type && r.type !== "Transfer") continue;
    const symbol = claimedSymbol(
      chain === "tron" ? r.token_info?.symbol : r.tokenSymbol,
    );
    if (!["USDT", "USDC"].includes(symbol) || !sameAddress(r.to, address))
      continue;
    const at =
      chain === "tron" ? Number(r.block_timestamp) : Number(r.timeStamp) * 1000;
    if (!Number.isFinite(at) || at < start || at > end) continue;
    const decimals = Number(
      chain === "tron" ? r.token_info?.decimals : r.tokenDecimal,
    );
    if (
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 36 ||
      !/^\d+$/.test(String(r.value))
    )
      throw Error("Malformed token amount; coverage incomplete");
    const amount = formatUnits(BigInt(r.value), decimals),
      hash = chain === "tron" ? r.transaction_id : r.hash,
      contract = chain === "tron" ? r.token_info.address : r.contractAddress;
    if (typeof hash !== "string" || typeof contract !== "string")
      throw Error("Malformed transfer identity");
    // Provider history may omit event index. Observation identity is NOT a ledger join key.
    const id = createHash("sha256")
      .update(JSON.stringify([chain, address, cursor ?? "1", index, hash]))
      .digest("hex")
      .slice(0, 24);
    rows.push({
      id,
      chain,
      hash,
      from: r.from,
      to: r.to,
      contract,
      symbol,
      amount,
      at: new Date(at).toISOString(),
      source: explorerTxUrl(chain, hash),
      evidenceHash: sha,
      signal: signalFor(chain, contract, amount),
    });
  }
  const older =
    chain !== "tron" && raw.some((r) => Number(r.timeStamp) * 1000 < start);
  const next =
    chain === "tron"
      ? j.meta?.fingerprint
      : raw.length === 100 && !older
        ? String(Number(cursor ?? "1") + 1)
        : undefined;
  return {
    rows,
    next,
    complete: !next,
    sources: [
      { url: url.toString(), sha256: sha, fetchedAt: new Date().toISOString() },
    ],
  };
}

export function claimedSymbol(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
        .trim()
        .toUpperCase()
    : "";
}
interface BlockscoutTransfer {
  transaction_hash: string;
  log_index: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  token: { symbol: string; address_hash: string; decimals: string };
  total: { value: string; decimals: string };
}
export function parseBlockscout(
  items: BlockscoutTransfer[],
  address: string,
  start: number,
  end: number,
  evidenceHash: string,
): ScanTransfer[] {
  const rows: ScanTransfer[] = [];
  for (const r of items) {
    const at = Date.parse(r.timestamp),
      symbol = claimedSymbol(r.token?.symbol);
    if (!Number.isFinite(at)) throw Error("Invalid history timestamp");
    if (
      at < start ||
      at > end ||
      !sameAddress(r.to?.hash, address) ||
      !["USDT", "USDC"].includes(symbol)
    )
      continue;
    const decimals = Number(r.total?.decimals ?? r.token.decimals);
    if (
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 36 ||
      !/^\d+$/.test(r.total?.value)
    )
      throw Error("Invalid indexed amount");
    const amount = formatUnits(BigInt(r.total.value), decimals),
      contract = r.token.address_hash;
    if (
      !Number.isInteger(r.log_index) ||
      !/^0x[0-9a-f]{64}$/i.test(r.transaction_hash) ||
      !/^0x[0-9a-f]{40}$/i.test(contract)
    )
      throw Error("Invalid indexed transfer identity");
    rows.push({
      id: `ethereum:${r.transaction_hash}:${r.log_index}`,
      hash: r.transaction_hash,
      chain: "ethereum",
      from: r.from.hash,
      to: r.to.hash,
      contract,
      symbol,
      amount,
      at: new Date(at).toISOString(),
      source: explorerTxUrl("ethereum", r.transaction_hash),
      evidenceHash,
      signal: signalFor("ethereum", contract, amount),
    });
  }
  return rows;
}
async function blockscoutRead(url: URL) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!r.ok) throw Error(`Blockscout HTTP ${r.status}`);
  const body = await r.text(),
    hash = createHash("sha256").update(body).digest("hex");
  await new FileStore(path.join(process.cwd(), ".data")).saveRaw({
    source: "blockscout",
    chain: "ethereum",
    request: { method: "GET", url: url.toString() },
    status: r.status,
    fetchedAt: new Date().toISOString(),
    sha256: hash,
    body,
  });
  return {
    json: JSON.parse(body),
    hash,
    source: {
      url: url.toString(),
      sha256: hash,
      fetchedAt: new Date().toISOString(),
    },
  };
}
async function blockscoutHistory(
  address: string,
  start: number,
  end: number,
  cursor?: string,
): Promise<HistoryPage> {
  const sources: { url: string; sha256: string; fetchedAt: string }[] = [];
  if (!cursor) {
    const head = await blockscoutRead(
      new URL("https://eth.blockscout.com/api/v2/blocks?type=block"),
    );
    sources.push(head.source);
    const at = Date.parse(head.json.items?.[0]?.timestamp);
    if (!Number.isFinite(at) || at < end - 15 * 60000)
      throw Error(
        "Public indexer is stale; recent coverage cannot be established",
      );
  }
  const url = new URL(
    `https://eth.blockscout.com/api/v2/addresses/${address}/token-transfers`,
  );
  url.searchParams.set("type", "ERC-20");
  url.searchParams.set("filter", "to");
  if (cursor)
    for (const [k, v] of Object.entries(JSON.parse(cursor)))
      if (
        [
          "block_number",
          "index",
          "items_count",
          "batch_log_index",
          "index_in_batch",
          "batch_transaction_hash",
          "batch_block_hash",
        ].includes(k)
      )
        url.searchParams.set(k, String(v));
  const { json, hash, source } = await blockscoutRead(url);
  sources.push(source);
  if (!Array.isArray(json.items))
    throw Error("Invalid public indexer response");
  const rows = parseBlockscout(json.items, address, start, end, hash),
    older = json.items.some(
      (r: BlockscoutTransfer) => Date.parse(r.timestamp) < start,
    );
  const next =
    !older && json.next_page_params
      ? JSON.stringify(json.next_page_params)
      : undefined;
  return { rows, next, complete: !next, sources };
}
