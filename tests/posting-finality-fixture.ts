import { EvmFetcher, type EvmSource } from "@/lib/chain/evm";
import { TRANSFER_TOPIC } from "@/lib/chain/abi";
import { toBaseUnits } from "@/lib/requests/lifecycle";
import type { Observation } from "@/lib/requests/types";

export function finalityFixture(observations: Observation[], change: (method: string, result: any) => any = (_, r) => r) {
  const blockHash = `0x${"ab".repeat(32)}`;
  const calls: { method: string; params: unknown[]; ttl: number }[] = [];
  const hex = (n: number) => `0x${n.toString(16)}`;
  const source: EvmSource = { kind: "public-rpc", async call(method, params, opts) {
    calls.push({ method, params, ttl: opts.ttlSec });
    const o = observations.find((x) => x.hash === params[0]) ?? observations[0];
    const result = method === "eth_getBlockByNumber"
      ? { number: hex(o.blockNumber!), hash: blockHash, timestamp: hex(Date.parse(o.blockTime!) / 1000) }
      : { transactionHash: o.hash, blockNumber: hex(o.blockNumber!), blockHash, status: "0x1", logs:
        observations.filter((x) => x.hash === o.hash).map((x) => ({ logIndex: hex(x.logIndex), address: x.tokenContract,
          topics: [`0x${TRANSFER_TOPIC}`, `0x${x.from.slice(2).padStart(64, "0")}`, `0x${x.to.slice(2).padStart(64, "0")}`],
          data: `0x${BigInt(toBaseUnits(x.amount)).toString(16).padStart(64, "0")}`, removed: false,
          transactionHash: x.hash, blockNumber: hex(x.blockNumber!), blockHash })) };
    return change(method, result);
  } };
  return { evm: new EvmFetcher({ ethereum: source }), calls };
}
