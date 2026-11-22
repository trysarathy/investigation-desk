import { CURRENCIES } from "../money";
import type { FiatCurrency, MerchantPolicy, NetworkConfig, TokenConfig } from "./types";

/** Minor-unit exponents. SGD and USD reuse rc5's table; AED is added here (2 decimals). */
export const FIAT_DECIMALS: Readonly<Record<FiatCurrency, number>> = { SGD: CURRENCIES.SGD, USD: CURRENCIES.USD, AED: 2 };

/** Seeded networks. TRON and Ethereum are enabled; the rest are present but disabled. */
export const NETWORKS: readonly NetworkConfig[] = [
  { network: "tron", name: "TRON", confirmationsRequired: 19, enabled: true }, // [ASSUMPTION] 19 confirmations
  { network: "ethereum", name: "Ethereum", chainId: 1, confirmationsRequired: 12, enabled: true }, // [ASSUMPTION] 12 confirmations
  { network: "polygon", name: "Polygon", chainId: 137, confirmationsRequired: 128, enabled: false },
  { network: "solana", name: "Solana", confirmationsRequired: 32, enabled: false },
  { network: "arbitrum_one", name: "Arbitrum One", chainId: 42161, confirmationsRequired: 20, enabled: false },
  { network: "ton", name: "TON", confirmationsRequired: 1, enabled: false },
  { network: "base", name: "Base", chainId: 8453, confirmationsRequired: 12, enabled: false },
];

/** The only real values in rc6: the public USDT (TRON) and USDC (Ethereum) contracts. */
export const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const USDC_ETHEREUM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const TOKENS: readonly TokenConfig[] = [
  { network: "tron", contract: USDT_TRON, symbol: "USDT", decimals: 6 },
  { network: "ethereum", contract: USDC_ETHEREUM, symbol: "USDC", decimals: 6 },
];

/**
 * Default policy: band = min(0.5% of invoice, 5.00) [ASSUMPTION per the prompt; editable].
 * Sender-side fee bound 5.000000 token units [ASSUMPTION: covers typical exchange withdrawal fees].
 */
export const DEFAULT_POLICY: MerchantPolicy = {
  tolerancePct: 50,
  toleranceAbsMinor: 500n,
  writeoffThresholdMinor: 500n,
  approverRoles: ["finance_approver"],
  allowImportedBankLinesAsVerified: false,
  // [ASSUMPTION] a sender-side (exchange/network) fee is at most 2.000000 token units; anything larger is an
  // underpayment (the founder's Case 3 calls its 3.50 USD gap a "shortfall"). Editable per entity.
  senderFeeBoundBaseUnits: 2_000_000n,
};

/** Ethereum addresses compare case-insensitively; TRON (base58) addresses are case-sensitive. */
export const normAddress = (network: string, address: string): string => (network === "tron" ? address : address.toLowerCase());
