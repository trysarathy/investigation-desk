import type { Chain, Code, Settings } from "./types";

export const RULE_VERSION = "rules-2026-10-21.1";

/** Catalogue order (spec section 2). The engine evaluates rules in exactly this order. */
export const CATALOGUE_ORDER: Code[] = [
  "D01", "D02", "D03", "D04", "D05", "D06", "D07", "D07b",
  "D08", "D09", "D10", "D11", "D12", "D13", "D14",
];

export const VERDICT_LABELS: Record<Code, string> = {
  D01: "Not found on any chain",
  D02: "Waiting for confirmations",
  D03: "Transaction failed",
  D04: "Wrong network",
  D05: "Unsupported token",
  D06: "Fake token",
  D07: "Wrong address",
  D07b: "Look-alike address",
  D08: "Below minimum deposit",
  D09: "Issuer freeze",
  D10: "Pending or congested",
  D11: "Sender exchange issue",
  D12: "Arrived on-chain, not credited",
  D13: "Already credited",
  D14: "On hold",
  D99: "Unknown",
};

export function nextStep(code: Code, settings: Settings): string {
  switch (code) {
    case "D01": return "Ask the customer for the correct hash or the sending platform's withdrawal record.";
    case "D02": return "Wait. Checks re-run every 60 seconds.";
    case "D03": return "Customer resends. No tokens moved.";
    case "D04":
      return settings.keysHeldOnOtherChains
        ? "Ops decides recovery under policy: the company holds this key on the network the funds arrived on."
        : "Unrecoverable: the company does not hold this key on the network the funds arrived on.";
    case "D05": return "Apply the unsupported-asset policy.";
    case "D06": return "Not credited. Flag to compliance as a possible scam.";
    case "D07": return "Unrecoverable by the company. Advise the customer.";
    case "D07b": return "Confirm the look-alike pattern, then send the security notice.";
    case "D08": return "Apply the below-minimum policy.";
    case "D09": return "Escalate to compliance. The reply makes no promise.";
    case "D10": return "Wait. The sender may replace the transaction.";
    case "D11": return "Ask the sending exchange for the on-chain hash.";
    case "D12": return "Escalate internally with the evidence pack (indexer lag or ops backlog).";
    case "D13": return "Tell the customer where the credit appears.";
    case "D14": return "Route to compliance. Neutral reply only.";
    case "D99": return "Investigate manually and record what you find.";
  }
}

const EXPLORER_TX: Record<Chain, string> = {
  tron: "https://tronscan.org/#/transaction/",
  ethereum: "https://etherscan.io/tx/0x",
  bsc: "https://bscscan.com/tx/0x",
  polygon: "https://polygonscan.com/tx/0x",
  base: "https://basescan.org/tx/0x",
  arbitrum: "https://arbiscan.io/tx/0x",
  optimism: "https://optimistic.etherscan.io/tx/0x",
};

export function explorerTxUrl(chain: Chain, hash: string): string {
  return EXPLORER_TX[chain] + hash.replace(/^0x/i, "");
}
