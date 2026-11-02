// DEMO ONLY. Replays the 20 recorded real transfers (ADR 0003, tests/fixtures/real/scenarios) through
// the product's own request path, offline: the recorded chain responses are served by a strict replay
// transport (anything not in the recording throws), so no chain API is ever called from here.
// The same steps as the server's "attach a hash" action: LiveHashProvider.lookup → ingest → deriveRequest.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { HttpRequest, Transport } from "../chain/http";
import { fetchFacts } from "../chain/investigate";
import { buildFetchers } from "../chain/sources";
import { MemoryStore } from "../chain/store";
import type { Facts } from "../types";
import { checkObservation, CONFIRMATIONS, OFFICIAL, REQUEST_SETTINGS, requestAddresses } from "../requests/check";
import { createRequest, decide, deriveRequest, ingest, type RequestView } from "../requests/lifecycle";
import { LiveHashProvider } from "../requests/provider";
import { emptyRequests, type RequestsData, type RequestToken } from "../requests/types";

/** The label every demo transfer carries (ADR 0003). */
export const TRANSFER_LABEL = "Sample invoice · real public transfer, not a Clearline customer";

export interface SampleInvoice { id: string; customer_ref: string; amount: string; token: RequestToken; receiving_address: string; created_at: string; status: "open" | "paid"; sample: true }
export interface Scenario {
  id: string; case_type: string; title: string;
  transfer: { recording: string; hash: string; chain: string; to: string } | null;
  invoices: SampleInvoice[]; lookup_for: string;
  wallets?: { chain: "tron"; address: string; label: string }[];
  person_decision?: { kind: "accept_short"; note: string };
}
interface Exchange { request: { method: string; url: string; body?: string }; response: { status: number; headers: Record<string, string>; body: string } }
interface Recording { name: string; hash: string; recordedAt: string; exchanges: Exchange[] }

/** Recordings store API keys as "REDACTED" (the demo has none to send anyway). */
const redactUrl = (url: string) => { const u = new URL(url); if (u.searchParams.has("apikey")) u.searchParams.set("apikey", "REDACTED"); return u.toString(); };

const DIR = () => path.join(process.cwd(), "tests", "fixtures", "real", "scenarios");
let cached: Scenario[] | undefined;
/** The 20 scenarios that have a recorded transfer (the 21st "confirming" slot is a reported gap, not faked). */
export function scenarios(): Scenario[] {
  cached ??= (JSON.parse(readFileSync(path.join(DIR(), "catalogue.json"), "utf8")).scenarios as Scenario[]).filter((s) => s.transfer);
  return cached;
}
export const scenario = (id: string) => scenarios().find((s) => s.id === id);

const recording = (file: string): Recording => {
  if (!/^[A-Z0-9-]+\.json$/.test(file)) throw new Error("Not a demo recording.");
  return JSON.parse(readFileSync(path.join(DIR(), file), "utf8"));
};

/** Serves only what was recorded; any other request throws. This is the only transport the demo uses. */
export function replayOnly(rec: Recording): Transport {
  const q = new Map<string, Exchange[]>();
  for (const e of rec.exchanges) {
    const k = `${e.request.method} ${e.request.url} ${e.request.body ?? ""}`;
    q.set(k, [...(q.get(k) ?? []), e]);
  }
  return async (req: HttpRequest) => {
    const k = `${req.method} ${redactUrl(req.url)} ${req.body ?? ""}`;
    const list = q.get(k);
    if (!list?.length) throw new Error(`Demo replay: not in recording ${rec.name}. Nothing was fetched.`);
    const e = list.length > 1 ? list.shift()! : list[0];
    return { status: e.response.status, headers: e.response.headers, body: e.response.body };
  };
}

export interface Replayed {
  scenario: Scenario;
  invoice: SampleInvoice;
  /** The product's view of the sample invoice after the transfer, or undefined when the lookup refused it. */
  view?: RequestView;
  data: RequestsData;
  /** The chain facts the engine read from the recording. */
  facts?: Facts;
  /** The product's own message when the lookup refused the hash (e.g. another network). */
  refused?: string;
  recordedAt: string;
  /** Blocks on top of the transfer's block, as replayed. */
  confirmations?: number;
  threshold: number;
}

function invoiceBook(s: Scenario): RequestsData {
  let data: RequestsData = { ...emptyRequests(), wallets: (s.wallets ?? []).map((w) => ({ ...w, demo: false })) };
  for (const i of s.invoices) {
    data = createRequest(data, { customerRef: i.customer_ref, invoiceRef: i.id, amount: i.amount, receivingAddress: i.receiving_address, token: i.token },
      { now: i.created_at, by: "SAMPLE operator", demo: false, publicId: i.id, tokenContract: OFFICIAL[i.token], id: i.id }).data;
    if (i.status === "paid") {
      const r = data.requests[i.id];
      data.requests[i.id] = { ...r, decisions: [{ at: i.created_at, by: "SAMPLE operator", kind: "acknowledge", note: "SAMPLE: paid earlier." }] };
    }
  }
  return data;
}

/**
 * Replay one scenario. `asOfConfirmations` replays the wait: the same recorded transfer, judged as if
 * only that many blocks were on top of it (the watcher's "not final yet" steps). Omitted: as recorded.
 */
export async function replay(id: string, o: { asOfConfirmations?: number; applyDecision?: boolean } = {}): Promise<Replayed> {
  const s = scenario(id);
  if (!s?.transfer) throw new Error("Not a demo scenario.");
  const rec = recording(s.transfer.recording);
  const deps = () => buildFetchers({ tronKey: "", etherscanKey: "", store: new MemoryStore(), transport: replayOnly(rec),
    now: () => new Date(rec.recordedAt), sleep: async () => {}, noSpacing: true });
  let data = invoiceBook(s);
  const invoice = s.invoices.find((i) => i.id === s.lookup_for)!;
  const base = { scenario: s, invoice, recordedAt: rec.recordedAt, threshold: CONFIRMATIONS };
  const found = await new LiveHashProvider(deps()).lookup(s.transfer.hash, data.requests[s.lookup_for], data);
  if (!found.events.length || !found.facts?.tx) {
    const ws = { depositAddresses: requestAddresses(data, data.requests[s.lookup_for]), ledger: [], ledgerUploadedAt: rec.recordedAt, customerId: "request" };
    const facts = found.facts ?? await fetchFacts(s.transfer.hash, ws, deps(), REQUEST_SETTINGS);
    return { ...base, data, facts, refused: found.message ?? "Nothing was recorded." };
  }
  let facts = found.facts;
  let events = found.events;
  if (o.asOfConfirmations !== undefined) {
    const k = o.asOfConfirmations;
    facts = { ...facts, currentBlock: facts.tx!.blockNumber + k };
    events = events.map((e) => ({ ...e, confirmations: k }));
  }
  for (const ev of events) data = ingest(data, ev, rec.recordedAt, "Demo replay of a recorded transfer", checkObservation(rec.recordedAt, facts), CONFIRMATIONS).data;
  if (o.applyDecision && s.person_decision) {
    const res = decide(data, s.lookup_for, { kind: s.person_decision.kind, note: s.person_decision.note }, { now: rec.recordedAt, by: "SAMPLE operator", threshold: CONFIRMATIONS });
    if (!res.error) data = res.data;
  }
  const linked = Object.values(data.observations).map((x) => (x.attribution.kind === "request" ? x.attribution.requestId : undefined)).find(Boolean);
  const view = deriveRequest(data, data.requests[linked ?? s.lookup_for], CONFIRMATIONS);
  return { ...base, data, facts, view, confirmations: events[0]?.confirmations };
}

/** Which recorded scenarios a pasted hash belongs to. Only the recorded hashes are known; nothing is looked up. */
export function scenariosForHash(input: string): Scenario[] {
  const h = input.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) return [];
  return scenarios().filter((s) => s.transfer!.hash.toLowerCase().replace(/^0x/, "") === h);
}
