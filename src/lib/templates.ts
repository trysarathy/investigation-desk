import type { Code } from "./types";

/**
 * Approved reply templates from the spec (section 2). Codes without an approved template
 * get no draft: the analyst writes the reply. {date} is left for the analyst to fill.
 */
export const REPLY_TEMPLATES: Partial<Record<Code, string>> = {
  D02: "Your transfer is on the {chain} network and has {n} of {N} confirmations. It will be credited automatically once confirmed, usually within {eta}.",
  D03: "Your transaction failed on the network ({error}), so no {token} left your wallet. You can send it again; network fees for the failed attempt are not refundable.",
  D04: "Your {token} was sent on {found_chain}, but we only accept it on {expected_chain}. Our team is reviewing whether it can be recovered. We'll update you by {date}.",
  D06: "The token you sent is not genuine {symbol}: its contract address doesn't match the official one. It can't be credited. Please be cautious with whoever supplied it.",
  D07: "The funds went to {short_addr}, which is not your deposit address. We can't access or recover funds at that address. Always copy your address from our app, never from your transaction history.",
  D07b: "The funds went to {short_addr}, which is not your deposit address. We can't access or recover funds at that address. Always copy your address from our app, never from your transaction history.",
  D08: "Your deposit of {amount} is below our minimum of {min} {token}. {policy_sentence}",
  D12: "We can see your transfer arrived. Our team is completing the credit and will confirm by {date}.",
  D09: "Your deposit is under review. We'll contact you when the review is complete.",
  D14: "Your deposit is under review. We'll contact you when the review is complete.",
};

/** Placeholders the analyst must fill before sending. */
export const ANALYST_FIELDS = new Set(["date"]);

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
