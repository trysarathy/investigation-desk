// DEMO ONLY. Pure wording helpers for the demo-slice screens (no Node imports: the client islands use them).
// They label the checks; they never add a claim the checks didn't make.

import { sgtTime, type CheckResult, type FinalityCheck, type ReleaseChecks } from "../requests/release-headline";

/** "2 Nov 2026, 2:54 pm SGT" (crypto-protocol-engineer's format, so every time on screen reads the same). */
export const sgt = (d: string | Date) => sgtTime(new Date(d).toISOString());

/** Any ISO timestamp in a line, shown as a person's time (SGT). */
export const humanTimes = (s: string) => s.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, (m) => sgt(m));

export type ChipTone = "pass" | "fail" | "warn" | "wait";
export interface Chip { key: keyof ReleaseChecks; label: string; word: string; tone: ChipTone }

/** The checks in display order, only those present (network and address are optional slots). */
export function presentChecks(c: ReleaseChecks): [keyof ReleaseChecks, CheckResult | FinalityCheck][] {
  const order: (keyof ReleaseChecks)[] = ["finality", "network", "address", "token", "amount", "sanctions", "freeze"];
  return order.filter((k) => c[k]).map((k) => [k, c[k]!]);
}

const LABEL: Record<keyof ReleaseChecks, string> = {
  finality: "Final", network: "Network", address: "Address", token: "Token", amount: "Amount", sanctions: "Sanctions (US OFAC SDN only)", freeze: "Freeze",
};

/** The checks as short chips. Not run = amber "NOT checked" (a warning, not a neutral grey). */
export function checkChips(c: ReleaseChecks, o: { paidOn?: string; invoiceOn?: string } = {}): Chip[] {
  return presentChecks(c).map(([key, x]) => {
    if (x.state === "passed") return { key, label: LABEL[key], word: "checked", tone: "pass" };
    if (x.state === "pending") return { key, label: LABEL[key], word: "not yet", tone: "wait" };
    if (x.state === "not_run") return { key, label: LABEL[key], word: "NOT checked", tone: "warn" };
    if (key === "network" && o.paidOn && o.invoiceOn) return { key, label: LABEL[key], word: `problem (${o.paidOn}, invoice says ${o.invoiceOn})`, tone: "fail" };
    if (key === "address") return { key, label: LABEL[key], word: /look-alike/.test(x.detail) ? "problem (look-alike address)" : "problem (different address)", tone: "fail" };
    if ((x as CheckResult).blocking === false) return { key, label: LABEL[key], word: "a person decides", tone: "warn" };
    return { key, label: LABEL[key], word: "problem", tone: "fail" };
  });
}

/** Technical detail (block numbers, contracts) for a collapsed view: never in the main lines. */
export const technicalLines = (c: ReleaseChecks) => presentChecks(c).filter(([, x]) => x.technical).map(([k, x]) => `${LABEL[k]}: ${humanTimes(x.technical!)}`);

/** "3 of 5 checks ran. 2 did not — release is your call." Computed from the checks. */
export function ranSummary(c: ReleaseChecks, tone: "paid" | "not_yet" | "problem"): string {
  const all = presentChecks(c).map(([, x]) => x);
  const ran = all.filter((x) => x.state !== "not_run").length;
  if (ran === all.length) return `All ${all.length} checks ran.`;
  const not = all.length - ran;
  return `${ran} of ${all.length} checks ran. ${not} did not${tone === "problem" ? "." : " — release is your call."}`;
}

/** The card's status label: never "not yet" when finality simply couldn't be read. */
export function statusLabel(c: ReleaseChecks, tone: "paid" | "not_yet" | "problem"): string {
  if (tone === "paid") return "Paid";
  if (tone === "problem") return "Problem";
  return c.finality.state === "not_run" ? "Finality not checked" : "Not final yet";
}
