// Real public USDT transfers, recorded from TronGrid, Etherscan V2 and the official public RPCs.
// The chain data is real and replayed byte for byte. The company side (File A, ledger, customer,
// settings) is a synthetic test workspace built around each transfer to exercise one verdict.

import { SAMPLE_SETTINGS } from "../../../src/lib/fixtures";
import type { Code, DepositAddressRow, LedgerRow, Settings } from "../../../src/lib/types";

export interface LiveCase {
  name: string;
  hash: string;
  explorer: string;
  /** Who the sender and recipient are, and where that label comes from. */
  labels: { from: string; to: string; source: string };
  transfer: { chain: "tron" | "ethereum" | "bsc" | "polygon"; from: string; to: string; amount: string; contract: string; symbol?: string };
  workspace: { customerId?: string; depositAddresses: DepositAddressRow[]; ledger: LedgerRow[] };
  /** The test company's own settings, on top of the sample settings. */
  settings?: (s: Settings) => Settings;
  expected: { state: "verdict" | "paused"; code?: Code; confidence?: "High" | "Medium" };
  why: string;
}

const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const TETHER_TREASURY_TRON = "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs";
const TETHER_TREASURY_ETH = "0x5754284f345afc66a98fbb0a0afe71e0f007b949";
const LEDGER_AT = "2026-10-22T09:00:00+08:00";
const ASSIGNED = "2024-01-01T00:00:00+08:00";

// The token contract these BNB Chain transfers actually used, read from the transactions themselves.
// Neither Tether nor Circle lists a BNB Chain contract, so this is the test company's own allowlist
// choice, not an issuer-confirmed "official" contract (D06 and D09 stay off on BNB Chain).
const BSC_USDT_AS_OBSERVED = "0x55d398326f99059ff775485246999027b3197955";
const acceptBscUsdt = (min: string) => (s: Settings): Settings => ({
  ...s,
  acceptedTokens: { ...s.acceptedTokens, bsc: [{ symbol: "USDT", contract: BSC_USDT_AS_OBSERVED }] },
  minimums: { ...s.minimums, bsc: { USDT: min } },
});

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
      depositAddresses: [{ row: 2, address: TETHER_TREASURY_TRON, chain: "tron", customerId: "C-LIVE-01", assignedAt: ASSIGNED }],
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
      depositAddresses: [{ row: 2, address: TETHER_TREASURY_TRON, chain: "tron", customerId: "C-LIVE-02", assignedAt: ASSIGNED }],
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
      depositAddresses: [{ row: 2, address: TETHER_TREASURY_ETH, chain: "bsc", customerId: "C-LIVE-03", assignedAt: ASSIGNED }],
      ledger: [],
    },
    expected: { state: "verdict", code: "D04", confidence: "High" },
    why: "Found on Ethereum (chain ID 1), but the destination is registered only on BNB Chain: D04 wrong network.",
  },
  {
    name: "unknown-hash-not-found",
    hash: "4a1d0f6b9c3e2a7d8f5b6c4e3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d",
    explorer: "https://tronscan.org/#/transaction/4a1d0f6b9c3e2a7d8f5b6c4e3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d",
    labels: { from: "n/a", to: "n/a", source: "Made-up hash; on no chain" },
    transfer: { chain: "tron", from: "", to: "", amount: "", contract: "" },
    workspace: { customerId: "C-LIVE-04", depositAddresses: [], ledger: [] },
    expected: { state: "verdict", code: "D01", confidence: "High" },
    why: "Every chain answered (Tron, three via Etherscan, three via public RPC) and none has it: D01. In week 2 the free plan's refusals made this pause.",
  },
  {
    name: "bsc-binance-hot16-withdrawal",
    hash: "0x71a78d3bef17cf469a2296074d9569c57c2b288e394a379b12e6a7108de87c72",
    explorer: "https://bscscan.com/tx/0x71a78d3bef17cf469a2296074d9569c57c2b288e394a379b12e6a7108de87c72",
    labels: { from: "Binance: Hot Wallet 16", to: "unlabelled", source: "BscScan page title for 0xa180…d947 (via search results)" },
    transfer: { chain: "bsc", from: "0xa180fe01b906a1be37be6c534a3300785b20d947", to: "0x7c1f3180d059fef421b3a0eeb626d975e7577f41", amount: "1999.990000000000000000", contract: BSC_USDT_AS_OBSERVED },
    workspace: {
      customerId: "C-LIVE-05",
      depositAddresses: [{ row: 2, address: "0x7c1f3180d059fef421b3a0eeb626d975e7577f41", chain: "bsc", customerId: "C-LIVE-05", assignedAt: ASSIGNED }],
      ledger: [],
    },
    settings: acceptBscUsdt("10"),
    expected: { state: "verdict", code: "D12", confidence: "High" },
    why: "A real BNB Chain USDT withdrawal read through the public RPC: past 15 confirmations, to this customer's address, accepted token, above minimum, no ledger row.",
  },
  {
    name: "bsc-binance-hot11-below-minimum",
    hash: "0x5f1eada40d7a4f6c163d990b16e050092899adfbfe3a0fd23f1eb5c69f37612c",
    explorer: "https://bscscan.com/tx/0x5f1eada40d7a4f6c163d990b16e050092899adfbfe3a0fd23f1eb5c69f37612c",
    labels: { from: "Binance: Hot Wallet 11", to: "unlabelled", source: "BscScan page title for 0x161b…b645 (via search results)" },
    transfer: { chain: "bsc", from: "0x161ba15a5f335c9f06bb5bbb0a9ce14076fbb645", to: "0x9b9eb251f5cfa43b1ea4d753e9f459924df59f37", amount: "14.490000000000000000", contract: BSC_USDT_AS_OBSERVED },
    workspace: {
      customerId: "C-LIVE-06",
      depositAddresses: [{ row: 2, address: "0x9b9eb251f5cfa43b1ea4d753e9f459924df59f37", chain: "bsc", customerId: "C-LIVE-06", assignedAt: ASSIGNED }],
      ledger: [],
    },
    settings: acceptBscUsdt("20"),
    expected: { state: "verdict", code: "D08", confidence: "High" },
    why: "14.49 USDT against the company's 20 USDT minimum on BNB Chain: D08.",
  },
  {
    name: "polygon-usdt0-to-binance-hot20",
    hash: "0xe3980401d5ec8cadd7fca9d35da12fa69d717ed6d449d4670981900d2d8f602a",
    explorer: "https://polygonscan.com/tx/0xe3980401d5ec8cadd7fca9d35da12fa69d717ed6d449d4670981900d2d8f602a",
    labels: {
      from: "unlabelled", to: "Binance: Hot Wallet 20",
      source: "Etherscan and BscScan page titles for 0xf977…acec (via search results); the same 0x address on Polygon",
    },
    transfer: { chain: "polygon", from: "0x4b14a27ff0ad06364ac02d02970cd9d80cc1f8fb", to: "0xf977814e90da44bfa03b6295a0616a897441acec", amount: "0.010823", contract: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", symbol: "USDT0" },
    workspace: {
      customerId: "C-LIVE-07",
      // The same 0x address, registered only on Ethereum.
      depositAddresses: [{ row: 2, address: "0xf977814e90da44bfa03b6295a0616a897441acec", chain: "ethereum", customerId: "C-LIVE-07", assignedAt: ASSIGNED }],
      ledger: [],
    },
    expected: { state: "verdict", code: "D04", confidence: "High" },
    why: "A real transfer to a 0x address on Polygon (a cross-check chain) where the company only uses that address on Ethereum: D04 wrong network.",
  },
  {
    name: "tron-frozen-sender",
    hash: "056fbff6c4d78bd1f3f36ecd685f71f383efd6d23b176cecfaaa0fe47686c797",
    explorer: "https://tronscan.org/#/transaction/056fbff6c4d78bd1f3f36ecd685f71f383efd6d23b176cecfaaa0fe47686c797",
    labels: {
      from: "Frozen by Tether", to: "unlabelled",
      source: "Tether's own AddedBlackList event for TLGgXMMm…G5n9T on the USDT contract (tx db97d2ba…465a)",
    },
    transfer: { chain: "tron", from: "TLGgXMMm2qMDQHXrt5pnGEBHCoK5QG5n9T", to: "TDvCcgSKb72upPS2dVmjCkuxYvQJSSBgAS", amount: "655.000000", contract: USDT_TRON },
    workspace: {
      customerId: "C-LIVE-08",
      depositAddresses: [{ row: 2, address: "TDvCcgSKb72upPS2dVmjCkuxYvQJSSBgAS", chain: "tron", customerId: "C-LIVE-08", assignedAt: ASSIGNED }],
      ledger: [],
    },
    expected: { state: "verdict", code: "D09", confidence: "High" },
    why: "isBlackListed(sender) on Tron USDT returns true (read-only call): D09. Freeze state is as of recording.",
  },
];

export const liveWorkspace = (c: LiveCase) => ({ ...c.workspace, ledgerUploadedAt: LEDGER_AT });

export const liveSettings = (c: LiveCase): Settings => (c.settings ? c.settings(SAMPLE_SETTINGS) : SAMPLE_SETTINGS);
