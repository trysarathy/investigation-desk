// Records the payout-side live fixtures (tests/fixtures/live/bsc-payout-*.json): real BNB Chain
// USDT transfers whose recipients are not demo deposit addresses, so payouts and the deposit demo
// never share a transfer. Each hash is looked up on every chain exactly as matching does.
//
//   NODE_USE_ENV_PROXY=1 npx vite-node --config vitest.config.mts scripts/record-payouts.ts
//
// Keys are optional: the lookups matching makes (transaction by hash on every chain, then block and
// token details where found) answered without keys when recorded. If a source refuses a keyless
// call, that real refusal is recorded and the file's note says so; on replay that chain reads as
// "didn't answer". Keys are redacted from every URL; a file containing one is refused.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchTransport, type HttpRequest, type Transport } from "../src/lib/chain/http";
import { buildFetchers } from "../src/lib/chain/sources";
import { MemoryStore } from "../src/lib/chain/store";
import { fetchTransfers } from "../src/lib/payments/chain";
import { redactUrl, type Exchange } from "../tests/fixtures/live/replay";

const PAYOUTS: { name: string; hash: string }[] = [
  { name: "bsc-payout-1", hash: "0xdd30c41dc59fb841d451bf098d6b64bd1ec5371e0927d7e863ca6a7fee7d00c7" },
  { name: "bsc-payout-2", hash: "0xe348b97f471659cf7ca7b65d65bff17a896e9a36f16bddd80fde1d9f91108325" },
  { name: "bsc-payout-3", hash: "0x2eefb453152d2166c7233c3d494fb0dbc6ddfae7db78f7d2be5cf7ec71ec378f" },
  { name: "bsc-payout-4", hash: "0x9ae6105d006176f68ef43453109de3f9f5fdbec7e895e9eda6dd0b39d3811d80" },
  { name: "bsc-payout-5", hash: "0x42f1d5b9b7be3a3786eaa1bb3440d22dd91769caac2c1a6b8af0d2c446afb9ff" },
  { name: "bsc-payout-6", hash: "0x7c1b18c35118e4aa40eb18f109a954cb6720db82384525dd9e8861a9bc26a7c4" },
];

const tronKey = process.env.TRONGRID_API_KEY ?? "";
const etherscanKey = process.env.ETHERSCAN_API_KEY ?? "";

for (const c of PAYOUTS) {
  const exchanges: Exchange[] = [];
  const recording: Transport = async (req: HttpRequest) => {
    const res = await fetchTransport(req);
    exchanges.push({
      request: { method: req.method, url: redactUrl(req.url), body: req.body },
      response: { status: res.status, headers: res.headers["retry-after"] ? { "retry-after": res.headers["retry-after"] } : {}, body: res.body },
    });
    return res;
  };
  const deps = buildFetchers({ tronKey, etherscanKey, store: new MemoryStore(), transport: recording });
  const { lookups, transfers } = await fetchTransfers([c.hash.replace(/^0x/, "")], deps);
  const recordedAt = new Date().toISOString();
  const out = JSON.stringify({
    name: c.name, hash: c.hash, explorer: `https://bscscan.com/tx/${c.hash}`, recordedAt,
    // Say what actually happened, from the responses themselves.
    note: exchanges.some((e) => /Missing\/Invalid API Key/.test(e.response.body))
      ? "Recorded without an Etherscan key: some Etherscan calls answered Missing/Invalid API Key."
      : tronKey || etherscanKey ? undefined : "Recorded without API keys; every chain answered.",
    exchanges,
  }, null, 1);
  for (const k of [tronKey, etherscanKey]) if (k && out.includes(k)) throw new Error(`Refusing to write ${c.name}: it contains an API key`);
  await writeFile(path.join("tests/fixtures/live", `${c.name}.json`), out + "\n");
  const t = transfers[0];
  console.log(c.name, lookups[0].result, lookups[0].chain, lookups[0].unresolved?.join(",") ?? "", t ? `${t.amount} ${t.token} -> ${t.to} idx ${t.transferIndex} ${t.eventTime}` : "");
}
