/**
 * rc7: a provider record that names a transaction but no log index (most provider exports carry none). Its transfer
 * is resolved against CHAIN facts by (network, tx hash, the record's token contract, recipient = the deposit address
 * issued for the record's quote or link). Exactly one transfer → that transfer's log index. Several → ambiguous: the
 * order abstains (M3.provider.transfer_ambiguous) rather than the engine choosing. None → left unresolved (no chain
 * fact: the usual "no transfer" rules apply). The log index is never assumed. Pure and memoised per input.
 */
import { normAddress } from "./config";
import type { ProviderPaymentRecord, ReconcileInput, TokenRef } from "./types";

export interface ClaimResolution { input: ReconcileInput; ambiguous: ReadonlyMap<string, string> }

const memo = new WeakMap<ReconcileInput, ClaimResolution>();
const hashOf = (network: string, h: string) => (network === "tron" ? h.toLowerCase().replace(/^0x/, "") : h.toLowerCase());

export function resolveClaimedTransfers(input: ReconcileInput): ClaimResolution {
  const hit = memo.get(input);
  if (hit) return hit;
  const ambiguous = new Map<string, string>();
  let changed = false;
  const issuedFor = (r: ProviderPaymentRecord): { address: string; token: TokenRef } | undefined => {
    if (r.ref.linkId !== undefined) {
      const l = input.paymentLinks.find((x) => x.linkId === r.ref.linkId);
      return l && { address: l.depositAddress, token: l.token };
    }
    const q = r.ref.quoteId !== undefined ? input.quotes.find((x) => x.quoteId === r.ref.quoteId) : undefined;
    return q && { address: q.depositAddress, token: q.token };
  };
  const records = input.providerRecords.map((r) => {
    if (!r.logIndexUnknown || !r.transferRef) return r;
    const ref = r.transferRef;
    const issued = issuedFor(r);
    if (!issued || issued.token.network !== ref.network) return r;
    const n = ref.network;
    const hits = input.transfers.filter((t) => t.network === n && hashOf(n, t.txHash) === hashOf(n, ref.txHash)
      && normAddress(n, t.to) === normAddress(n, issued.address) && normAddress(n, t.tokenContract) === normAddress(n, issued.token.contract));
    if (hits.length === 1) {
      changed = true;
      const rest = { ...r };
      delete rest.logIndexUnknown;
      return { ...rest, transferRef: { network: n, txHash: hits[0].txHash, logIndex: hits[0].logIndex } };
    }
    if (hits.length > 1) {
      ambiguous.set(r.providerPaymentId, `Provider record ${r.providerPaymentId} names transaction ${ref.txHash} without a log index, and ${hits.length} of its transfers (log indexes ${hits.map((h) => h.logIndex).sort((a, b) => a - b).join(", ")}) reach the address issued for it.`);
    }
    return r;
  });
  const out: ClaimResolution = { input: changed ? { ...input, providerRecords: records } : input, ambiguous };
  memo.set(input, out);
  memo.set(out.input, out);
  return out;
}
