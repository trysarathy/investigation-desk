// Server-side view models. Verdicts are computed here, by the engine, and handed to
// client components as plain data. Nothing on the client decides a code or confidence.

import "server-only";
import { createHash } from "node:crypto";
import { nextStep, VERDICT_LABELS } from "./catalogue";
import { investigate } from "./engine/run";
import { FILE_A, SAMPLE_CASES, SAMPLE_SETTINGS, withChainDown, type SampleCase } from "./fixtures";
import { formatAge, FIXTURE_NOW } from "./format";
import { sameAddress } from "./address";
import { normaliseHash } from "./normalise";
import { configuredModel } from "./ai/anthropic";
import type { StoredCase } from "./bulk/cases";
import { explain, type Explanation } from "./ai/explain";
import type { AiOutput } from "./ai/validate";
import { fillReply } from "./templates";
import type { Chain, Code, Confidence, Evidence, Facts, RuleResult } from "./types";
import { ALL_CHAINS } from "./types";

export type Bucket = "needs_action" | "waiting" | "resolved" | "unknown";

export interface VerdictView {
  state: "verdict" | "paused";
  code: Code;
  label: string;
  confidence: Confidence | null;
  nextStep: string;
  evidence: Evidence[];
  evidenceIds: string[];
  findings: { code: Code; confidence: Confidence; label: string; reason: string; nextStep: string; evidenceIds: string[] }[];
  checks: RuleResult[];
  reply: { text: string; open: string[] } | null;
  /** The plain-English paragraph and filled reply (AI-written and checked, or template text). Case pages only. */
  explanation?: Explanation;
  checkedAt: string;
  checkingChain: string;
  pausedChains: Chain[];
  record: { ruleVersion: string; settingsVersion: string; evidenceHashes: { chain: string; sha256: string }[] };
}

export interface CaseRow {
  id: string;
  customerId: string;
  chain: Chain | null;
  token: string | null;
  amount: string | null;
  code: Code;
  label: string;
  confidence: Confidence | null;
  paused: boolean;
  age: string;
  ageMinutes: number;
  owner: string | null;
  bucket: Bucket;
  /** Cases from a bulk run open as live investigations rather than sample cases. */
  href?: string;
  live?: boolean;
}

export interface CaseView {
  id: string;
  customerId: string;
  owner: string | null;
  status: SampleCase["status"];
  openedAt: string;
  verdicts: VerdictView[];
  revealed: number;
  /** Real chain data from the live fetchers, checked against the company's files. */
  live: boolean;
  /** For live cases: what was pasted and who reported it, so the case can be re-run. */
  query?: { q: string; customer?: string; customerInferred: boolean };
  /** The demo workspace: sample company files, real chain data. */
  demo?: boolean;
}

export function parseDown(v: string | string[] | undefined): Chain | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return (ALL_CHAINS as string[]).includes(s ?? "") ? (s as Chain) : undefined;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Validated AI output, keyed by a hash of exactly what the model was sent.
const aiCache = new Map<string, AiOutput>();

/** Adds the explanation: AI text when configured and it passes validation, template text otherwise. */
async function withExplanation(view: VerdictView, facts: Facts): Promise<VerdictView> {
  const v = investigate(facts, SAMPLE_SETTINGS);
  const { model, reason } = configuredModel();
  const explanation = await explain(v.code, v.evidence, v.evidenceIds, v.fill, v.state === "paused",
    [facts.customerId ?? ""], { model, unavailableReason: reason, cache: aiCache });
  return { ...view, explanation };
}

function verdictView(f: Facts, down?: Chain): VerdictView {
  const facts = down ? withChainDown(f, down) : f;
  const v = investigate(facts, SAMPLE_SETTINGS);
  return {
    state: v.state,
    code: v.code,
    label: v.state === "paused" ? "Check paused" : VERDICT_LABELS[v.code],
    confidence: v.confidence,
    nextStep: v.state === "paused" ? "Wait for the chain API to recover. The check re-runs automatically." : nextStep(v.code, SAMPLE_SETTINGS),
    evidence: v.evidence,
    evidenceIds: v.evidenceIds,
    findings: v.findings.map((f) => ({
      code: f.code, confidence: f.confidence!, label: VERDICT_LABELS[f.code], reason: f.reason, nextStep: nextStep(f.code, SAMPLE_SETTINGS), evidenceIds: f.evidenceIds,
    })),
    checks: v.checks,
    reply: v.state === "verdict" ? fillReply(v.code, v.fill) : null,
    checkedAt: v.checkedAt,
    checkingChain: facts.tx ? facts.tx.chain : "all chains",
    pausedChains: v.pausedChains,
    record: {
      ruleVersion: v.ruleVersion,
      settingsVersion: v.settingsVersion,
      evidenceHashes: facts.rawResponses?.length
        ? facts.rawResponses.map((r) => ({ chain: r.chain, sha256: r.sha256 }))
        : facts.lookups.map((l) => ({ chain: l.chain, sha256: sha256(l.rawBody) })),
    },
  };
}

function bucketOf(c: SampleCase, v: VerdictView): Bucket {
  if (c.status === "resolved") return "resolved";
  if (v.state === "paused" || v.code === "D02" || v.code === "D10") return "waiting";
  if (v.code === "D99") return "unknown";
  return "needs_action";
}

export function caseRows(down?: Chain): CaseRow[] {
  const order: Record<Bucket, number> = { needs_action: 0, unknown: 1, waiting: 2, resolved: 3 };
  return SAMPLE_CASES.map((c) => {
    const f = c.snapshots[c.revealed - 1];
    const v = verdictView(f, down);
    const t = (down ? withChainDown(f, down) : f).tx;
    const transfer = t?.transfers.find((x) => FILE_A.some((r) => sameAddress(r.address, x.to) && r.customerId === c.customerId)) ?? t?.transfers.at(-1);
    const ageMinutes = Math.round((Date.parse(FIXTURE_NOW) - Date.parse(c.openedAt)) / 60000);
    return {
      id: c.id,
      customerId: c.customerId,
      chain: t?.chain ?? f.mempool?.chain ?? null,
      token: transfer?.tokenSymbol ?? null,
      amount: transfer?.amount ?? null,
      code: v.code,
      label: v.label,
      confidence: v.confidence,
      paused: v.state === "paused",
      age: formatAge(c.openedAt, FIXTURE_NOW),
      ageMinutes,
      owner: c.owner ?? null,
      bucket: bucketOf(c, v),
    };
  }).sort((a, b) => order[a.bucket] - order[b.bucket] || b.ageMinutes - a.ageMinutes);
}

export async function caseView(c: SampleCase, down?: Chain): Promise<CaseView> {
  const verdicts = await Promise.all(c.snapshots.map((f) => {
    const facts = down ? withChainDown(f, down) : f;
    return withExplanation(verdictView(f, down), facts);
  }));
  return {
    id: c.id,
    customerId: c.customerId,
    owner: c.owner ?? null,
    status: c.status,
    openedAt: c.openedAt,
    verdicts,
    revealed: c.revealed,
    live: false,
  };
}

/** Index for the command bar: every hash, address and customer ref that leads to a case. */
export interface SearchEntry { id: string; customerId: string; label: string; code: Code; terms: string[] }

export function searchIndex(): SearchEntry[] {
  return caseRows().map((r) => {
    const c = SAMPLE_CASES.find((x) => x.id === r.id)!;
    const f = c.snapshots[c.revealed - 1];
    const addresses = FILE_A.filter((a) => a.customerId === c.customerId).map((a) => a.address.toLowerCase());
    const terms = [c.id.toLowerCase(), c.customerId.toLowerCase(), f.input.value.toLowerCase(), ...addresses];
    if (f.tx) terms.push(normaliseHash(f.tx.hash), ...f.tx.transfers.map((t) => t.to.toLowerCase()));
    return { id: c.id, customerId: c.customerId, label: r.label, code: r.code, terms };
  });
}

/** Resolve pasted input to a sample case, if one matches. */
export function resolveInput(raw: string): SampleCase | undefined {
  const q = raw.trim().toLowerCase();
  const qHash = normaliseHash(q);
  const hit = searchIndex().find((e) => e.terms.some((t) => t === q || t === qHash));
  return hit ? SAMPLE_CASES.find((c) => c.id === hit.id) : undefined;
}

/** A case built from one live fetch. Not stored yet: cases persist once the database lands (week 5). */
export async function liveCaseView(facts: Facts, demo = false): Promise<CaseView> {
  const inferred = facts.customerInferredFromRow !== undefined;
  return {
    query: { q: facts.input.raw.trim(), customer: inferred ? undefined : facts.customerId, customerInferred: inferred },
    demo,
    id: `LIVE-${facts.input.value.replace(/^0x/, "").slice(0, 8)}`,
    customerId: facts.customerId ?? "Unknown customer",
    owner: null,
    status: "open",
    openedAt: facts.checkedAt,
    verdicts: [await withExplanation(verdictView(facts), facts)],
    revealed: 1,
    live: true,
  };
}

/** Queue rows for cases created from bulk runs ("Create cases for non-credited"). */
export function storedCaseRows(cases: StoredCase[], now: Date): CaseRow[] {
  return cases.map((c) => {
    const bucket: Bucket = c.paused ? "waiting" : c.code === "D99" || !c.code ? "unknown" : "needs_action";
    const q = new URLSearchParams({ q: c.txHash, ...(c.customerId ? { customer: c.customerId } : {}) });
    return {
      id: c.id, customerId: c.customerId ?? "—", chain: c.chain ?? null, token: c.token ?? null, amount: c.amount ?? null,
      code: c.code ?? "D99", label: c.label, confidence: c.confidence, paused: c.paused,
      age: formatAge(c.createdAt, now.toISOString()), ageMinutes: Math.round((now.getTime() - Date.parse(c.createdAt)) / 60000),
      owner: null, bucket, href: `/investigate?${q}`, live: true,
    };
  });
}
