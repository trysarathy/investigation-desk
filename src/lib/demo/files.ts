// The demo company's Files A and B, and a bulk file: sample company data built around real,
// recorded public transfers (see RECORDINGS). Customers are made up; nothing here is customer data.

export const DEMO_FILE_A = `address,chain,customer_id,assigned_at,retired_at
TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs,tron,C-DEMO-01,2024-01-01T00:00:00+08:00,
TETzqWSBDY12HrK4MsPq8A3AvZzhjoHgbx,tron,C-DEMO-02,2024-01-01T00:00:00+08:00,
TDvCcgSKb72upPS2dVmjCkuxYvQJSSBgAS,tron,C-DEMO-03,2024-01-01T00:00:00+08:00,
0x5754284f345afc66a98fbb0a0afe71e0f007b949,ethereum,C-DEMO-04,2024-01-01T00:00:00+08:00,
0xf977814e90da44bfa03b6295a0616a897441acec,ethereum,C-DEMO-05,2024-01-01T00:00:00+08:00,
0x7c1f3180d059fef421b3a0eeb626d975e7577f41,bsc,C-DEMO-06,2024-01-01T00:00:00+08:00,
0x9b9eb251f5cfa43b1ea4d753e9f459924df59f37,bsc,C-DEMO-07,2024-01-01T00:00:00+08:00,
`;

export const DEMO_FILE_B = `deposit_id,tx_hash,chain,token,to_address,amount,status,credited_at,customer_id,transfer_index,reason_code
DEP-9001,0x1f8e11a6ea2dca0b1dfa896f2d440eedbbe9d959060c5bf1da9d45662e8b24b3,ethereum,USDT,0x5754284f345afc66a98fbb0a0afe71e0f007b949,500000000.000000,CREDITED,2026-10-22T13:30:00+08:00,C-DEMO-04,,
DEP-9002,e25114e130161005c3173f2cb5a90d35d8d48cbffde637e525b0cf35701151b1,tron,USDT,TETzqWSBDY12HrK4MsPq8A3AvZzhjoHgbx,500000000.000000,HELD,,C-DEMO-02,0,
`;

/** The hashes to use in the demo, in the order of the spec's demo script, with what they show. */
export const DEMO_STEPS: { hash: string; customer?: string; expect: string; note: string }[] = [
  { hash: "3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064", expect: "D12", note: "Step 2: Tron, arrived on-chain, not credited" },
  { hash: "3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064", customer: "C-DEMO-02", expect: "D17", note: "Same hash, reported by another customer: sent to another customer's address" },
  { hash: "0x71a78d3bef17cf469a2296074d9569c57c2b288e394a379b12e6a7108de87c72", expect: "D12", note: "BNB Chain (BSC-USD, sample setting), not credited" },
  { hash: "0x5f1eada40d7a4f6c163d990b16e050092899adfbfe3a0fd23f1eb5c69f37612c", expect: "D08", note: "BNB Chain, 14.49 under the 20 minimum" },
  { hash: "0xe3980401d5ec8cadd7fca9d35da12fa69d717ed6d449d4670981900d2d8f602a", expect: "D04", note: "Wrong network: Polygon, address used on Ethereum" },
  { hash: "056fbff6c4d78bd1f3f36ecd685f71f383efd6d23b176cecfaaa0fe47686c797", expect: "D09", note: "Issuer freeze: sender frozen by Tether" },
  { hash: "e25114e130161005c3173f2cb5a90d35d8d48cbffde637e525b0cf35701151b1", expect: "D14", note: "Ledger row HELD" },
  { hash: "0x1f8e11a6ea2dca0b1dfa896f2d440eedbbe9d959060c5bf1da9d45662e8b24b3", expect: "D13", note: "Ledger row CREDITED" },
  { hash: "4a1d0f6b9c3e2a7d8f5b6c4e3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d", expect: "D01", note: "Made-up hash: not found on any chain" },
];

/** Step 6: every demo hash once, plus one bad row to show it is skipped, not guessed. */
export const DEMO_BULK_CSV = [
  "tx_hash,chain,customer_id",
  ...[...new Set(DEMO_STEPS.map((s) => s.hash))].map((h) => `${h},,`),
  "WD-88231904,,",
].join("\n") + "\n";
