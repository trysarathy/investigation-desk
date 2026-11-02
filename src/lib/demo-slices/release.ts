// DEMO ONLY (S1, S1b, demo watcher). Turns the product's own result for one replayed transfer into
// the release checks, then into the card, the quiet notification previews and the watcher's timeline.
// Wording of the headline comes from releaseHeadline() (the adapter, later crypto-protocol-engineer's
// module); this file only says which check passed, failed or didn't run, with a detail line each.

import { sameAddress } from "../address";
import { OFFICIAL, REQUEST_SETTINGS } from "../requests/check";
import { compareAddress, formatUsdc } from "../requests/lifecycle";
import { shortAddr, shortHash } from "../requests/present";
import { confirmPace } from "../requests/status";
import { notRunFreeze, notRunSanctions, releaseHeadline, type Check, type ReleaseChecks, type ReleaseHeadline } from "./release-adapter";
import { replay, scenario, TRANSFER_LABEL, type Replayed } from "./replay";

const NET: Record<string, string> = { ethereum: "Ethereum", tron: "Tron", bsc: "BNB Chain" };
const ISSUER: Record<string, string> = { USDT: "Tether", USDC: "Circle" };
/** Two look-alike addresses shortened far enough to show where they differ. */
export function apart(a: string, b: string): [string, string] {
  let i = 0;
  while (i < a.length && a[i].toLowerCase() === b[i]?.toLowerCase()) i++;
  const head = Math.max(6, i + 2);
  return [`${a.slice(0, head)}…${a.slice(-4)}`, `${b.slice(0, head)}…${b.slice(-4)}`];
}
const need = (chain: string) => REQUEST_SETTINGS.confirmations[chain as keyof typeof REQUEST_SETTINGS.confirmations] ?? 12;

/** The five checks for one replayed transfer, from the product's view and the recorded chain facts. */
export function releaseChecks(r: Replayed): ReleaseChecks {
  const inv = r.invoice, t = inv.token, amt = (a: string) => `${formatUsdc(a.replace(/^-/, ""))} ${t}`;
  const at = r.recordedAt;
  const tx = r.facts?.tx;
  const chain = tx?.chain ?? "ethereum";
  const net = NET[chain] ?? chain;
  const blocks = tx && r.facts?.currentBlock !== undefined ? Math.max(0, r.facts.currentBlock - tx.blockNumber) : undefined;
  const confs = r.confirmations ?? blocks;
  const n = need(chain);
  const pace = confirmPace(chain);
  const finality: Check = confs === undefined
    ? { state: "not_run", detail: `Not in a block yet, so we can't say when it will be final.`, checkedAt: at }
    : confs >= n
      ? { state: "passed", detail: `Final: ${confs.toLocaleString("en-US")} blocks on top of the transfer on ${net}; Clearline waits for ${n}. (It doesn't read the network's own finality signal yet.)`, source: "Recorded chain data", checkedAt: at }
      : { state: "not_run", detail: `Not final yet: ${confs} of the ${n} blocks Clearline waits for. ${pace ? `${net} usually takes ${pace}; that's a usual pace, not a promise.` : "We can't say how long it will take."}`, source: "Recorded chain data", checkedAt: at };

  const v = r.view;
  const flag = v?.flagged.at(-1);
  const official = OFFICIAL[t];
  let token: Check;
  let amount: Check;
  if (r.refused && tx && chain !== "ethereum") {
    token = { state: "failed", detail: `Sent on ${net}, not Ethereum, the network on the invoice.`, source: "Recorded chain data", checkedAt: at };
    amount = { state: "not_run", detail: "Amount not checked: the transfer is on another network.", checkedAt: at };
  } else if (r.refused && tx) {
    const x = tx.transfers[0];
    const genuine = x && sameAddress(x.tokenContract, official);
    token = genuine
      ? { state: "passed", detail: `Right token: ${ISSUER[t]}'s ${t} contract (${shortAddr(official)}).`, source: "Recorded chain data", checkedAt: at }
      : { state: "not_run", detail: "Token not checked: nothing reached this invoice's address.", checkedAt: at };
    const look = x && compareAddress(x.to, inv.receiving_address) === "lookalike";
    amount = { state: "failed", detail: look
      ? `Not paid to this invoice: it went to a look-alike address (${apart(x.to, inv.receiving_address).join(", not ")}).`
      : "Not paid to this invoice: nothing arrived at its address.", source: "Recorded chain data", checkedAt: at };
  } else if (flag && (flag.kind === "counterfeit" || flag.kind === "wrong_token")) {
    token = flag.kind === "counterfeit"
      ? { state: "failed", detail: `Look-alike token: it calls itself ${t} but isn't ${ISSUER[t]}'s contract.`, source: "Recorded chain data", checkedAt: at }
      : { state: "failed", detail: `Wrong token: "${flag.obs.tokenSymbol}" is not ${t}, and isn't ${ISSUER[t]}'s contract.`, source: "Recorded chain data", checkedAt: at };
    amount = { state: "not_run", detail: "Amount not counted: the token is wrong.", checkedAt: at };
  } else {
    const anyObs = v?.counted[0] ?? flag?.obs;
    token = anyObs && sameAddress(anyObs.tokenContract, official)
      ? { state: "passed", detail: `Right token: ${ISSUER[t]}'s ${t} contract (${shortAddr(official)}).`, source: "Recorded chain data", checkedAt: at }
      : { state: "not_run", detail: "Token not checked yet.", checkedAt: at };
    if (!v) amount = { state: "not_run", detail: "Amount not checked yet.", checkedAt: at };
    else if (v.review === "ambiguous") amount = { state: "not_run", detail: "Two sample invoices could be paid by this transfer: a person confirms which one before it counts.", checkedAt: at };
    else if (flag) amount = { state: "failed", detail: `Only ${formatUsdc(flag.obs.amount)} of ${amt(inv.amount)} arrived.`, source: "Recorded chain data", checkedAt: at };
    else if (v.review === "short") amount = { state: "failed", detail: `Short by ${amt(v.outstanding)}: ${amt(v.received)} of ${amt(inv.amount)} arrived.`, source: "Recorded chain data", checkedAt: at };
    else if (v.review === "over") amount = { state: "passed", detail: `Covers the invoice: ${amt(v.outstanding)} more than asked, to refund or keep as credit.`, source: "Recorded chain data", checkedAt: at };
    else if (v.state === "confirming" && v.counted.length) {
      const got = v.counted[0].amount;
      amount = got === inv.amount || formatUsdc(got) === formatUsdc(inv.amount)
        ? { state: "passed", detail: `Exactly ${amt(inv.amount)}, the invoice amount.`, source: "Recorded chain data", checkedAt: at }
        : { state: "not_run", detail: "Amount counted once it's final.", checkedAt: at };
    } else if (v.state === "matched" || v.state === "completed") amount = { state: "passed", detail: `Exactly ${amt(inv.amount)}, the invoice amount.`, source: "Recorded chain data", checkedAt: at };
    else amount = { state: "not_run", detail: "Amount not checked yet.", checkedAt: at };
  }
  return { finality, token, amount, sanctions: notRunSanctions(), freeze: notRunFreeze() };
}

export interface ReleaseCard {
  scenarioId: string;
  title: string;
  invoiceId: string;
  customerRef: string;
  invoiceAmount: string;
  network: string;
  hash: string;
  shortHash: string;
  from?: string;
  to?: string;
  checks: ReleaseChecks;
  result: ReleaseHeadline;
  label: string;
}

export function cardFor(r: Replayed): ReleaseCard {
  const checks = releaseChecks(r);
  const tx = r.facts?.tx;
  const x = tx?.transfers[0];
  return {
    scenarioId: r.scenario.id, title: r.scenario.title, invoiceId: r.invoice.id, customerRef: r.invoice.customer_ref,
    invoiceAmount: `${formatUsdc(r.invoice.amount)} ${r.invoice.token}`, network: NET[tx?.chain ?? "ethereum"] ?? String(tx?.chain),
    hash: r.scenario.transfer!.hash, shortHash: shortHash(r.scenario.transfer!.hash), from: x?.from, to: x?.to,
    checks, result: releaseHeadline(checks), label: TRANSFER_LABEL,
  };
}

export const card = async (id: string, o: { asOfConfirmations?: number } = {}) => cardFor(await replay(id, o));

// ---------- S1b: notification preview (quiet by default) ----------

export interface NotificationPreview { subject: string; slack: string; body: string[] }

/**
 * Quiet by default: a preview exists only for "Paid and final" and for a problem, never for a
 * not-final step. Preview only: this builds text; nothing here (or anywhere in the demo) sends it.
 */
export function notificationFor(c: ReleaseCard): NotificationPreview | null {
  if (c.result.tone === "not_yet") return null;
  const what = c.result.tone === "paid" ? "Paid and final" : "Problem";
  return {
    subject: `${what}: ${c.invoiceId} (${c.invoiceAmount}, ${c.customerRef})`,
    slack: `${c.result.tone === "paid" ? "Paid and final" : "Don't release yet"} · ${c.invoiceId} · ${c.invoiceAmount}\n${c.result.headline}`,
    body: [c.result.headline, ...c.result.lines, `Transfer ${c.shortHash} on ${c.network}.`, c.label],
  };
}

// ---------- the demo watcher ----------

/** The only thing the demo watcher can watch. Not an address on any network, on purpose. */
export const DEMO_WATCH_ID = "demo-replay-1";
export const DEMO_WATCH_LABEL = "Demo: replaying recorded transfers";

/** The watcher's script: recorded transfers, some replayed through their wait for blocks first. */
export const WATCH_SCRIPT: { id: string; asOfConfirmations?: number }[] = [
  { id: "SCN-01", asOfConfirmations: 1 }, { id: "SCN-01", asOfConfirmations: 7 }, { id: "SCN-01" },
  { id: "SCN-07" },
  { id: "SCN-05", asOfConfirmations: 3 }, { id: "SCN-05" },
  { id: "SCN-12" },
  { id: "SCN-16" },
];

export interface WatchStep { card: ReleaseCard; notify: NotificationPreview | null; replayedWait: boolean }

/** The watcher's timeline. Refuses anything but the demo id: it can't be pointed at a real address. */
export async function watchTimeline(target: string): Promise<WatchStep[]> {
  if (target !== DEMO_WATCH_ID) throw new Error("The demo watcher only replays recorded transfers. It can't watch a real address.");
  const out: WatchStep[] = [];
  for (const s of WATCH_SCRIPT) {
    if (!scenario(s.id)) continue;
    const c = await card(s.id, { asOfConfirmations: s.asOfConfirmations });
    out.push({ card: c, notify: notificationFor(c), replayedWait: s.asOfConfirmations !== undefined });
  }
  return out;
}
