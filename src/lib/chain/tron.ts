// Read-only Tron fetcher on TronGrid (spec section 3). Uses the full-node HTTP API:
//   /wallet/gettransactionbyid       the transaction, whether or not it is mined
//   /wallet/gettransactioninfobyid   block, receipt result, fee and event logs (empty until mined)
//   /wallet/getblock (detail=false)  current block height, header only
//   /wallet/triggerconstantcontract  token symbol() and decimals(), read-only
// The API key goes in the TRON-PRO-API-KEY header and is never stored.

import { tronHexToBase58 } from "../address";
import { explorerTxUrl } from "../catalogue";
import type { ChainTx, RawResponse, TokenTransfer } from "../types";
import { decodeAbiString, decodeAbiUint, decodeTransferCall, decodeTransferLogs, formatUnits } from "./abi";
import { ChainApiError, type ChainClient } from "./http";
import type { ChainLookupResult, TokenMeta } from "./types";

const BASE = "https://api.trongrid.io";

const toBase58 = (hex40: string) => tronHexToBase58(`41${hex40}`);
const isEmpty = (body: string) => body.trim() === "{}" || body.trim() === "";

export function tronClassifyBody(body: string): { retryable: boolean; message: string } | undefined {
  try {
    const j = JSON.parse(body);
    if (j && typeof j.Error === "string") return { retryable: /rate|limit|busy/i.test(j.Error), message: j.Error };
  } catch {
    return { retryable: false, message: "TronGrid returned non-JSON" };
  }
  return undefined;
}

export class TronFetcher {
  constructor(private readonly client: ChainClient, private readonly apiKey: string) {
    if (!apiKey) throw new ChainApiError("TRONGRID_API_KEY is not set", false);
  }

  private post(path: string, body: unknown, ttlSec: number, ttlFor?: (r: RawResponse) => number) {
    return this.client.request(
      { method: "POST", url: `${BASE}${path}`, body: JSON.stringify(body),
        headers: { "TRON-PRO-API-KEY": this.apiKey, "content-type": "application/json" } },
      { chain: "tron", ttlSec, ttlFor },
    );
  }

  async lookup(hash: string, raws: RawResponse[]): Promise<ChainLookupResult> {
    const id = hash.replace(/^0x/i, "").toLowerCase();
    const sourceUrl = explorerTxUrl("tron", id);
    // Unknown and unmined answers can change, so they are cached briefly; mined data is immutable.
    const byId = await this.post("/wallet/gettransactionbyid", { value: id }, 30, (r) => (isEmpty(r.body) ? 30 : Infinity));
    raws.push(byId);
    const base = { chain: "tron" as const, fetchedAt: byId.fetchedAt, sourceUrl, rawBody: byId.body };
    if (isEmpty(byId.body)) return { lookup: { ...base, result: "not_found" } };

    const info = await this.post("/wallet/gettransactioninfobyid", { value: id }, 10, (r) => (isEmpty(r.body) ? 10 : Infinity));
    raws.push(info);
    if (isEmpty(info.body)) return { lookup: { ...base, result: "pending" } };

    const txJson = JSON.parse(byId.body);
    const infoJson = JSON.parse(info.body);
    const head = await this.post("/wallet/getblock", { detail: false }, 3);
    raws.push(head);
    const currentBlock = Number(JSON.parse(head.body)?.block_header?.raw_data?.number);

    const result: string | undefined = infoJson.receipt?.result ?? txJson.ret?.[0]?.contractRet;
    const failed = result !== undefined && result !== "SUCCESS";
    const fee = BigInt(infoJson.fee ?? 0);

    const logs = (infoJson.log ?? []).map((l: { address: string; topics: string[]; data: string }, i: number) =>
      ({ address: l.address, topics: l.topics ?? [], data: l.data ?? "", index: i }));
    const transfers: TokenTransfer[] = [];
    for (const t of decodeTransferLogs(logs)) {
      transfers.push(await this.transfer(toBase58(t.contractHex), t.index, toBase58(t.fromHex), toBase58(t.toHex), t.value, raws));
    }
    if (failed && transfers.length === 0) {
      // A failed call emits no event; recover the intended transfer from the call data.
      const c = txJson.raw_data?.contract?.[0]?.parameter?.value;
      const call = c?.data ? decodeTransferCall(c.data) : undefined;
      if (call && c.contract_address && c.owner_address) {
        transfers.push(await this.transfer(tronHexToBase58(c.contract_address), 0, tronHexToBase58(c.owner_address),
          toBase58(call.toHex), call.value, raws));
      }
    }

    const tx: ChainTx = {
      chain: "tron",
      hash: id,
      status: failed ? "failed" : "success",
      errorCode: failed ? result : undefined,
      feeBurned: fee > 0n ? formatUnits(fee, 6) : undefined,
      feeToken: fee > 0n ? "TRX" : undefined,
      blockNumber: Number(infoJson.blockNumber),
      blockTime: new Date(Number(infoJson.blockTimeStamp)).toISOString(),
      isBatch: transfers.length > 1,
      transfers,
    };
    return {
      lookup: { ...base, result: "found" },
      tx,
      currentBlock: Number.isFinite(currentBlock) && currentBlock > 0 ? currentBlock : undefined,
    };
  }

  private async transfer(contract: string, index: number, from: string, to: string, value: bigint | undefined,
    raws: RawResponse[]): Promise<TokenTransfer> {
    const m = await this.tokenMeta(contract, raws);
    return {
      logIndex: index,
      tokenContract: contract,
      tokenSymbol: m.symbol ?? "UNKNOWN",
      from,
      to,
      // Unknown decimals or value leave the amount unknown (""), never guessed.
      amount: value !== undefined && m.decimals !== undefined ? formatUnits(value, m.decimals) : "",
    };
  }

  /** symbol() and decimals(), cached forever by the client. A failed call leaves them unknown. */
  private async tokenMeta(contract: string, raws: RawResponse[]): Promise<TokenMeta> {
    const call = async (fn: string) => {
      try {
        const r = await this.post("/wallet/triggerconstantcontract",
          { owner_address: contract, contract_address: contract, function_selector: fn, visible: true }, Infinity);
        raws.push(r);
        return JSON.parse(r.body)?.constant_result?.[0] as string | undefined;
      } catch {
        return undefined;
      }
    };
    const sym = await call("symbol()");
    const dec = await call("decimals()");
    return { symbol: sym ? decodeAbiString(sym) : undefined, decimals: dec ? decodeAbiUint(dec) : undefined };
  }
}
