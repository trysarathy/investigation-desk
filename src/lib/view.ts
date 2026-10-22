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
}

export interface CaseView {
  id: string;
  customerId: string;
  owner: string | null;
  status: SampleCase["status"];
  openedAt: string;
  verdicts: VerdictView[];
  revealed: number;
}

export function parseDown(v: string | string[] | undefined): Chain | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return (ALL_CHAINS as string[]).includes(s ?? "") ? (s as Chain) : undefined;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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
      evidenceHashes: facts.lookups.map((l) => ({ chain: l.chain, sha256: sha256(l.rawBody) })),
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

export function caseView(c: SampleCase, down?: Chain): CaseView {
  return {
    id: c.id,
    customerId: c.customerId,
    owner: c.owner ?? null,
    status: c.status,
    openedAt: c.openedAt,
    verdicts: c.snapshots.map((f) => verdictView(f, down)),
    revealed: c.revealed,
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
