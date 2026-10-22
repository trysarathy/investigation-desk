// Spec section 6, steps 5–6: the AI writes one plain-English paragraph and fills the reply for a
// verdict that code has already produced. It sees only the verdict code, the evidence objects
// (customer IDs removed) and the reply template. Its output is checked by validate.ts; anything
// rejected, and any outage, falls back to template text. The AI never decides a code, a
// confidence or a next step, and the product works without it.

import { createHash } from "node:crypto";
import { VERDICT_LABELS } from "../catalogue";
import { REPLY_TEMPLATES, fillReply } from "../templates";
import type { Code, Evidence } from "../types";
import type { AiEvidence, AiInput } from "./types";
import { validateAiOutput, type AiOutput } from "./validate";

export interface ExplanationSentence { text: string; evidenceIds: string[] }

export interface Explanation {
  source: "ai" | "template";
  sentences: ExplanationSentence[];
  reply: { text: string; open: string[] } | null;
  /** Why template text is shown instead of AI text, when it is. */
  fallbackReason?: string;
}

/** Anything that turns an AiInput into raw (unvalidated) JSON output. */
export interface TextModel {
  generate(input: AiInput): Promise<unknown>;
}

// Placeholders whose values come from company settings, not evidence: filled before the AI sees
// the template, so the AI can only fill what the evidence supports.
const SETTINGS_KEYS = ["where_in_app", "policy_sentence", "eta", "window", "min"] as const;

export function aiInput(code: Code, evidence: Evidence[], fill: Record<string, string>, customerIds: string[]): AiInput {
  const ids = customerIds.filter(Boolean);
  const scrub = (s: string) => ids.reduce((acc, id) => acc.split(id).join("the customer"), s);
  const safe: AiEvidence[] = evidence.map((e) => ({
    id: e.id, label: e.label, status: e.status, value: scrub(e.value),
    ...(e.detail ? { detail: scrub(e.detail) } : {}),
    ...(e.mono ? { mono: e.mono.map((m) => ({ label: m.label, value: scrub(m.value) })) } : {}),
  }));
  let template = REPLY_TEMPLATES[code] ?? null;
  if (template) for (const k of SETTINGS_KEYS) if (fill[k] !== undefined) template = template.split(`{${k}}`).join(fill[k]);
  return { code, evidence: safe, template };
}

/** Deterministic text, one sentence per cited evidence row: the fallback and the no-AI default. */
export function templateExplanation(code: Code, evidence: Evidence[], cited: string[], fill: Record<string, string>,
  paused: boolean): Explanation {
  const rows = evidence.filter((e) => cited.includes(e.id));
  const lead = paused
    ? { text: "The check is paused because a chain could not be reached, so no verdict is given.", evidenceIds: evidence.filter((e) => e.id === "ev.lookup").map((e) => e.id) }
    : { text: code === "D99" ? "No rule matched with enough confidence to give a verdict." : `${VERDICT_LABELS[code]}.`, evidenceIds: (rows.length ? rows : evidence).map((e) => e.id) };
  const sentences = [
    ...(lead.evidenceIds.length ? [lead] : []),
    ...rows.map((e) => ({ text: `${e.label}: ${e.value.replace(/\.$/, "")}.`, evidenceIds: [e.id] })),
  ];
  return { source: "template", sentences, reply: paused ? null : fillReply(code, fill) };
}

export interface ExplainOptions {
  model?: TextModel;
  /** Shown when there is no model configured. */
  unavailableReason?: string;
  cache?: Map<string, AiOutput>;
}

export async function explain(code: Code, evidence: Evidence[], cited: string[], fill: Record<string, string>,
  paused: boolean, customerIds: string[], opts: ExplainOptions): Promise<Explanation> {
  const fallback = (reason: string): Explanation => ({ ...templateExplanation(code, evidence, cited, fill, paused), fallbackReason: reason });
  if (paused) return templateExplanation(code, evidence, cited, fill, paused);
  if (!opts.model) return fallback(opts.unavailableReason ?? "AI is not configured.");

  const input = aiInput(code, evidence, fill, customerIds);
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let output = opts.cache?.get(key);
  if (!output) {
    let raw: unknown;
    try {
      raw = await opts.model.generate(input);
    } catch (e) {
      return fallback(`AI unavailable (${(e as Error).message || "request failed"}).`);
    }
    const v = validateAiOutput(raw, input.code, input.evidence, input.template);
    if (!v.ok) return fallback(`AI text rejected: ${v.reason}`);
    output = v.output;
    opts.cache?.set(key, output);
  }
  const open = output.reply ? [...output.reply.matchAll(/\{(\w+)\}/g)].map((m) => m[1]) : [];
  return {
    source: "ai",
    sentences: output.paragraph.map((s) => ({ text: s.text, evidenceIds: s.evidence_ids })),
    reply: output.reply === null ? null : { text: output.reply, open },
  };
}
