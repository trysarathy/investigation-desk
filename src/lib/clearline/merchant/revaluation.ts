/**
 * v1 (founder decision 9): period-end revaluation of an entity's OTHER-currency balances (e.g. USD owed by the provider
 * to the SGD entity, sitting in provider clearing) at the period-end rate. Pure. Every output is a journal PROPOSAL
 * (`status: proposed`, `postingRuleStatus: pending_sign_off`) that also waits for the founder's sign-off of the FX
 * posting rules (`requiresApprovalOf`); nothing is posted. IAS 21 [ASSUMPTION: secondary source, for sign-off]: monetary
 * items in a foreign currency are translated at the closing rate; the difference is recognised in profit or loss.
 *  - The rate: the latest recorded `<currency>/<entity currency>` rate at or before the end of the period's last day in
 *    the entity's zone, at most 24 h older (fx.ts). None, or two that disagree: no entry; the balance "needs a rate".
 *  - The carrying value: the entity-currency value the balance is booked at. Unknown (null): no entry, "needs a rate"
 *    (Clearline never assumes the carrying value, and never uses 0 for it).
 *  - Debit balance (an asset, e.g. receivable from the provider) worth more at the closing rate: Dr the account /
 *    Cr Unrealised FX gain/loss; worth less: Dr Unrealised FX gain/loss / Cr the account. A credit balance the same way.
 */
import { fmtFiat } from "./amounts";
import { endOfLocalDay, valueIn } from "./fx";
import { MERCHANT_ACCOUNTS, type JournalLine, type JournalProposal, type MerchantAccount } from "./journal";
import { active } from "./rules";
import { TEST_MODE_LABEL, type FiatCurrency, type FiatRate, type FxValue, type MerchantEntity } from "./types";

/** The sign-off every revaluation proposal waits for, besides the usual approval before posting. */
export const FX_SIGN_OFF = "founder sign-off: FX posting rules (docs/POSTING_RULES.md, other-currency bank accounts)";

/** Revalued accounts: the receivable from the provider (provider clearing). [ASSUMPTION] the ledger revalues the bank itself. */
export type RevaluedAccount = Extract<MerchantAccount, "provider_clearing">;

export interface ForeignBalance {
  account: RevaluedAccount;
  currency: FiatCurrency;
  /** Signed balance in `currency` (debit positive), in its minor units. */
  foreignMinor: bigint;
  /** Signed carrying value in the entity's currency (debit positive), or null when it is not known. */
  carryingMinor: bigint | null;
  /** Where the balance comes from (ids only), e.g. "provider P, USD account". */
  ref: string;
}

export type RevaluationItem =
  | { status: "proposed"; balance: ForeignBalance; closing: Extract<FxValue, { status: "rated" }>; differenceMinor: bigint; proposalId: string }
  | { status: "no_difference"; balance: ForeignBalance; closing: Extract<FxValue, { status: "rated" }> }
  | { status: "needs_rate"; balance: ForeignBalance; reason: string };

export function proposeRevaluations(entity: MerchantEntity, periodEnd: string, balances: readonly ForeignBalance[], rates: readonly FiatRate[]): { items: RevaluationItem[]; proposals: JournalProposal[] } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) throw new RangeError("periodEnd is a calendar date (YYYY-MM-DD)");
  const cur = entity.functionalCurrency;
  const at = endOfLocalDay(periodEnd, entity.timeZone.utcOffsetMinutes);
  const items: RevaluationItem[] = [];
  const proposals: JournalProposal[] = [];
  const sorted = [...balances].sort((a, b) => (`${a.account}|${a.currency}|${a.ref}` < `${b.account}|${b.currency}|${b.ref}` ? -1 : 1));
  for (const bal of sorted) {
    if (bal.currency === cur) throw new RangeError(`a ${cur} balance is not an other-currency balance of ${entity.id}`);
    const closing = valueIn(bal.foreignMinor, bal.currency, cur, rates, at);
    if (closing.status === "needs_rate") { items.push({ status: "needs_rate", balance: bal, reason: closing.reason }); continue; }
    if (bal.carryingMinor === null) { items.push({ status: "needs_rate", balance: bal, reason: `the carrying value of this ${bal.currency} balance in ${cur} is not known (a rate at booking is missing)` }); continue; }
    const diff = closing.amountMinor - bal.carryingMinor;
    if (diff === 0n || !active("J.revaluation.period_end")) { items.push({ status: "no_difference", balance: bal, closing }); continue; }
    const id = `JP-FXRV-${periodEnd}-${bal.account}-${bal.currency}-${bal.ref}`.replace(/[^A-Za-z0-9_.:-]/g, "_");
    const abs = diff < 0n ? -diff : diff;
    const lines: JournalLine[] = diff > 0n
      ? [{ side: "debit", account: bal.account, amountMinor: abs }, { side: "credit", account: "unrealised_fx", amountMinor: abs }]
      : [{ side: "debit", account: "unrealised_fx", amountMinor: abs }, { side: "credit", account: bal.account, amountMinor: abs }];
    proposals.push({
      label: TEST_MODE_LABEL, id, kind: "fx_revaluation", status: "proposed", postingRuleStatus: "pending_sign_off", ruleId: "J.revaluation.period_end", entityId: entity.id, currency: cur,
      entryDate: periodEnd, requiresApprovalOf: FX_SIGN_OFF,
      memo: `Period-end revaluation of ${MERCHANT_ACCOUNTS[bal.account]} in ${bal.currency} (${bal.ref}): ${fmtFiat(bal.foreignMinor, bal.currency)} at ${closing.pair} ${closing.rate} (${closing.source}, as of ${closing.asOf}) = ${fmtFiat(closing.amountMinor, cur)}; carried at ${fmtFiat(bal.carryingMinor, cur)}. Unrealised ${diff > 0n ? "gain" : "loss"} ${fmtFiat(abs, cur)}. Proposed only; FX posting rules are pending sign-off.`,
      lines, evidence: { orderIds: [], providerPaymentIds: [], txHashes: [] },
    });
    items.push({ status: "proposed", balance: bal, closing, differenceMinor: diff, proposalId: id });
  }
  return { items, proposals };
}
