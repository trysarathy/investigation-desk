// Which contract counts as "official" for a token on a chain (spec section 3, "BNB Chain tokens").
//   issuer:  the issuer's own contract, confirmed on Tether's or Circle's pages (Settings.officialContracts)
//   company: on BNB Chain neither issuer lists a contract, so the company's declared, accepted
//            contract stands in. It is bridged by Binance, not issued by Tether or Circle, and has
//            no issuer freeze function. Never hard-coded: it comes from the company's Settings.

import type { Chain, Settings, Token } from "./types";

export const COMPANY_DECLARED_CHAINS: ReadonlySet<Chain> = new Set<Chain>(["bsc"]);

export const COMPANY_CONTRACT_LABEL = "company-accepted contract (bridged by Binance, not issued by Tether or Circle)";

export interface OfficialContract {
  contract: string;
  source: "issuer" | "company";
  /** The company's note on its declared contract, e.g. "sample setting". */
  note?: string;
}

export function officialContractFor(chain: Chain, token: Token, settings: Settings): OfficialContract | undefined {
  if (COMPANY_DECLARED_CHAINS.has(chain)) {
    const declared = chain === "bsc" ? settings.acceptedTokens.bsc.find((a) => a.symbol === token) : undefined;
    return declared ? { contract: declared.contract, source: "company", ...(declared.note ? { note: declared.note } : {}) } : undefined;
  }
  const issuer = settings.officialContracts[chain]?.[token];
  return issuer ? { contract: issuer, source: "issuer" } : undefined;
}
