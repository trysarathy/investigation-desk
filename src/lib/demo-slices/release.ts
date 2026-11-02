// DEMO ONLY (S1, S1b, demo watcher). Builds crypto-protocol-engineer's five release checks
// (src/lib/requests/release-checks.ts) for one replayed transfer, then the card, the quiet message
// previews and the watcher's timeline. All wording of the result comes from releaseHeadline(); this
// file only feeds the checks with recorded data. No live call: sanctions read the shipped OFAC
// snapshot (none is shipped, so "not checked"); freeze reads only a recorded FREEZE-*.json fixture.

import { sameAddress } from "../address";
import { buildFetchers } from "../chain/sources";
import { MemoryStore } from "../chain/store";
import type { Recording } from "../demo/recordings";
import { readFinalityFromRecordings } from "../requests/finality";
import { readIssuerFreeze, type FreezeQuery } from "../requests/freeze";
import { formatUsdc } from "../requests/lifecycle";
import { shortHash } from "../requests/present";
import { amountCheck, finalityCheck, ISSUER, networkCheck, receivingAddressCheck, releaseHeadline, tokenCheck, type CheckResult, type FinalityCheck, type FreezeCheck, type ReleaseChecks, type ReleaseHeadline } from "../requests/release-checks";
import { loadSanctionsSnapshot, screenSender } from "../requests/sanctions";
import { confirmPace } from "../requests/status";
import { add } from "../payments/money";
import type { Chain } from "../types";
import { FREEZE_INDEX, recording as bundled } from "./fixtures";
import { humanTimes, ranSummary } from "./present";
import { replay, replayOnly, scenario, TRANSFER_LABEL, type Replayed } from "./replay";

const NET: Record<string, string> = { ethereum: "Ethereum", tron: "Tron", bsc: "BNB Chain" };

const load = (file: string): Recording => bundled(file);

/**
 * Recorded issuer-freeze reads for the demo transfers (crypto-protocol-engineer,
 * tests/fixtures/real/freeze-demo-index.json). A row is used only when its query is this transfer's own
 * sender and receiver; transfers with no row (FAKE-06, FAKE-HG, BSC-01) stay "not checked".
 */
interface FreezeRow { recording: string; fixture?: string; query?: FreezeQuery }
let freezeIndex: FreezeRow[] | undefined;
export const freezeRowFor = (recording: string): FreezeRow | undefined =>
  (freezeIndex ??= FREEZE_INDEX.rows as FreezeRow[]).find((r) => r.recording === recording);

async function freezeFor(r: Replayed, sender: string, receiver: string): Promise<FreezeCheck> {
  const issuer = ISSUER[r.invoice.token];
  const row = freezeRowFor(r.scenario.transfer!.recording);
  if (!row?.fixture || !row.query || !sameAddress(row.query.sender, sender) || !sameAddress(row.query.receiver, receiver)) {
    return { state: "not_run", issuer, detail: `${issuer}'s freeze list wasn't read for this transfer, so freeze status wasn't checked.` };
  }
  const rec = load(row.fixture);
  const at = () => new Date(rec.recordedAt);
  const deps = buildFetchers({ tronKey: "", etherscanKey: "replay", store: new MemoryStore(), transport: replayOnly(rec as never), now: at, sleep: async () => {}, noSpacing: true });
  return readIssuerFreeze(deps, row.query, at);
}

/** Finality from crypto-protocol-engineer's demo hook: only a recording that read the chain's own finality signal for this hash counts. */
const FINALITY_FIXTURE: Record<string, string> = { ethereum: "FINALITY-ETH-ETHERSCAN.json", tron: "FINALITY-TRON.json" };
async function recordedFinality(r: Replayed, chain: string, hash: string, blockNumber: number | undefined): Promise<FinalityCheck> {
  const recs = [load(r.scenario.transfer!.recording), ...(FINALITY_FIXTURE[chain] ? [load(FINALITY_FIXTURE[chain])] : [])];
  return readFinalityFromRecordings(recs, { chain: chain as Chain, hash, blockNumber });
}

/** The release checks for one replayed transfer: crypto-protocol-engineer's builders, fed with recorded data only. */
export async function releaseChecks(r: Replayed, o: { replayedWait?: boolean; finalizedBlock?: number } = {}): Promise<ReleaseChecks> {
  const inv = r.invoice, t = inv.token, at = r.recordedAt;
  const tx = r.facts?.tx;
  const chain = (tx?.chain ?? "ethereum") as Chain;
  const invChain = (inv.chain ?? "ethereum") as Chain;
  const src = "Recorded chain data (replayed)";
  const finality: FinalityCheck = o.replayedWait && tx
    // Replaying the wait: the transfer had only just gone into its block, so the network can't have finalized it yet.
    ? { state: "pending", blockNumber: tx.blockNumber, source: src, detail: `Not final yet${confirmPace(chain) ? ` — usually ${confirmPace(chain)} more` : ""} (this wait is replayed faster than real time).`, technical: `In block ${tx.blockNumber}; replayed wait.` }
    : o.finalizedBlock !== undefined
      ? finalityCheck({ chain, blockNumber: tx?.blockNumber, finalizedBlock: o.finalizedBlock, source: src, checkedAt: at })
      : await recordedFinality(r, chain, r.scenario.transfer!.hash, tx?.blockNumber);

  const mine = tx?.transfers.filter((x) => sameAddress(x.to, inv.receiving_address)) ?? [];
  const x = mine[0] ?? tx?.transfers[0];
  if (!tx || !x) {
    const no = (what: string): CheckResult => ({ state: "not_run", detail: `The transfer couldn't be read, so the ${what} wasn't checked.` });
    return { finality, token: no("token"), amount: no("amount"), sanctions: sanctionsFor(chain, "", at), freeze: { state: "not_run", issuer: ISSUER[t], detail: no("freeze status").detail } };
  }
  const network = { ...networkCheck({ paidOn: chain, invoiceOn: invChain }), checkedAt: at };
  // Only compare addresses on the invoice's own network (an address on another network is never "the invoice's").
  const address = network.state === "passed" ? { ...receivingAddressCheck({ paidTo: x.to, invoiceAddress: inv.receiving_address }), checkedAt: at } : undefined;
  const token = { ...tokenCheck({ chain, token: t, contract: x.tokenContract }), checkedAt: at };
  let amount: CheckResult;
  if (token.state === "failed") amount = { state: "not_run", checkedAt: at, detail: "Amount not counted: the token is wrong." };
  else if (network.state === "failed") amount = { state: "not_run", checkedAt: at, detail: "Amount not counted: the transfer is on another network." };
  else if (address?.state === "failed") amount = { state: "not_run", checkedAt: at, detail: "Amount not counted: nothing arrived at this invoice's address." };
  else if (r.view?.review === "ambiguous") amount = { state: "not_run", checkedAt: at, detail: "Two sample invoices could be paid by this transfer: a person confirms which one before the amount is counted." };
  else amount = { ...amountCheck({ expected: inv.amount, received: mine.reduce((sum, m) => add(sum, m.amount), "0"), token: t }), source: src, checkedAt: at };
  const freeze = await freezeFor(r, x.from, x.to);
  return { finality, network, ...(address ? { address } : {}), token, amount, sanctions: sanctionsFor(chain, x.from, at), freeze };
}

function sanctionsFor(chain: Chain, sender: string, at: string) {
  const snapshot = loadSanctionsSnapshot();
  const screened = screenSender(snapshot, chain, sender, at);
  return snapshot ? screened : { ...screened, detail: "No copy of the US OFAC SDN list is loaded, so the sender wasn't checked. Other lists are not checked." };
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
  /** The network the invoice asks for (the transfer's is `network`). */
  invoiceNetwork: string;
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
    checks, result: humanResult(releaseHeadline(checks)), label: TRANSFER_LABEL, invoiceNetwork: NET[r.invoice.chain ?? "ethereum"],
  };
}

const humanResult = (h: ReleaseHeadline): ReleaseHeadline => ({ ...h, headline: humanTimes(h.headline), lines: h.lines.map(humanTimes) });

export const card = async (id: string, o: { asOfConfirmations?: number } = {}) => cardFor(await replay(id, o), { replayedWait: o.asOfConfirmations !== undefined });

// ---------- S1b: notification preview (quiet by default) ----------

export interface NotificationPreview { subject: string; slack: string; body: string[] }

/**
 * Quiet by default: a preview exists only for "Paid and final" and for a problem, never for a
 * not-final step. Preview only: this builds text; nothing here (or anywhere in the demo) sends it.
 */
export function notificationFor(c: ReleaseCard): NotificationPreview | null {
  if (c.result.tone === "not_yet") return null;
  // Same words as the card: "Don't release" for a problem ("yet" is only ever for not final, which is quiet).
  const what = c.result.tone === "paid" ? "Paid and final" : "Don't release";
  const summary = ranSummary(c.checks, c.result.tone);
  return {
    subject: `${what}: ${c.invoiceId} (${c.invoiceAmount}, ${c.customerRef})`,
    slack: `${what} · ${c.invoiceId} · ${c.invoiceAmount}\n${c.result.headline}\n${summary}`,
    body: [c.result.headline, summary, ...c.result.lines, `Transfer ${c.shortHash} on ${c.network}.`],
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
