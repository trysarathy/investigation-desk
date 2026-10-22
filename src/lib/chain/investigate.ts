// Live fact gathering for one case (spec 6, steps 1–2): normalise the input, look the hash up on
// every supported chain in parallel, and assemble Facts for the pure rules engine. No rule runs here.

import { explorerTxUrl } from "../catalogue";
import { normaliseInput } from "../normalise";
import type { Chain, DepositAddressRow, EvmChain, Facts, LedgerRow, RawResponse } from "../types";
import { ALL_CHAINS } from "../types";
import type { EvmFetcher } from "./evm";
import { ChainApiError } from "./http";
import type { TronFetcher } from "./tron";
import type { ChainLookupResult } from "./types";

export interface Workspace {
  customerId?: string;
  depositAddresses: DepositAddressRow[];
  ledger: LedgerRow[];
  ledgerUploadedAt: string;
}

export interface LiveDeps {
  tron: TronFetcher;
  evm: EvmFetcher;
  now?: () => Date;
}

export async function fetchFacts(rawInput: string, ws: Workspace, deps: LiveDeps): Promise<Facts> {
  const input = normaliseInput(rawInput);
  const now = deps.now ?? (() => new Date());
  const base: Facts = {
    input,
    customerId: ws.customerId,
    checkedAt: now().toISOString(),
    lookups: [],
    freezes: [],        // D09 freeze calls arrive in week 3
    senderHistory: [],  // D07b sender history arrives in week 3
    depositAddresses: ws.depositAddresses,
    ledger: ws.ledger,
    ledgerUploadedAt: ws.ledgerUploadedAt,
    rawResponses: [],
  };
  // Week 2 looks up transaction hashes. Address and customer-reference search come later.
  if (input.kind !== "hash") return base;

  // Each chain records its own raw responses so concurrent lookups keep a stable order.
  const perChain = new Map<Chain, RawResponse[]>(ALL_CHAINS.map((c) => [c, []]));
  const results = await Promise.all(ALL_CHAINS.map((chain) => lookupOne(chain, input.value, deps, perChain.get(chain)!)));

  // Deposit chains first, in catalogue order, then the cross-check chains.
  const found = results.find((r) => r.tx);
  return {
    ...base,
    lookups: results.map((r) => r.lookup),
    tx: found?.tx,
    currentBlock: found?.currentBlock,
    rawResponses: ALL_CHAINS.flatMap((c) => perChain.get(c)!),
  };
}

async function lookupOne(chain: Chain, hash: string, deps: LiveDeps, raws: RawResponse[]): Promise<ChainLookupResult> {
  try {
    return chain === "tron" ? await deps.tron.lookup(hash, raws) : await deps.evm.lookup(chain as EvmChain, hash, raws);
  } catch (e) {
    // Any failure part-way through is an unknown, never "not found": the engine pauses on it.
    const err = e instanceof ChainApiError ? e : undefined;
    if (err?.raw) raws.push(err.raw);
    return {
      lookup: {
        chain, result: "error", error: err?.message ?? "lookup failed",
        fetchedAt: err?.raw?.fetchedAt ?? new Date().toISOString(),
        sourceUrl: explorerTxUrl(chain, hash), rawBody: err?.raw?.body ?? "",
      },
    };
  }
}
