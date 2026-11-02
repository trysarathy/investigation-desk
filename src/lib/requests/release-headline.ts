// The "paid" wording, from check results (Aashmiin, 2 Nov 2026). UI-safe: no runtime imports at all
// (a test enforces it), so a client component can import the types and releaseHeadline() directly.
// The check builders that need settings, address helpers or the network are in release-checks.ts
// (server side), which re-exports everything here.
//
// Only checks that passed are claimed; one that couldn't run is said to be NOT checked; a failure
// that blocks release starts "Don't release:". Main lines are plain English: block numbers and other
// technical detail go in `technical`. The word "safe" is never produced.
// Sources and limits: team/knowledge/crypto-protocol-engineer/sanctions-freeze-sources.md.
//
// INTERNAL ONLY: these headlines and lines are for the business's own staff. The sanctions and freeze
// sentences must never be put into payer-facing text (payment page, customer replies, emails):
// tipping-off risk, docs/SPEC.md §2 "Legal note for D09 and D14" (replies must never mention
// sanctions, AML or suspicion).

export type CheckState = "passed" | "failed" | "not_run";

export interface CheckResult {
  state: CheckState;
  /** One plain sentence for the main lines: what was found, or why it couldn't be checked. */
  detail: string;
  /** Block numbers, contract methods and the like, for an expandable "details" view. */
  technical?: string;
  /** false: failed, but a person decides (e.g. overpaid, POSTING_RULES C5) rather than "Don't release". */
  blocking?: boolean;
  /** Where the answer came from (URL, contract + method, list file). */
  source?: string;
  /** ISO time the answer was read. */
  checkedAt?: string;
}

/** "pending": on the chain, not final yet. */
export interface FinalityCheck extends Omit<CheckResult, "state"> {
  state: CheckState | "pending";
  blockNumber?: number;
  finalizedBlock?: number;
  /** Kept for callers; not shown (the line uses the network's usual pace instead). */
  eta?: string;
}

export interface SanctionsCheck extends CheckResult {
  list: "OFAC SDN";
  /** The list's own publish date, from the recorded snapshot. Absent when no snapshot. */
  listDate?: string;
}

export interface FreezeCheck extends CheckResult {
  issuer?: "Tether" | "Circle";
  /** Block the call was answered at (latest at checkedAt), when known. Freeze status can change after it. */
  atBlock?: number;
  addresses?: { role: "sender" | "receiver"; address: string; frozen: boolean }[];
}

export interface ReleaseChecks {
  finality: FinalityCheck;
  token: CheckResult;
  amount: CheckResult;
  sanctions: SanctionsCheck;
  freeze: FreezeCheck;
  /** Paid on the invoice's network. Optional; a failure blocks release. */
  network?: CheckResult;
  /** Paid to the invoice's own receiving address (not a look-alike). Optional; a failure blocks release. */
  address?: CheckResult;
}

export interface ReleaseHeadline {
  tone: "paid" | "not_yet" | "problem";
  headline: string;
  lines: string[];
  /** True only when every check given passed. */
  allChecked: boolean;
}

export const ISSUER = { USDT: "Tether", USDC: "Circle" } as const;
export const SANCTIONS_SCOPE = "UN, EU, UK, Singapore (MAS), Hong Kong, UAE and other countries' lists are not checked, nor are owners of sanctioned people's companies.";

/** "2 Nov 2026, 2:54 pm SGT" (Singapore has no daylight saving: UTC+8 all year). */
export function sgtTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return ""; // an unreadable time is left out, never shown as "NaN"
  const d = new Date(t + 8 * 3_600_000);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${M} ${d.getUTCFullYear()}, ${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"} SGT`;
}

// Belt and braces: no sentence that says "safe" leaves this module, even one a caller passed in.
const clean = (s: string | undefined) => (s && !/safe/i.test(s) ? s : undefined);

export function releaseHeadline(c: ReleaseChecks): ReleaseHeadline {
  const all: CheckResult[] = [c.finality as CheckResult, c.network, c.address, c.token, c.amount, c.sanctions, c.freeze]
    .filter((x): x is CheckResult => !!x);
  const allChecked = all.every((x) => x.state === "passed");
  const lines = all.map((x) => clean(x.detail)).filter((x): x is string => !!x);
  if (c.sanctions.state === "passed") lines.push(`Sanctions: OFAC SDN list only, dated ${c.sanctions.listDate}. ${SANCTIONS_SCOPE}`);
  const said = (x: CheckResult) => clean(x.detail) ?? "A check failed.";

  const failed = all.filter((x) => x.state === "failed");
  const blocking = failed.filter((x) => x.blocking !== false), personDecides = failed.filter((x) => x.blocking === false);
  if (blocking.length) return { tone: "problem", headline: `Don't release: ${[...blocking, ...personDecides].map(said).join(" ")}`, lines, allChecked };
  if (c.finality.state === "pending") return { tone: "not_yet", headline: "Not final yet.", lines, allChecked };

  const tok = c.token.state === "passed", amt = c.amount.state === "passed", amtFailed = c.amount.state === "failed";
  const parts = [
    tok && amt ? "Right token and amount." : tok && amtFailed ? "Right token." : tok ? "Right token. Amount NOT checked."
      : amt ? "Right amount. Token NOT checked." : amtFailed ? "Token NOT checked." : "Token and amount NOT checked.",
    c.sanctions.state === "passed" ? "Sender not on the US OFAC SDN list." : "Sender NOT checked.",
    c.freeze.state === "passed" ? "Not frozen." : "Freeze status NOT checked.",
  ];
  // "Paid" needs finality AND the right token AND the right amount; anything less isn't called paid.
  if (c.finality.state !== "passed") return { tone: "not_yet", headline: "Finality NOT checked.", lines: [parts.join(" "), ...lines], allChecked };
  if (personDecides.length) {
    // "Paid and final." only with the right token; an overpayment says nothing about which token it was.
    const lead = tok ? "Paid and final." : "Final, but not confirmed as paid.";
    return { tone: "problem", headline: personDecides.map(said).join(" "), lines: [`${lead} ${parts.join(" ")}`, ...lines], allChecked };
  }
  if (!tok || !amt) return { tone: "not_yet", headline: `Final, but not confirmed as paid. ${parts.join(" ")}`, lines, allChecked };
  return { tone: "paid", headline: `Paid and final. ${parts.join(" ")}`, lines, allChecked };
}
