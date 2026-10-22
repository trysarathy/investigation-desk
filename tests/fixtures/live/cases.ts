// Real public USDT transfers, recorded from TronGrid and Etherscan V2 (week 2 "done when").
// The chain data is real and replayed byte for byte. The company side (File A, ledger, customer)
// is a synthetic test workspace built around each transfer to exercise a specific verdict.

import type { Code, DepositAddressRow, LedgerRow } from "../../../src/lib/types";

export interface LiveCase {
  name: string;
  hash: string;
  explorer: string;
  /** Who the sender and recipient are, and where that label comes from. */
  labels: { from: string; to: string; source: string };
  transfer: { chain: "tron" | "ethereum"; from: string; to: string; amount: string; contract: string };
  workspace: { customerId?: string; depositAddresses: DepositAddressRow[]; ledger: LedgerRow[] };
  expected: { state: "verdict" | "paused"; code?: Code; confidence?: "High" | "Medium" };
  why: string;
}

const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const TETHER_TREASURY_TRON = "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs";
const TETHER_TREASURY_ETH = "0x5754284f345afc66a98fbb0a0afe71e0f007b949";
const LEDGER_AT = "2026-10-22T09:00:00+08:00";

export const LIVE_CASES: LiveCase[] = [
  {
    name: "tron-bitfinex-to-tether-treasury",
    hash: "3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064",
    explorer: "https://tronscan.org/#/transaction/3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064",
    labels: {
      from: "Bitfinex", to: "Tether Treasury",
      source: "Whale Alert (whale-alert.io/transaction/tron/3df3…3064); Tronscan tags the recipient \"Tether Treasury\"",
    },
    transfer: { chain: "tron", from: "TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ", to: TETHER_TREASURY_TRON, amount: "49975000.000000", contract: USDT_TRON },
    workspace: {
      customerId: "C-LIVE-01",
      depositAddresses: [{ row: 2, address: TETHER_TREASURY_TRON, chain: "tron", customerId: "C-LIVE-01", assignedAt: "2024-01-01T00:00:00+08:00" }],
      ledger: [],
    },
    expected: { state: "verdict", code: "D12", confidence: "High" },
    why: "Every chain check passes on live data: mined, SUCCESS, official USDT, well past 20 confirmations, to this customer's address. No ledger row, so D12.",
  },
  {
    name: "tron-tether-treasury-to-binance",
    hash: "e25114e130161005c3173f2cb5a90d35d8d48cbffde637e525b0cf35701151b1",
    explorer: "https://tronscan.org/#/transaction/e25114e130161005c3173f2cb5a90d35d8d48cbffde637e525b0cf35701151b1",
    labels: {
      from: "Tether Treasury", to: "Binance",
      source: "Whale Alert (whale-alert.io/transaction/tron/e251…51b1); sender is the Tronscan-tagged Tether Treasury",
    },
    transfer: { chain: "tron", from: TETHER_TREASURY_TRON, to: "TETzqWSBDY12HrK4MsPq8A3AvZzhjoHgbx", amount: "500000000.000000", contract: USDT_TRON },
    workspace: {
      customerId: "C-LIVE-02",
      // The customer's real deposit address is a different one: the Binance wallet is not in File A.
      depositAddresses: [{ row: 2, address: TETHER_TREASURY_TRON, chain: "tron", customerId: "C-LIVE-02", assignedAt: "2024-01-01T00:00:00+08:00" }],
      ledger: [],
    },
    expected: { state: "verdict", code: "D07", confidence: "High" },
    why: "A real, successful USDT transfer whose destination is not in File A: D07 wrong address.",
  },
  {
    name: "eth-binance14-to-tether-treasury",
    hash: "0x1f8e11a6ea2dca0b1dfa896f2d440eedbbe9d959060c5bf1da9d45662e8b24b3",
    explorer: "https://etherscan.io/tx/0x1f8e11a6ea2dca0b1dfa896f2d440eedbbe9d959060c5bf1da9d45662e8b24b3",
    labels: {
      from: "Binance 14", to: "Tether Treasury",
      source: "Blockscan labels 0x28c6…1d60 \"Binance 14\"; QuickNode's Tether-liquidity docs use 0x5754…b949 as the Tether Treasury",
    },
    transfer: { chain: "ethereum", from: "0x28c6c06298d514db089934071355e5743bf21d60", to: TETHER_TREASURY_ETH, amount: "500000000.000000", contract: USDT_ETH },
    workspace: {
      customerId: "C-LIVE-03",
      // The customer's deposit address exists only on BNB Chain; the funds arrived on Ethereum.
      depositAddresses: [{ row: 2, address: TETHER_TREASURY_ETH, chain: "bsc", customerId: "C-LIVE-03", assignedAt: "2024-01-01T00:00:00+08:00" }],
      ledger: [],
    },
    expected: { state: "verdict", code: "D04", confidence: "High" },
    why: "Found on Ethereum (chain ID 1), but the destination is registered only on BNB Chain: D04 wrong network.",
  },
  {
    name: "unknown-hash-free-plan",
    hash: "4a1d0f6b9c3e2a7d8f5b6c4e3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d",
    explorer: "https://tronscan.org/#/transaction/4a1d0f6b9c3e2a7d8f5b6c4e3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d",
    labels: { from: "n/a", to: "n/a", source: "Made-up hash; on no chain" },
    transfer: { chain: "tron", from: "", to: "", amount: "", contract: "" },
    workspace: { customerId: "C-LIVE-04", depositAddresses: [], ledger: [] },
    expected: { state: "paused" },
    why: "Not found on Tron, Ethereum, Polygon or Arbitrum, but Etherscan's free plan refuses BNB Chain, Base and Optimism. Absence is unproven, so the case pauses instead of claiming D01.",
  },
];

export const liveWorkspace = (c: LiveCase) => ({ ...c.workspace, ledgerUploadedAt: LEDGER_AT });
