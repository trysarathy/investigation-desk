import type { Chain, RawResponse } from "../types";
import { ALL_CHAINS } from "../types";
import type { LiveDeps } from "./investigate";
import type { ChainLookupResult } from "./types";
import type { EvmSource, RpcMethod, CallOpts } from "./evm";

export interface ChainAdapter {
  chain: Chain;
  capabilities: {
    deposits: boolean;
    history: boolean;
    issuerFreeze: boolean;
    memo: boolean;
  };
  lookup(hash: string, evidence: RawResponse[]): Promise<ChainLookupResult>;
}
export function adapters(deps: LiveDeps): Map<Chain, ChainAdapter> {
  return new Map(
    ALL_CHAINS.map((chain) => [
      chain,
      {
        chain,
        capabilities: {
          deposits: ["tron", "ethereum", "bsc"].includes(chain),
          history: chain === "tron" || chain === "ethereum",
          issuerFreeze: chain === "tron" || chain === "ethereum",
          memo: false,
        },
        lookup: (hash, raws) =>
          chain === "tron"
            ? deps.tron.lookup(hash, raws)
            : deps.evm.lookup(chain, hash, raws),
      },
    ]),
  );
}
/** Fail over on provider errors, never on an authoritative null/not-found answer. */
export class FallbackSource implements EvmSource {
  readonly kind = "public-rpc" as const;
  private state: { provider: number; ok: boolean; checkedAt: string } | null =
    null;
  constructor(private readonly providers: EvmSource[]) {
    if (!providers.length) throw new Error("At least one provider required");
  }
  health() {
    return this.state;
  }
  async call(
    method: RpcMethod,
    params: unknown[],
    options: CallOpts,
    raws: RawResponse[],
  ): Promise<unknown> {
    let error: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      try {
        const result = await this.providers[i].call(
          method,
          params,
          options,
          raws,
        );
        this.state = {
          provider: i,
          ok: true,
          checkedAt: new Date().toISOString(),
        };
        return result;
      } catch (e) {
        error = e;
        this.state = {
          provider: i,
          ok: false,
          checkedAt: new Date().toISOString(),
        };
      }
    }
    throw error;
  }
}
