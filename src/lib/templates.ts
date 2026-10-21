import type { Code } from "./types";

const NEUTRAL_REVIEW = "Your deposit is under review. We'll contact you when the review is complete.";
const WRONG_ADDRESS = "The funds went to {short_addr}, which is not your deposit address. We can't access or recover funds at that address. Always copy your address from our app, never from your transaction history.";

/**
 * Approved reply templates from the spec (section 2, updated 22 Oct). No template may promise a
 * future credit: chain evidence establishes eligibility; only a ledger row establishes a credit.
 * {date} and {where_in_app} are left for the analyst to fill.
 */
export const REPLY_TEMPLATES: Partial<Record<Code, string>> = {
  D01: "We couldn't find a transaction with that ID on {chains_checked}. Could you send the transaction hash from the sending app's withdrawal history? If the sending platform shows it as pending, it may not have been sent yet.",
  D02: "Your transfer is on the {chain} network and has {n} of {N} confirmations. Once it reaches {N} confirmations it becomes eligible for crediting, usually within {eta}. We'll confirm when it has been credited.",
  D03: "Your transaction failed on the network ({error}), so no {token} left your wallet. You can send it again; network fees for the failed attempt are not refundable.",
  D04: "Your {token} was sent on {found_chain}, but we only accept it on {expected_chain}. Our team is reviewing whether it can be recovered. We'll update you by {date}.",
  D05: "We received {token} on {chain}, which we don't support for deposits. Our team is reviewing your case under our unsupported-asset policy and will update you by {date}.",
  D06: "The token you sent is not genuine {symbol}: its contract address doesn't match the official one. It can't be credited. Please be cautious with whoever supplied it.",
  D07: WRONG_ADDRESS,
  D07b: WRONG_ADDRESS,
  D08: "Your deposit of {amount} is below our minimum of {min} {token}. {policy_sentence}",
  D09: NEUTRAL_REVIEW,
  D10: "Your transaction is still waiting to be processed by the {chain} network. Once the network confirms it, our usual deposit checks apply. If it's still pending after {window}, please let us know.",
  D11: "The ID you sent is a withdrawal reference from the sending platform, not a network transaction hash. Please ask them for the on-chain transaction hash, or check whether the withdrawal has been sent yet.",
  D12: "We can see your transfer arrived. Our team is completing the credit and will confirm by {date}.",
  D13: "Your deposit of {amount} {token} was credited on {credited_at}. You can see it under {where_in_app}.",
  D14: NEUTRAL_REVIEW,
  D16: NEUTRAL_REVIEW,
};

/** Placeholders the analyst must fill before sending. */
export const ANALYST_FIELDS = new Set(["date", "where_in_app"]);

export interface FilledReply {
  text: string;
  /** Placeholders still unfilled after filling from evidence. */
  open: string[];
}

export function fillReply(code: Code, fill: Record<string, string>): FilledReply | null {
  const template = REPLY_TEMPLATES[code];
  if (!template) return null;
  const open: string[] = [];
  const text = template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!ANALYST_FIELDS.has(key) && fill[key] !== undefined) return fill[key];
    open.push(key);
    return whole;
  });
  return { text, open };
}
