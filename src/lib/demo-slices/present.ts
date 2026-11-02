// DEMO ONLY. Pure wording helpers for the demo-slice screens (no Node imports: the client islands use them).
// They label the checks; they never add a claim the checks didn't make.

import type { ReleaseChecks } from "../requests/release-checks";

/** "2 Nov 2026, 14:54 SGT". */
export const sgt = (iso: string | Date) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " SGT";

/** Any ISO timestamp in a line, shown as a person's time (SGT). */
export const humanTimes = (s: string) => s.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, (m) => sgt(m));

export type ChipTone = "pass" | "fail" | "warn" | "wait";
export interface Chip { key: keyof ReleaseChecks; label: string; word: string; tone: ChipTone }

/** The five checks as short chips. Not run = amber "NOT checked" (a warning, not a neutral grey). */
export function checkChips(c: ReleaseChecks, o: { wrongNetwork?: { sent: string; invoice: string } } = {}): Chip[] {
  const word = (s: string): [string, ChipTone] => s === "passed" ? ["checked", "pass"] : s === "failed" ? ["problem", "fail"] : s === "pending" ? ["not yet", "wait"] : ["NOT checked", "warn"];
  const chip = (key: keyof ReleaseChecks, label: string): Chip => { const [w, tone] = word(c[key].state); return { key, label, word: w, tone }; };
  const token = o.wrongNetwork
    ? { key: "token" as const, label: "Network", word: `problem (${o.wrongNetwork.sent}, invoice says ${o.wrongNetwork.invoice})`, tone: "fail" as const }
    : chip("token", "Token");
  return [chip("finality", "Final"), token, chip("amount", "Amount"), chip("sanctions", "Sanctions (US OFAC SDN only)"), chip("freeze", "Freeze")];
}

/** "3 of 5 checks ran. 2 did not — release is your call." Computed from the checks. */
export function ranSummary(c: ReleaseChecks, tone: "paid" | "not_yet" | "problem"): string {
  const all = Object.values(c);
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
