/** rc4 Connect test helpers (fictional providers; sandbox only). */
import {
  emptyWorkspace,
  getDescriptor,
  investigate,
  providerTruth,
  providerWebhook,
  receiveConnectWebhook,
  withConnectRoutes,
  type CreateIntentInput,
  type Workspace,
} from "@/lib/clearline";
import { approved, run } from "./helpers";

export const CW = "prv_cx_cobaltwren";
export const QF = "prv_cx_quillfern";
export const SG = "prv_cx_saltglass";

const INPUT: Record<string, Partial<CreateIntentInput>> = {
  [CW]: { sourceCurrency: "SGD", destinationCurrency: "PHP", destinationCountry: "PH", amountMinor: 1_000_000 },
  [QF]: { sourceCurrency: "SGD", destinationCurrency: "USD", destinationCountry: "US", amountMinor: 2_000_000 },
  [SG]: { sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", amountMinor: 250_000_000 },
};

export const connectWs = (): Workspace => withConnectRoutes(emptyWorkspace());

/** A Connect payout submitted at the workspace clock, with the provider script chosen by `script`. */
export function submittedConnect(providerId: string, script?: string, o: Partial<CreateIntentInput> = {}, ws0: Workspace = connectWs()) {
  const a = approved({ ...INPUT[providerId], ...(script ? { metadata: { connect_script: script } } : {}), ...o }, providerId, ws0);
  const ws = run(a.ws, "usr_maya", { type: "submit_instruction", instructionId: a.instructionId }).workspace;
  const instr = ws.instructions.find((i) => i.id === a.instructionId)!;
  return { ws, id: a.id, instructionId: a.instructionId, ref: instr.providerPaymentId!, providerId };
}

export const intentOf = (ws: Workspace, id: string) => ws.intents.find((i) => i.id === id)!;
const instrOf = (ws: Workspace, id: string) => ws.instructions.find((i) => i.id === intentOf(ws, id).instructionId)!;

/** The provider's versions (after the synchronous v1) for a payout. */
export function versions(ws: Workspace, id: string) {
  const instr = instrOf(ws, id);
  return providerTruth(getDescriptor(instr.providerId)!, intentOf(ws, id), instr);
}

const maxIso = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);
export const plusMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

/** Deliver the provider's webhook for one version at `at` (default: the version's own time), through the engine action. */
export function deliver(ws: Workspace, id: string, version: number, at?: string) {
  const v = versions(ws, id).find((x) => x.version === version)!;
  const when = maxIso(at ?? v.at, ws.asOf);
  const d = providerWebhook(ws, id, version, { signAt: when });
  return run(ws, "usr_maya", { type: "ingest_webhook", delivery: { providerId: d.providerId, rawBody: d.rawBody, signatureHeader: d.signatureHeader } }, when);
}

/** Deliver through the Connect intake (verification first; unverified → poll to confirm). */
export function receive(ws: Workspace, id: string, version: number, at?: string) {
  const v = versions(ws, id).find((x) => x.version === version)!;
  const when = maxIso(at ?? v.at, ws.asOf);
  const d = providerWebhook(ws, id, version, { signAt: when });
  const r = receiveConnectWebhook(ws, { providerId: d.providerId, rawBody: d.rawBody, headers: d.headers }, { actorId: "usr_maya", at: when });
  if (!r.ok) throw new Error(`receive: ${r.error.code} ${r.error.message}`);
  return r.value;
}

export function poll(ws: Workspace, id: string, at: string, version?: number) {
  return run(ws, "usr_maya", { type: "poll_provider", intentId: id, ...(version !== undefined ? { version } : {}) }, maxIso(at, ws.asOf));
}

/** Everything that matters about a payout's outcome, independent of event ids and provenance. */
export function outcomeOf(ws: Workspace, id: string) {
  const i = intentOf(ws, id);
  return {
    status: { ...i.status },
    returnStatus: i.returnStatus ?? null,
    openExceptions: ws.exceptions
      .filter((e) => e.intentId === id && e.status !== "resolved")
      .map((e) => `${e.category}:${e.explanationCode}`)
      .sort(),
    holds: ws.holds.filter((h) => h.intentId === id).map((h) => h.status).sort(),
    chainObservations: ws.chainObservations.filter((o) => o.intentId === id).length,
  };
}

/** A contradiction is "owned" when an open exception exists and someone acts (never WA_NONE). */
export function ownedContradiction(ws: Workspace, id: string) {
  const v = investigate(ws, id);
  if (!v.ok) throw new Error("investigate failed");
  const open = v.value.exceptions.filter((e) => e.status !== "resolved");
  return { open: open.length, whoActs: v.value.whoActs.code };
}

/** Deterministic PRNG for property tests. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 2 ** 32);
}

export function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}
