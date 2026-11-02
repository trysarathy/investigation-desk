// Issuer freeze check for the release wording: the issuer's own read-only blacklist function on the
// sender AND the receiving address. Tether USDT `isBlackListed(address)` (Ethereum and Tron), Circle
// USDC `isBlacklisted(address)` (Ethereum): selectors in chain/investigate.ts FREEZE_SELECTOR.
// Receiver too, because Tether lets a payment INTO a blacklisted address (it then can't leave), while
// USDC reverts it (issuer-controls.md §1-2). Read at `latest`: a point-in-time answer that can change
// after. Any error, timeout or unreadable answer is not_run, never passed. Read-only: eth_call and
// TronGrid triggerconstantcontract only.

import { sameAddress } from "../address";
import { FREEZE_SELECTOR, type LiveDeps } from "../chain/investigate";
import { officialContractFor } from "../contracts";
import type { Chain, EvmChain, RawResponse, Token } from "../types";
import { REQUEST_SETTINGS } from "./check";
import { ISSUER, type FreezeCheck } from "./release-checks";

export interface FreezeQuery { chain: Chain; token: Token; contract: string; sender: string; receiver: string }

const sgt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " SGT";

export async function readIssuerFreeze(deps: Pick<LiveDeps, "tron" | "evm">, q: FreezeQuery, now = () => new Date(), settings = REQUEST_SETTINGS): Promise<FreezeCheck> {
  const issuer = ISSUER[q.token];
  const official = officialContractFor(q.chain, q.token, settings);
  // Only the genuine issuer contract can say an address is frozen (BNB Chain's declared contract can't).
  if (official?.source !== "issuer" || !sameAddress(official.contract, q.contract)) {
    return { state: "not_run", issuer, detail: `This isn't ${issuer}'s own ${q.token} contract, so freeze status wasn't checked.` };
  }
  const raws: RawResponse[] = [];
  const checkedAt = now().toISOString();
  let atBlock: number | undefined;
  if (q.chain !== "tron") {
    // Best effort: the block the answer refers to. A failure here leaves only the time.
    try {
      const head = await deps.evm.source(q.chain as EvmChain)?.call("eth_blockNumber", [], { ttlSec: 0 }, raws);
      atBlock = typeof head === "string" && /^0x[0-9a-f]+$/i.test(head) ? Number(BigInt(head)) : undefined;
    } catch { /* time only */ }
  }
  const { fn, selector } = FREEZE_SELECTOR[q.token];
  const addresses: NonNullable<FreezeCheck["addresses"]> = [];
  for (const [role, address] of [["sender", q.sender], ["receiver", q.receiver]] as const) {
    let frozen: boolean | undefined;
    if (q.chain === "tron") {
      frozen = await deps.tron.isBlackListed(official.contract, address, raws);
    } else {
      const word = address.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
      const out = await deps.evm.ethCall(q.chain as EvmChain, official.contract, `${selector}${word}`, 0, raws);
      frozen = out && /^0x[0-9a-f]{64}$/i.test(out) ? BigInt(out) !== 0n : undefined;
    }
    if (frozen === undefined) {
      return { state: "not_run", issuer, checkedAt, detail: `${issuer}'s contract didn't answer, so freeze status is unknown.` };
    }
    addresses.push({ role, address, frozen });
  }
  const at = `as of ${sgt(checkedAt)}${atBlock ? `, block ${atBlock}` : ""}`;
  const source = `${fn}(address) on ${official.contract} (${q.chain}); responses ${raws.map((r) => r.sha256.slice(0, 12)).join(", ")}`;
  const base = { issuer, checkedAt, atBlock, addresses, source };
  const frozen = addresses.filter((a) => a.frozen).map((a) => (a.role === "sender" ? "Sender" : "Receiving address"));
  return frozen.length
    ? { ...base, state: "failed", detail: `${frozen.join(" and ")} frozen by ${issuer} (${at}).` }
    : { ...base, state: "passed", detail: `Neither the sender nor the receiving address is frozen by ${issuer} (${at}); this can change later.` };
}
