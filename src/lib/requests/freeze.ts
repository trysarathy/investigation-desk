// Issuer freeze check for the release wording: the issuer's own read-only blacklist function on the
// sender AND the receiving address. Tether USDT `isBlackListed(address)` (Ethereum and Tron), Circle
// USDC `isBlacklisted(address)` (Ethereum): selectors in chain/investigate.ts FREEZE_SELECTOR.
// Receiver too, because Tether lets a payment INTO a blacklisted address (it then can't leave), while
// USDC reverts it (issuer-controls.md §1-2). Read at `latest`, never from cache: a point-in-time answer
// stamped with the read time, which can change after. A malformed address, any error, timeout or an
// answer that isn't exactly 0 or 1 is not_run, never passed. Read-only: eth_call and TronGrid
// triggerconstantcontract only.

import { sameAddress } from "../address";
import { FREEZE_SELECTOR, type LiveDeps } from "../chain/investigate";
import { officialContractFor } from "../contracts";
import { checkAddress } from "../csv/files";
import type { Chain, EvmChain, RawResponse, Token } from "../types";
import { REQUEST_SETTINGS } from "./check";
import { ISSUER, sgtTime, type FreezeCheck } from "./release-checks";

export interface FreezeQuery { chain: Chain; token: Token; contract: string; sender: string; receiver: string }

export async function readIssuerFreeze(deps: Pick<LiveDeps, "tron" | "evm">, q: FreezeQuery, now = () => new Date(), settings = REQUEST_SETTINGS): Promise<FreezeCheck> {
  const issuer = ISSUER[q.token];
  const official = officialContractFor(q.chain, q.token, settings);
  // Only the genuine issuer contract can say an address is frozen (BNB Chain's declared contract can't).
  if (official?.source !== "issuer" || !sameAddress(official.contract, q.contract)) {
    return { state: "not_run", issuer, detail: `This isn't ${issuer}'s own ${q.token} contract, so freeze status wasn't checked.` };
  }
  // Ask only about well-formed addresses: EVM 0x + 40 hex (EIP-55 if mixed case); Tron base58 with its
  // checksum, so a one-letter case change (a different account, or none) is never asked about.
  for (const a of [q.sender, q.receiver]) {
    if (typeof a !== "string" || checkAddress(q.chain, a.trim()) !== undefined) {
      return { state: "not_run", issuer, detail: "An address couldn't be read, so freeze status wasn't checked." };
    }
  }
  const raws: RawResponse[] = [];
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
  for (const [role, address] of [["sender", q.sender.trim()], ["receiver", q.receiver.trim()]] as const) {
    let frozen: boolean | undefined;
    if (q.chain === "tron") {
      frozen = await deps.tron.isBlackListed(official.contract, address, raws, 0);
    } else {
      const word = address.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
      const out = await deps.evm.ethCall(q.chain as EvmChain, official.contract, `${selector}${word}`, 0, raws);
      frozen = out && /^0x0{63}[01]$/i.test(out) ? out.endsWith("1") : undefined;
    }
    if (frozen === undefined) {
      return { state: "not_run", issuer, checkedAt: now().toISOString(), detail: `${issuer}'s contract didn't answer, so freeze status is unknown.` };
    }
    addresses.push({ role, address, frozen });
  }
  // Stamp = when the issuer actually answered (the last uncached read), not when the check started.
  const checkedAt = raws.at(-1)?.fetchedAt ?? now().toISOString();
  const technical = `${fn}(address) on ${official.contract} (${q.chain}) at ${atBlock ? `block ${atBlock}` : "the latest block"}; responses ${raws.map((r) => r.sha256.slice(0, 12)).join(", ")}.`;
  const base = { issuer, checkedAt, atBlock, addresses, source: `${fn}(address) on ${official.contract}`, technical };
  const frozen = addresses.filter((a) => a.frozen).map((a) => (a.role === "sender" ? "Sender" : "Receiving address"));
  const at = `as of ${sgtTime(checkedAt)}`;
  return frozen.length
    ? { ...base, state: "failed", detail: `${frozen.join(" and ")} frozen by ${issuer} (${at}).` }
    : { ...base, state: "passed", detail: `Neither the sender nor the receiving address is frozen by ${issuer} (${at}); this can change later.` };
}
