// DEMO ONLY (S1, S1b, demo watcher). Builds crypto-protocol-engineer's five release checks
// (src/lib/requests/release-checks.ts) for one replayed transfer, then the card, the quiet message
// previews and the watcher's timeline. All wording of the result comes from releaseHeadline(); this
// file only feeds the checks with recorded data. No live call: sanctions read the shipped OFAC
// snapshot (none is shipped, so "not checked"); freeze reads only a recorded FREEZE-*.json fixture.

import { readFileSync } from "node:fs";
import path from "node:path";
import { sameAddress } from "../address";
import { buildFetchers } from "../chain/sources";
import { MemoryStore } from "../chain/store";
import type { Recording } from "../demo/recordings";
import { readFinalityFromRecordings } from "../requests/finality";
import { readIssuerFreeze } from "../requests/freeze";
import { compareAddress, formatUsdc } from "../requests/lifecycle";
import { shortHash } from "../requests/present";
import { amountCheck, finalityCheck, ISSUER, releaseHeadline, tokenCheck, type CheckResult, type FinalityCheck, type FreezeCheck, type ReleaseChecks, type ReleaseHeadline } from "../requests/release-checks";
import { loadSanctionsSnapshot, screenSender } from "../requests/sanctions";
import { confirmPace, paymentStatus } from "../requests/status";
import { add } from "../payments/money";
import type { Chain } from "../types";
import { replay, replayOnly, scenario, TRANSFER_LABEL, type Replayed } from "./replay";

const NET: Record<string, string> = { ethereum: "Ethereum", tron: "Tron", bsc: "BNB Chain" };

/** Two look-alike addresses shortened far enough to show where they differ. */
export function apart(a: string, b: string): [string, string] {
  let i = 0;
  while (i < a.length && a[i].toLowerCase() === b[i]?.toLowerCase()) i++;
  const head = Math.max(6, i + 2);
  return [`${a.slice(0, head)}…${a.slice(-4)}`, `${b.slice(0, head)}…${b.slice(-4)}`];
}

/**
 * Recorded issuer-freeze reads (crypto-protocol-engineer, tests/fixtures/real/FREEZE-*.json) that cover a
 * demo transfer's own sender AND receiving address. Only these transfers get a freeze answer; the rest
 * say "not checked". `freezeFixtureCovers` re-checks that both addresses are in the recording.
 */
export const FREEZE_FIXTURE: Record<string, string> = { "ETH-01.json": "FREEZE-ETH-USDT-CLEAN.json" };
const FREEZE_DIR = () => path.join(process.cwd(), "tests", "fixtures", "real");
const word = (a: string) => a.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
export function freezeFixtureCovers(file: string, sender: string, receiver: string): boolean {
  const body = readFileSync(path.join(FREEZE_DIR(), file), "utf8").toLowerCase();
  return body.includes(word(sender)) && body.includes(word(receiver));
}

async function freezeFor(r: Replayed, sender: string, receiver: string, contract: string): Promise<FreezeCheck> {
  const issuer = ISSUER[r.invoice.token];
  const file = FREEZE_FIXTURE[r.scenario.transfer!.recording];
  if (!file || !freezeFixtureCovers(file, sender, receiver)) {
    return { state: "not_run", issuer, detail: `${issuer}'s freeze list wasn't read for this transfer, so freeze status wasn't checked.` };
  }
  const rec = JSON.parse(readFileSync(path.join(FREEZE_DIR(), file), "utf8"));
  const at = () => new Date(rec.recordedAt);
  const deps = buildFetchers({ tronKey: "", etherscanKey: "replay", store: new MemoryStore(), transport: replayOnly(rec), now: at, sleep: async () => {}, noSpacing: true });
  return readIssuerFreeze(deps, { chain: r.facts!.tx!.chain, token: r.invoice.token, contract, sender, receiver }, at);
}

/**
 * Finality from crypto-protocol-engineer's demo hook: only recordings that read the chain's own finality
 * signal count (tests/fixtures/real/FINALITY-*.json), labelled "recorded at". None of the Ethereum demo
 * recordings has one (Etherscan refused the `finalized` tag when recorded), so Ethereum stays NOT checked.
 */
const FINALITY_FIXTURE: Record<string, string> = { ethereum: "FINALITY-ETH-ETHERSCAN.json", tron: "FINALITY-TRON.json" };
async function recordedFinality(r: Replayed, chain: string, blockNumber: number | undefined, eta?: string): Promise<FinalityCheck> {
  const files = [r.scenario.transfer!.recording, FINALITY_FIXTURE[chain]].filter(Boolean);
  const recs: Recording[] = files.map((f) => JSON.parse(readFileSync(path.join(f.startsWith("FINALITY") ? FREEZE_DIR() : path.join(FREEZE_DIR(), "scenarios"), f), "utf8")));
  return readFinalityFromRecordings(recs, { chain: chain as Chain, blockNumber, eta });
}

/** The five checks for one replayed transfer. */
export async function releaseChecks(r: Replayed, o: { replayedWait?: boolean; finalizedBlock?: number } = {}): Promise<ReleaseChecks> {
  const inv = r.invoice, t = inv.token, at = r.recordedAt;
  const tx = r.facts?.tx;
  const chain = tx?.chain ?? "ethereum";
  const net = NET[chain] ?? chain;
  const invChain = inv.chain ?? "ethereum", invNet = NET[invChain] ?? invChain;
  const pace = confirmPace(chain);
  // The 6a status sentence when the product has a request view; otherwise 6a's documented pace for the network.
  const eta = r.view ? paymentStatus(r.data, r.view).sentence : pace ? `${net} usually takes ${pace}; that's a usual pace, not a promise.` : undefined;
  const src = "Recorded chain data (replayed)";
  const finality: FinalityCheck = o.replayedWait && tx
    // Replaying the wait: the transfer had only just gone into its block, so the network can't have finalized it yet.
    ? { state: "pending", blockNumber: tx.blockNumber, eta, source: src, detail: `Replayed wait: in block ${tx.blockNumber}, which the network hadn't finalized yet.` }
    : o.finalizedBlock !== undefined
      ? finalityCheck({ chain, blockNumber: tx?.blockNumber, finalizedBlock: o.finalizedBlock, source: src, checkedAt: at, eta })
      : await recordedFinality(r, chain, tx?.blockNumber, eta);

  const mine = tx?.transfers.filter((x) => sameAddress(x.to, inv.receiving_address)) ?? [];
  const x = mine[0] ?? tx?.transfers[0];
  let token: CheckResult, amount: CheckResult;
  if (!tx || !x) {
    token = { state: "not_run", detail: "The transfer couldn't be read, so the token wasn't checked." };
    amount = { state: "not_run", detail: "The transfer couldn't be read, so the amount wasn't checked." };
  } else if (chain !== invChain) {
    token = { state: "failed", detail: `Sent on ${net}, not ${invNet}, the network on the invoice.`, source: src, checkedAt: at };
    amount = { state: "not_run", detail: "Amount not checked: the transfer is on another network.", checkedAt: at };
  } else {
    token = { ...tokenCheck({ chain, token: t, contract: x.tokenContract }), checkedAt: at };
    if (token.state === "failed") {
      amount = { state: "not_run", checkedAt: at, detail: "Amount not counted: the token is wrong." };
    } else if (!mine.length) {
      amount = { state: "failed", source: src, checkedAt: at, detail: compareAddress(x.to, inv.receiving_address) === "lookalike"
        ? `Not paid to this invoice: it went to a look-alike address (${apart(x.to, inv.receiving_address).join(", not ")}).`
        : "Not paid to this invoice: nothing arrived at its address." };
    } else if (r.view?.review === "ambiguous") {
      amount = { state: "not_run", checkedAt: at, detail: "Two sample invoices could be paid by this transfer: a person confirms which one before the amount is counted." };
    } else {
      const received = mine.reduce((s, m) => add(s, m.amount), "0");
      amount = { ...amountCheck({ expected: inv.amount, received, token: t }), source: src, checkedAt: at };
    }
  }
  const sender = x?.from ?? "";
  const sanctions = screenSender(loadSanctionsSnapshot(), chain, sender, at);
  const freeze = x && chain === invChain ? await freezeFor(r, sender, x.to, x.tokenContract)
    : { state: "not_run" as const, issuer: ISSUER[t], detail: `${ISSUER[t]}'s freeze list wasn't read for this transfer, so freeze status wasn't checked.` };
  return { finality, token, amount, sanctions, freeze };
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

export async function cardFor(r: Replayed, o: { replayedWait?: boolean; finalizedBlock?: number } = {}): Promise<ReleaseCard> {
  const checks = await releaseChecks(r, o);
  const tx = r.facts?.tx;
  const x = tx?.transfers[0];
  return {
    scenarioId: r.scenario.id, title: r.scenario.title, invoiceId: r.invoice.id, customerRef: r.invoice.customer_ref,
    invoiceAmount: `${formatUsdc(r.invoice.amount)} ${r.invoice.token}`, network: NET[tx?.chain ?? "ethereum"] ?? String(tx?.chain),
    hash: r.scenario.transfer!.hash, shortHash: shortHash(r.scenario.transfer!.hash), from: x?.from, to: x?.to,
    checks, result: releaseHeadline(checks), label: TRANSFER_LABEL,
  };
}

export const card = async (id: string, o: { asOfConfirmations?: number } = {}) => cardFor(await replay(id, o), { replayedWait: o.asOfConfirmations !== undefined });

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
  { id: "TRON-01", asOfConfirmations: 2 }, { id: "TRON-01", asOfConfirmations: 12 }, { id: "TRON-01" },
  { id: "SCN-07" },
  { id: "SCN-01", asOfConfirmations: 3 }, { id: "SCN-01" },
  { id: "SCN-12" },
  { id: "SCN-14" },
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
