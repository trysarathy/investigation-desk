// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TEMPORARY LOCAL ADAPTER — replace with crypto-protocol-engineer's module from `feat/s1-release-checks`.
//
// Same shape as the agreed interface: CheckState, ReleaseChecks and releaseHeadline(checks), which owns
// ALL the release wording. Until that branch lands, this stand-in:
//   - never runs a sanctions or issuer-freeze check (both are `not_run`, see notRun* below), so every
//     card honestly says "Sender NOT checked.";
//   - words the headline from the checks only, and never uses the word "safe".
// When their module lands: `git merge` it, re-export from it here (or import it directly) and delete
// the bodies below. Nothing else in the UI should need to change.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type CheckState = "passed" | "failed" | "not_run";
export interface Check { state: CheckState; detail: string; source?: string; checkedAt?: string }
export interface ReleaseChecks { finality: Check; token: Check; amount: Check; sanctions: Check; freeze: Check }
export type ReleaseTone = "paid" | "not_yet" | "problem";
export interface ReleaseHeadline { tone: ReleaseTone; headline: string; lines: string[] }

/** TEMPORARY: no sanctions list is read in this build. */
export const notRunSanctions = (): Check => ({ state: "not_run", detail: "Sender not checked against the public US sanctions list (OFAC SDN digital-currency addresses) in this demo build." });
/** TEMPORARY: no issuer freeze status is read in this build. */
export const notRunFreeze = (): Check => ({ state: "not_run", detail: "Sender not checked for an issuer freeze (Tether or Circle) in this demo build." });

/** TEMPORARY wording, from the checks only. */
export function releaseHeadline(c: ReleaseChecks): ReleaseHeadline {
  const all = [c.finality, c.token, c.amount, c.sanctions, c.freeze];
  const failed = all.filter((x) => x.state === "failed");
  if (failed.length) {
    return { tone: "problem", headline: `${failed[0].detail} Don't release yet.`, lines: [...failed.slice(1).map((x) => x.detail), ...all.filter((x) => x.state === "not_run").map((x) => x.detail)] };
  }
  if (c.finality.state !== "passed") return { tone: "not_yet", headline: "Not final yet.", lines: [c.finality.detail] };
  if (c.token.state !== "passed" || c.amount.state !== "passed") {
    return { tone: "not_yet", headline: "Paid and final, but not matched yet.", lines: [c.token, c.amount].filter((x) => x.state !== "passed").map((x) => x.detail) };
  }
  const sender = c.sanctions.state === "passed" && c.freeze.state === "passed"
    ? "Sender not on public sanctions lists. Not frozen."
    : "Sender NOT checked.";
  return { tone: "paid", headline: `Paid and final. Right token and amount. ${sender}`, lines: [c.finality.detail, c.token.detail, c.amount.detail, c.sanctions.detail, c.freeze.detail] };
}
