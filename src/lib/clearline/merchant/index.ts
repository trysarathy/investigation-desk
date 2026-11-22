/** rc6 merchant reconciliation: a pure, deterministic engine. Read-only domain; nothing moves money or tokens. */
export * from "./types";
export { DEFAULT_POLICY, FIAT_DECIMALS, NETWORKS, TOKENS, USDT_TRON, USDC_ETHEREUM } from "./config";
export { parseRate, divRoundHalfUp, toFiatMinor, bpsOf, fmtFiat, fmtToken, fmtPct, localDate } from "./amounts";
export { RULES, JOURNAL_RULES, type RuleId, type JournalRuleId } from "./rules";
export { matchPayments, type MatchOutput } from "./match";
export { buildBridges, type BatchBridge, type BridgeLine, type BridgeLineKind, type ProposedGrouping } from "./bridge";
export { reconcile, type ReconcileResult } from "./reconcile";
export { proposeJournals, accountBalance, MERCHANT_ACCOUNTS, type JournalProposal, type JournalLine, type MerchantAccount } from "./journal";
