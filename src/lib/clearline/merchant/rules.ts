import type { Step } from "./types";

/** Every rule the engine can decide or record with. IDs are stable: M<step>.<area>.<rule>. */
export const RULES = {
  "M1.chain.unavailable": { step: 1, text: "Chain data for this order's deposit address or transaction could not be read: shown as unavailable, never matched; retried on the next run." },
  "M1.identity.network_disabled": { step: 1, text: "The transfer is on a network that is not enabled (or not configured)." },
  "M1.identity.unknown_token": { step: 1, text: "The (network, contract) pair is not a configured token." },
  "M1.identity.lookalike_token": { step: 1, text: "Same symbol as a configured token but a different contract." },
  "M1.finality.pending": { step: 1, text: "Fewer confirmations than the network's finality rule: ignored and recorded as pending." },
  "M2.reference.unattributed": { step: 2, text: "The transfer reaches no deposit address issued for an order." },
  "M2.reference.no_chain_transfer": { step: 2, text: "The provider reports a payment but no transfer reached this order's deposit address." },
  "M2.reference.provider_ref_mismatch": { step: 2, text: "The provider record names a different quote or link than the deposit address." },
  "M3.currency.invoice_currency": { step: 3, text: "The invoice is not in the entity's functional currency." },
  "M3.currency.token_mismatch": { step: 3, text: "The token received is not the token quoted for that deposit address." },
  "M3.direction.outbound": { step: 3, text: "The transfer leaves a deposit address instead of arriving at one." },
  "M3.window.before_quote": { step: 3, text: "The transfer predates the quote." },
  "M3.window.after_expiry_no_requote": { step: 3, text: "The transfer arrived after the quote expired and the provider did not re-quote." },
  "M3.quote.invoice_mismatch": { step: 3, text: "The quoted amount at the quoted rate does not equal the invoice." },
  "M3.provider.no_record": { step: 3, text: "A final, referenced transfer has no provider record." },
  "M3.provider.received_mismatch": { step: 3, text: "The provider's received amount differs from the chain." },
  "M3.batch.unknown_batch": { step: 3, text: "The provider names a settlement batch that does not exist." },
  "M3.batch.held_by_provider": { step: 3, text: "Shown as completed but held for review and in no settlement." },
  "M4.provider.credit_mismatch": { step: 4, text: "Credited amount is not received × executed rate (half-up)." },
  "M4.tolerance.sender_side_fee": { step: 4, text: "Received < quoted by at most the network-fee bound, and the provider claims paid." },
  "M4.tolerance.requote_after_expiry": { step: 4, text: "Transfer after expiresAt and the provider re-quoted: the rate part is a re-quote." },
  "M4.tolerance.rate_difference": { step: 4, text: "Executed rate differs from the quoted rate." },
  "M4.tolerance.underpayment": { step: 4, text: "Received < quoted beyond the sender-fee bound: the rest stays owed." },
  "M4.tolerance.overpayment": { step: 4, text: "Received > quoted: the excess is a customer-overpayment liability." },
  "M4.partial.balance_link_open": { step: 4, text: "A balance link is still unpaid: the open balance is part paid, not overdue." },
  "M4.match.no_difference": { step: 4, text: "Credited equals the invoice exactly." },
  "M4.tolerance.within_band": { step: 4, text: "|difference| ≤ min(pct × invoice, abs): matched with difference, write-off proposed." },
  "M4.tolerance.writeoff_threshold": { step: 4, text: "Within the band but above the write-off threshold: review." },
  "M4.tolerance.explained_outside_band": { step: 4, text: "Outside the band but fully explained by typed items: review." },
  "M4.tolerance.underpayment_beyond_band": { step: 4, text: "Underpayment beyond the band: exception." },
  "M4.tolerance.overpayment_beyond_band": { step: 4, text: "Overpayment beyond the band: exception." },
  "M4.tolerance.unexplained": { step: 4, text: "A difference with no typed explanation: exception (abstain)." },
  "M5.bridge.timing_prior_batch": { step: 5, text: "Merchant-day payments settled in an earlier batch are bridged out (and earlier-day payments in)." },
  "M5.bridge.timing_next_batch": { step: 5, text: "Next-day payments inside this provider day are bridged in (and later-batch payments out)." },
  "M5.bridge.held_by_provider": { step: 5, text: "Payments held by the provider are bridged out of the merchant day." },
  "M5.batch.not_tied": { step: 5, text: "A batch ties only when gross − fees − refunds = net = the bank line, to the cent; otherwise exception." },
  "M5.bank.imported_not_verified": { step: 5, text: "A csv_import bank line alone never makes settlement verified (unless the policy allows it)." },
  "M5.grouping.proposed_needs_confirmation": { step: 5, text: "No batch ID: a grouping is only proposed and never auto-closed." },
  "M5.batch.tied_verified": { step: 5, text: "An exact payment in a tied, verified batch is matched at step 5." },
} as const satisfies Record<string, { step: Step; text: string }>;

export type RuleId = keyof typeof RULES;

/** Journal proposal rules (phase 5). Patterns derived from the case figures [ASSUMPTION: Document A not available; reconcile]. */
export const JOURNAL_RULES = {
  "J.confirmation.chain_evidenced": { text: "A provider confirmation is proposed only for a record backed by a final, referenced inbound transfer that agrees with the chain." },
  "J.confirmation.overpayment_liability": { text: "Credit beyond the invoice goes to Customer overpayments (liability), never to AR." },
  "J.writeoff.on_approval": { text: "A proposed write-off has a matching entry, to post only after the rc5 two-person approval." },
  "J.settlement.verified_batch": { text: "Settlement is proposed only for a tied batch whose settlement is verified." },
  "J.settlement.refund_netted": { text: "A refund netted in a verified settlement is its own entry, Dr Sales refunds / Cr Provider clearing (Document A, Case 2)." },
} as const satisfies Record<string, { text: string }>;
export type JournalRuleId = keyof typeof JOURNAL_RULES;

/**
 * Whether a rule is in force. Always true in the product. It exists only so docs/plan/RC6_RULE_PROOFS.md can
 * show, by editing this one line in a scratch copy, that each rule's test fails without the rule.
 */
export const active = (id: RuleId | JournalRuleId): boolean => id.length > 0;
