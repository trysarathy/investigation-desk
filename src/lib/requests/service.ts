// Server side of payment requests: the store on disk and every change, each made inside the
// store's lock so concurrent clicks queue instead of overwriting each other. Server-only.

import "server-only";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { liveDeps, liveLookupsEnabled } from "../chain/live";
import { dataDir } from "../data-dir";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "./check";
import { demoAdvance, demoMine, demoPublicId, demoRedeliver, demoSend, demoSendBalance, resetDemo, type ScenarioKey } from "./demo";
import { addNote, createRequest, decide, deriveRequest, ingest, setOwner, validateRequest, type DecisionInput, type NewRequestInput, type RequestView } from "./lifecycle";
import { LiveHashProvider } from "./provider";
import { FileRequestsStore } from "./store";
import type { RequestsData } from "./types";

export const requestsStore = () => new FileRequestsStore(path.join(dataDir(), "requests.json"));
const newPublicId = () => randomBytes(9).toString("base64url");
const nowIso = () => new Date().toISOString();

export async function loadRequests(): Promise<{ data: RequestsData; views: RequestView[] }> {
  const data = await requestsStore().load();
  const views = Object.values(data.requests).map((r) => deriveRequest(data, r, CONFIRMATIONS));
  return { data, views };
}

export async function createPaymentRequest(input: NewRequestInput, by: string): Promise<{ id?: string; errors?: Record<string, string> }> {
  const errors = validateRequest(input);
  if (Object.keys(errors).length) return { errors };
  return requestsStore().update((d) => {
    const { data, request } = createRequest(d, input, { now: nowIso(), by, demo: false, publicId: newPublicId(), tokenContract: OFFICIAL_USDC });
    return [data, { id: request.id }];
  });
}

export type RequestAction =
  | { kind: "decide"; decision: DecisionInput }
  | { kind: "owner"; owner: string }
  | { kind: "note"; text: string }
  | { kind: "attach_hash"; hash: string };

export async function actOnRequest(id: string, action: RequestAction, by: string): Promise<{ error?: string; message?: string }> {
  if (action.kind === "attach_hash") return attachHash(id, action.hash, by);
  return requestsStore().update((d) => {
    if (!d.requests[id]) return [undefined, { error: "No such request." }];
    const now = nowIso();
    if (action.kind === "owner") return [setOwner(d, id, action.owner, { now, by }), {}];
    if (action.kind === "note") {
      if (!action.text?.trim()) return [undefined, { error: "Write a note first." }];
      return [addNote(d, id, action.text, { now, by }), {}];
    }
    const res = decide(d, id, action.decision, { now, by, threshold: CONFIRMATIONS, check: checkObservation(now) });
    return res.error ? [undefined, { error: res.error }] : [res.data, {}];
  });
}

/** Live provider: look a real hash up read-only and feed what it finds through the same ingestion. */
async function attachHash(id: string, hash: string, by: string): Promise<{ error?: string; message?: string }> {
  if (!liveLookupsEnabled() && !process.env.OFFLINE_REPLAY_DIR) return { error: "Live chain lookups are turned off on this server (LIVE_LOOKUPS=off)." };
  const store = requestsStore();
  const snapshot = await store.load();
  const request = snapshot.requests[id];
  if (!request) return { error: "No such request." };
  const found = await new LiveHashProvider(liveDeps()).lookup(hash.trim(), request, snapshot);
  if (!found.events.length) return { error: found.message ?? "Nothing to record." };
  return store.update((d) => {
    const now = nowIso();
    let next = d;
    const outcomes: string[] = [];
    for (const ev of found.events) {
      const res = ingest(next, ev, now, `Live Ethereum lookup by ${by}`, checkObservation(now, found.facts), CONFIRMATIONS);
      next = res.data;
      outcomes.push(res.outcome);
    }
    return [next, { message: outcomes.every((o) => o === "duplicate") ? "Already recorded: nothing changed." : "Transfer recorded from a live Ethereum lookup." }];
  });
}

export type DemoAction =
  | { kind: "reset" }
  | { kind: "send"; scenario: ScenarioKey }
  | { kind: "send_balance" }
  | { kind: "mine" }
  | { kind: "advance"; blocks: number }
  | { kind: "redeliver" };

export async function demoAction(a: DemoAction): Promise<{ error?: string }> {
  return requestsStore().update((d) => {
    const now = nowIso();
    const n = Object.keys(d.observations).length + 1;
    switch (a.kind) {
      case "reset": return [resetDemo(d, now, demoPublicId), {}];
      case "send": { const r = demoSend(d, a.scenario, now, n); return r.error ? [undefined, { error: r.error }] : [r.data, {}]; }
      case "send_balance": { const r = demoSendBalance(d, now, n); return r.error ? [undefined, { error: r.error }] : [r.data, {}]; }
      case "mine": return [demoMine(d, now), {}];
      case "advance": return [demoAdvance(d, Math.max(1, Math.min(64, Math.floor(a.blocks) || 1)), now), {}];
      case "redeliver": { const r = demoRedeliver(d, now); return r.error ? [undefined, { error: r.error }] : [r.data, {}]; }
    }
  });
}
