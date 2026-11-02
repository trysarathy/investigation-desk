// Sender screening against a recorded snapshot of the OFAC SDN list's digital-currency addresses
// (SDN ID types "Digital Currency Address - ETH / TRX / USDT / USDC / ..."). Offline: the snapshot is
// recorded from the official source (sanctionslist.ofac.treas.gov) with its URL, fetch time, the list's
// publish date and the sha256 of the downloaded file. No snapshot is shipped yet (that host is blocked
// from the build sessions), so screening returns not_run: "Sender NOT checked."
// This is a lookup of addresses OFAC chose to publish, not KYT screening and not legal advice: see
// team/knowledge/crypto-protocol-engineer/sanctions-freeze-sources.md for what it does not cover.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EVM_CHAIN_IDS, type Chain } from "../types";
import type { SanctionsCheck } from "./release-checks";

export interface SanctionsSnapshot {
  list: "OFAC SDN";
  source: { url: string; fetchedAt: string; listPublishDate: string; sha256: string };
  entries: { idType: string; address: string; sdnUid?: string }[];
}

/** Where a recorded snapshot lives. Absent today on purpose: see the header. */
export const SNAPSHOT_FILE = path.join(process.cwd(), "src", "lib", "requests", "sanctions-snapshot", "ofac-sdn-digital-currency.json");
/** Older than this at check time, the snapshot isn't used: OFAC adds addresses without notice. */
export const MAX_SNAPSHOT_AGE_DAYS = 7;

const EVM = /^0x[0-9a-fA-F]{40}$/;
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const isEvmChain = (c: Chain) => c in EVM_CHAIN_IDS;
/** EVM: one key for every EVM chain, checksum-insensitive. Tron: base58 is case-sensitive, kept exact. */
const keyOf = (a: string) => (EVM.test(a) ? `evm:${a.toLowerCase()}` : TRON.test(a) ? `tron:${a}` : undefined);

/** A snapshot with full provenance and at least one EVM or Tron address, or undefined. Other formats (XBT, XMR...) are kept out: no chain of ours uses them. */
export function parseSanctionsSnapshot(raw: unknown): SanctionsSnapshot | undefined {
  const s = raw as SanctionsSnapshot;
  if (!s || typeof s !== "object" || s.list !== "OFAC SDN" || !s.source || !Array.isArray(s.entries)) return undefined;
  const { url, fetchedAt, listPublishDate, sha256 } = s.source;
  if (!url || !listPublishDate || !/^[0-9a-f]{64}$/.test(sha256 ?? "") || Number.isNaN(Date.parse(fetchedAt))) return undefined;
  const entries = s.entries.filter((e) => typeof e?.address === "string" && keyOf(e.address.trim()));
  return entries.length ? { ...s, entries } : undefined;
}

export function loadSanctionsSnapshot(file = SNAPSHOT_FILE): SanctionsSnapshot | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return parseSanctionsSnapshot(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
}

export function screenSender(snapshot: SanctionsSnapshot | undefined, chain: Chain, sender: string, now: string): SanctionsCheck {
  const list = "OFAC SDN" as const;
  if (!snapshot) return { state: "not_run", list, detail: "No copy of the OFAC sanctions list is loaded, so the sender wasn't checked." };
  const meta = { list, listDate: snapshot.source.listPublishDate, source: snapshot.source.url, checkedAt: now };
  const ageDays = (Date.parse(now) - Date.parse(snapshot.source.fetchedAt)) / 86_400_000;
  if (!(ageDays <= MAX_SNAPSHOT_AGE_DAYS)) {
    return { ...meta, state: "not_run", detail: `The loaded OFAC list copy is more than ${MAX_SNAPSHOT_AGE_DAYS} days old, so the sender wasn't checked.` };
  }
  const key = keyOf(sender.trim());
  if (!key || (key.startsWith("evm:") !== isEvmChain(chain))) {
    return { ...meta, state: "not_run", detail: "The sender's address couldn't be read, so it wasn't checked." };
  }
  const hit = snapshot.entries.some((e) => keyOf(e.address.trim()) === key);
  return hit
    ? { ...meta, state: "failed", detail: `Sender is on the US OFAC sanctions list (SDN, dated ${meta.listDate}). Talk to compliance before doing anything else.` }
    : { ...meta, state: "passed", detail: `Sender not among the addresses on the US OFAC SDN list dated ${meta.listDate}.` };
}
