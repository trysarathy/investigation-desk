// Runs one demo scenario (catalogue.json) through the product's own request path, offline:
// the recorded chain responses are replayed into LiveHashProvider.lookup, and what it returns goes
// through ingest() and deriveRequest() exactly as the server's "attach a hash" action does
// (src/lib/requests/service.ts attachHash). Nothing here decides an outcome; it only reads it.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { checkObservation, CONFIRMATIONS, OFFICIAL } from "@/lib/requests/check";
import { AUTO_RULE, createRequest, decide, deriveRequest, ingest, type RequestView } from "@/lib/requests/lifecycle";
import { LiveHashProvider } from "@/lib/requests/provider";
import { emptyRequests, type RequestsData, type RequestToken } from "@/lib/requests/types";
import { replayTransport, type Recording } from "../../live/replay";

export const DIR = __dirname;
export type Action = "auto_match" | "review" | "flag" | "wait";

export interface Invoice { id: string; customer_ref: string; amount: string; token: RequestToken; receiving_address: string; created_at: string; status: "open" | "paid"; sample: true }
export interface Scenario {
  id: string; case_type: string; title: string; transfer: { recording: string; hash: string } | null; gap?: string; known_gap?: string;
  invoices: Invoice[]; lookup_for: string; deliveries?: number; wallets?: { chain: "tron"; address: string; label: string }[];
  person_decision?: { kind: "accept_short"; note: string }; after_decision?: "completed_by_person";
  label: { expected_action: Action; true_invoice: string | null; expected_reason: string; reason_includes: string[] };
}

export const catalogue = (): { scenarios: Scenario[] } => JSON.parse(readFileSync(path.join(DIR, "catalogue.json"), "utf8"));
export const provenance = (): { recordings: { file: string; sha256: string; copied_from: string }[] } => JSON.parse(readFileSync(path.join(DIR, "provenance.json"), "utf8"));
/** sha256 of a file in this folder, or (repoRelative) of a path from the repository root. */
export const sha256Of = (file: string, repoRelative = false) =>
  createHash("sha256").update(readFileSync(repoRelative ? path.join(DIR, "..", "..", "..", "..", file) : path.join(DIR, file))).digest("hex");

/** What the product did, in the catalogue's terms, plus the words it showed. */
export interface Outcome {
  /** "rejected" = the lookup refused the hash with a message and recorded nothing. */
  action: Action | "rejected" | "none";
  /** The invoice the system auto-matched, whichever invoice in the book it is (not only `lookup_for`). */
  invoice?: string;
  /** Every invoice in the book the system linked and matched, or the auto-rule marked paid. More than one is itself wrong. */
  autoMatched: string[];
  reasons: string[];
  view?: RequestView;
  afterDecision?: RequestView;
}

/** The fictional invoice book at decision time: open invoices, and paid ones marked paid by a person. */
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

export async function runScenario(s: Scenario): Promise<Outcome> {
  const rec: Recording = JSON.parse(readFileSync(path.join(DIR, s.transfer!.recording), "utf8"));
  const deps = buildFetchers({ tronKey: "", etherscanKey: "", store: new MemoryStore(), transport: replayTransport(rec),
    now: () => new Date(rec.recordedAt), sleep: async () => {}, noSpacing: true });
  let data = invoiceBook(s);
  const found = await new LiveHashProvider(deps).lookup(s.transfer!.hash, data.requests[s.lookup_for], data);
  if (!found.events.length) return { action: "rejected", reasons: [found.message ?? ""], autoMatched: [] };
  const now = rec.recordedAt;
  for (let n = 0; n < (s.deliveries ?? 1); n++) {
    for (const ev of found.events) data = ingest(data, ev, now, "Live Ethereum lookup by SAMPLE operator", checkObservation(now, found.facts), CONFIRMATIONS).data;
  }
  const obs = Object.values(data.observations);
  // A false match can land on any invoice in the book, so every one is checked, not only the one the hash was pasted for.
  const autoMatched = Object.values(data.requests).filter((r) => {
    const v = deriveRequest(data, r, CONFIRMATIONS);
    const linked = obs.some((o) => o.attribution.kind === "request" && o.attribution.requestId === r.id && o.attribution.by === "System");
    return linked && (v.state === "matched" || v.acknowledgedBy?.by === AUTO_RULE);
  }).map((r) => r.id);
  // The invoice whose state is read: the one the system linked the transfer to, else the one it was pasted for.
  const linkedTo = obs.map((o) => (o.attribution.kind === "request" && o.attribution.by === "System" ? o.attribution.requestId : undefined)).find(Boolean);
  const view = deriveRequest(data, data.requests[linkedTo ?? s.lookup_for], CONFIRMATIONS);
  const auto = autoMatched.length > 0;
  const action: Outcome["action"] = auto ? "auto_match" : view.review === "flagged" ? "flag"
    : view.state === "needs_review" || view.review ? "review" : view.state === "confirming" || view.state === "transfer_detected" ? "wait" : "none";
  const reasons = [...view.reasons, ...obs.map((o) => o.attribution.reason)];
  let afterDecision: RequestView | undefined;
  if (s.person_decision) {
    const res = decide(data, s.lookup_for, { kind: s.person_decision.kind, note: s.person_decision.note }, { now, by: "SAMPLE operator", threshold: CONFIRMATIONS });
    if (res.error) throw new Error(`${s.id}: ${res.error}`);
    afterDecision = deriveRequest(res.data, res.data.requests[s.lookup_for], CONFIRMATIONS);
  }
  return { action, invoice: autoMatched.length === 1 ? autoMatched[0] : autoMatched.length ? autoMatched.join("+") : undefined, autoMatched, reasons, view, afterDecision };
}
