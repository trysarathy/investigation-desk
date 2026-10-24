import { explorerTxUrl } from "../catalogue";
import { COMPANY_CONTRACT_LABEL, COMPANY_DECLARED_CHAINS } from "../contracts";
import { formatTime } from "../format";
import { sameAddress } from "../address";
import type { Evidence } from "../types";
import { CHAIN_NAMES, EVM_CHAIN_IDS } from "../types";
import type { Ctx } from "./context";

/** Evidence ids are stable so rules, the UI and any AI text can reference them. */
export const EV = {
  input: "ev.input",
  lookup: "ev.lookup",
  mempool: "ev.mempool",
  tx: "ev.tx",
  confirmations: "ev.confirmations",
  token: "ev.token",
  address: "ev.address",
  amount: "ev.amount",
  freeze: "ev.freeze",
  history: "ev.history",
  ledger: "ev.ledger",
  provider: "ev.provider",
} as const;

function chainLabel(chain: keyof typeof CHAIN_NAMES): string {
  return chain === "tron" ? "Tron" : `${CHAIN_NAMES[chain]} (chain ID ${EVM_CHAIN_IDS[chain]})`;
}

export function buildEvidence(ctx: Ctx): Evidence[] {
  const { facts, tx, transfer, settings } = ctx;
  const out: Evidence[] = [];

  out.push({
    id: EV.input,
    label: "Customer instruction",
    status: "info",
    value: facts.customerInferredFromRow !== undefined
      ? `Customer ${facts.customerId}, taken from File A line ${facts.customerInferredFromRow} (owner of the destination when the transfer was mined)`
      : facts.customerId ? `Reported by ${facts.customerId}` : "Reported by customer",
    mono: [{ label: inputKindLabel(facts.input.kind), value: facts.input.raw.trim() }],
    source: { kind: "input" },
  });

  if (facts.lookups.length > 0) {
    const found = facts.lookups.find((l) => l.result === "found");
    const errors = facts.lookups.filter((l) => l.result === "error");
    const pending = facts.lookups.filter((l) => l.result === "pending");
    const value = found
      ? `Found on ${chainLabel(found.chain)}`
      : errors.length
        ? `Check paused on ${errors.map((e) => CHAIN_NAMES[e.chain]).join(", ")}`
        : pending.length
          ? `Not mined: seen pending on ${pending.map((p) => CHAIN_NAMES[p.chain]).join(", ")}`
          : `Not found on ${facts.lookups.length} chains`;
    out.push({
      id: EV.lookup,
      label: "Chain lookup",
      status: found ? (ctx.depositChain ? "pass" : "warn") : errors.length ? "warn" : "fail",
      value,
      detail: facts.lookups
        .map((l) => `${CHAIN_NAMES[l.chain]}: ${l.result === "found" ? "found" : l.result === "pending" ? "pending, not mined" : l.result === "error" ? `error (${l.error ?? "unavailable"})` : "not found"} at ${formatTime(l.fetchedAt)}`)
        .join("\n"),
      source: found ? { kind: "explorer", url: found.sourceUrl } : { kind: "none" },
    });
  }

  if (facts.mempool) {
    out.push({
      id: EV.mempool,
      label: "Mempool",
      status: "warn",
      value: `Pending for ${Math.round((ctx.pendingSec ?? 0) / 60)} minutes, not mined`,
      detail: `Normal window on ${CHAIN_NAMES[facts.mempool.chain]}: ${Math.round(settings.pendingWindowSec[facts.mempool.chain] / 60)} minutes. Gas price ${facts.mempool.gasPriceGwei} gwei.`,
      mono: [{ label: "Hash", value: facts.mempool.hash }],
      source: { kind: "explorer", url: explorerTxUrl(facts.mempool.chain, facts.mempool.hash) },
    });
  }

  if (tx) {
    const failed = tx.status === "failed";
    out.push({
      id: EV.tx,
      label: "Chain transaction",
      status: failed ? "fail" : "pass",
      value: failed
        ? `Failed: ${tx.errorCode ?? "reverted"}${tx.feeBurned ? `, fee burned ${tx.feeBurned} ${tx.feeToken ?? ""}`.trimEnd() : ""}`
        : `Succeeded in block ${tx.blockNumber.toLocaleString("en-US")}`,
      detail: tx.isBatch
        ? `Batch contract call with ${tx.transfers.length} Transfer events; using event #${transfer?.logIndex ?? "?"}.`
        : `Mined ${formatTime(tx.blockTime)}`,
      mono: [
        { label: "Hash", value: tx.hash },
        ...(transfer ? [{ label: "From", value: transfer.from }] : []),
      ],
      source: { kind: "explorer", url: explorerTxUrl(tx.chain, tx.hash) },
    });
  }

  if (tx && tx.status === "success" && ctx.depositChain && (ctx.confirmations === undefined || ctx.threshold === undefined)) {
    out.push({
      id: EV.confirmations,
      label: "Confirmations",
      status: "warn",
      value: "Unknown: current block height unavailable",
      source: { kind: "none" },
    });
  }

  if (tx && tx.status === "success" && ctx.depositChain && ctx.confirmations !== undefined && ctx.threshold !== undefined) {
    const done = ctx.confirmations >= ctx.threshold;
    out.push({
      id: EV.confirmations,
      label: "Confirmations",
      status: done ? "pass" : "warn",
      value: `${Math.min(ctx.confirmations, ctx.threshold)} of ${ctx.threshold}`,
      detail: done ? undefined : `${ctx.threshold - ctx.confirmations} blocks to go`,
      source: { kind: "settings", key: `confirmations.${ctx.depositChain}` },
    });
  }

  if (transfer && tx) {
    const accepted = ctx.tokenAccepted && !ctx.impersonation;
    const company = ctx.officialSource === "company";
    out.push({
      id: EV.token,
      label: "Token contract",
      status: ctx.impersonation ? "fail" : accepted ? "pass" : "warn",
      value: ctx.impersonation
        ? company
          ? `Claims to be ${ctx.claimedToken}${ctx.lookalikeSymbol ? ` (symbol "${transfer.tokenSymbol}" uses look-alike characters)` : ""}; contract is not the ${COMPANY_CONTRACT_LABEL}`
          : `Claims to be ${ctx.claimedToken}${ctx.lookalikeSymbol ? ` (symbol "${transfer.tokenSymbol}" uses look-alike characters)` : ""}; contract is not the official one`
        : accepted
          ? company
            ? `${transfer.tokenSymbol} at the ${COMPANY_CONTRACT_LABEL}${ctx.officialNote ? ` (${ctx.officialNote})` : ""}`
            : `Official ${transfer.tokenSymbol}, on the allowlist`
          : `${transfer.tokenSymbol} at this contract is not on the allowlist for ${CHAIN_NAMES[tx.chain]}`,
      mono: [
        { label: "Received", value: transfer.tokenContract },
        ...(ctx.officialContract ? [{ label: company ? "Company-accepted" : "Official", value: ctx.officialContract }] : []),
      ],
      source: { kind: "settings", key: `acceptedTokens.${tx.chain}` },
    });

    const expected = ctx.customerAddresses.find((r) => r.chain === tx.chain && !r.retiredAt) ?? ctx.lookalike?.assigned ?? ctx.customerAddresses[0];
    const row = ctx.addrOnTxChain ?? ctx.addrOtherChain;
    out.push({
      id: EV.address,
      label: "Destination address",
      status: ctx.addrStatus === "this_customer" ? "pass"
        : ctx.addrStatus === "unattributed" || (!ctx.addrOnTxChain && ctx.addrOtherChain) ? "warn" : "fail",
      // Never name the other customer: evidence objects can reach the AI and the reply.
      value: ctx.addrOnTxChain
        ? ctx.addrStatus === "this_customer"
          ? "Company deposit address assigned to this customer"
          : ctx.addrStatus === "other_customer"
            ? "Company deposit address assigned to another customer at the time of the transfer"
            : ctx.addrStatus === "retired"
              ? `Company deposit address retired at ${formatTime(ctx.addrOnTxChain.retiredAt!)}, before the transfer`
              : "Company deposit address, not assigned to this case's customer at the time of the transfer"
        : ctx.addrOtherChain
          ? `Company deposit address on ${CHAIN_NAMES[ctx.addrOtherChain.chain]}, but funds arrived on ${CHAIN_NAMES[tx.chain]}`
          : ctx.lookalike
            ? "Not a company address; matches the customer's address on the first 4 and last 4 characters"
            : "Not in the deposit-address list",
      mono: [
        ...(expected && ctx.addrStatus !== "this_customer" && !sameAddress(expected.address, transfer.to) ? [{ label: "Expected", value: expected.address }] : []),
        { label: ctx.addrStatus === "this_customer" ? "Address" : "Actual", value: transfer.to },
      ],
      source: row ? { kind: "addresses", row: row.row } : expected ? { kind: "addresses", row: expected.row } : { kind: "none" },
    });

    if (ctx.tokenAccepted) {
      out.push({
        id: EV.amount,
        label: "Amount",
        status: !ctx.amountKnown ? "warn" : ctx.belowMinimum ? "fail" : "pass",
        value: !ctx.amountKnown
          ? `Unknown: chain reported "${transfer.amount}", not a plain decimal`
          : ctx.minimum
          ? `${transfer.amount} ${transfer.tokenSymbol}, minimum ${ctx.minimum}`
          : `${transfer.amount} ${transfer.tokenSymbol}, no minimum set`,
        source: { kind: "settings", key: `minimums.${ctx.depositChain}` },
      });
    }
  }

  if (facts.freezeStatus === "not_supported" || facts.freezeStatus === "failed") {
    out.push({
      id: EV.freeze,
      label: "Issuer freeze",
      status: facts.freezeStatus === "failed" ? "warn" : "info",
      value: facts.freezeStatus === "failed"
        ? "Unknown: the issuer freeze call failed"
        : tx && COMPANY_DECLARED_CHAINS.has(tx.chain)
          ? `Not available on ${CHAIN_NAMES[tx.chain]}: the token has no issuer freeze function (known gap; does not block a verdict)`
          : "Not checked: no confirmed issuer contract for this chain and token",
      source: { kind: "none" },
    });
  } else if (facts.freezes.length > 0) {
    const hits = ctx.freezeHits;
    out.push({
      id: EV.freeze,
      label: "Issuer freeze",
      status: hits.length ? "fail" : "pass",
      value: hits.length
        ? `${hits.map((h) => `${h.method}(${h.role})`).join(", ")} returned true at block ${hits[0].blockNumber.toLocaleString("en-US")}`
        : `No freeze on sender or deposit address`,
      mono: (hits.length ? hits : facts.freezes).map((f) => ({ label: f.role === "sender" ? "Sender" : "Deposit", value: f.address })),
      source: { kind: "none" },
    });
  }

  if (ctx.lookalike) {
    const p = ctx.lookalike.prior;
    out.push({
      id: EV.history,
      label: "Sender history",
      status: p ? "warn" : "info",
      value: p
        ? sameAddress(p.from, ctx.transfer!.to)
          ? `${p.amount} ${p.tokenSymbol} from the look-alike address to the sender at ${formatTime(p.time)}, before the payment`
          : `A forged ${p.amount} ${p.tokenSymbol} transfer from the sender to the look-alike address at ${formatTime(p.time)}, before the payment (zero value or a different token contract)`
        : facts.senderHistoryStatus === "not_supported"
          ? "Not available on this chain (public RPC can't list history)"
          : facts.senderHistoryStatus === "failed"
            ? "Unknown: the history lookup failed"
            : "No earlier zero-value or dust transfer from the look-alike address",
      mono: p ? [{ label: "Earlier transfer", value: p.hash }] : undefined,
      source: p ? { kind: "explorer", url: explorerTxUrl(p.chain, p.hash) } : { kind: "none" },
    });
  }

  const m = ctx.ledgerMatch;
  const showLedger = !!m || (tx?.status === "success" && !!ctx.addrOnTxChain);
  if (showLedger) {
    const r = m?.row;
    const how = !m ? "" : m.quality === "exact"
      ? "Exact match on chain, tx hash, transfer index and token contract."
      : m.quality === "ambiguous"
        ? `Matched on tx hash only: no transfer index, and the transaction has ${ctx.companyTransferCount} transfers to company addresses. Capped at Medium.`
        : "Matched on address and amount only (no tx hash). Capped at Medium.";
    // D14 shows status and timestamp only; the reason code is shown only for a rejection.
    const reason = r?.status === "REJECTED" && r.reasonCode ? `Reason code ${r.reasonCode}.` : "";
    out.push({
      id: EV.ledger,
      label: "Ledger",
      status: !r ? "fail" : r.status === "CREDITED" && m?.quality === "exact" ? "pass" : r.status === "REJECTED" ? "fail" : "warn",
      value: !r
        ? "No ledger row for this transfer"
        : `${r.status}${r.creditedAt ? ` at ${formatTime(r.creditedAt)}` : ""} (${r.depositId})`,
      detail: [how, reason, `Ledger last uploaded ${formatTime(facts.ledgerUploadedAt)}`,
        facts.fileBRejectedRows ? `${facts.fileBRejectedRows} ledger row(s) were rejected at that upload.` : ""].filter(Boolean).join("\n"),
      source: r ? { kind: "ledger", row: r.row } : { kind: "none" },
    });
  }

  for (const [i, p] of (facts.providerEvents ?? []).entries()) {
    out.push({
      id: `${EV.provider}.${i}`,
      label: "Provider event",
      status: p.kind === "returned" ? "fail" : "info",
      value: `${p.provider}: ${p.kind.replace("_", " ")}, status ${p.providerStatus}${p.returnReason ? ` (${p.returnReason})` : ""}`,
      detail: `Reported ${formatTime(p.at)}`,
      source: { kind: "provider", provider: p.provider, reference: p.reference },
    });
  }

  return out;
}

function inputKindLabel(kind: string): string {
  switch (kind) {
    case "hash": return "Hash";
    case "tron_address": return "Tron address";
    case "evm_address": return "EVM address";
    case "customer_ref": return "Customer ref";
    default: return "Reference";
  }
}
