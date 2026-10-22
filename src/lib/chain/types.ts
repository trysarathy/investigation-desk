import type { ChainLookup, ChainTx } from "../types";

/** One chain's answer for one hash. `tx` and `currentBlock` only when the tx is mined there. */
export interface ChainLookupResult {
  lookup: ChainLookup;
  tx?: ChainTx;
  currentBlock?: number;
}

export interface TokenMeta {
  symbol?: string;
  decimals?: number;
}
