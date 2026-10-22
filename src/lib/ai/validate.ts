// Spec section 6, step 6: reject AI output, and fall back to the template, if it contains a
// number, address, hash, date or token name that is not in the evidence objects, or a banned word.
// Also enforced: every sentence cites at least one real evidence ID, and the reply keeps the
// approved template's wording exactly, with only its placeholders filled.

import type { AiEvidence } from "./types";

export interface AiSentence { text: string; evidence_ids: string[] }
export interface AiOutput { paragraph: AiSentence[]; reply: string | null }

export type Verdict = { ok: true; output: AiOutput } | { ok: false; reason: string };

// Whole words and their simple inflections. "refundable" (in the approved D03 reply) is not
// "refund"; the spec's list is matched as words, not substrings.
const BANNED = /\b(guaranteed?|guarantees|definitely|refunds?|refunded|sanctions?|sanctioned|aml|fraud|frauds|fraudulent)\b/i;
const MONTHS = /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
const HEXISH = /0x[0-9a-fA-F]{6,}|\b[0-9a-fA-F]{24,}\b/g;
const TRON = /\bT[1-9A-HJ-NP-Za-km-z]{8,33}\b/g;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g;
const UPPER_WORD = /\b[A-Z][A-Z0-9]{1,9}\b/g;
const PLACEHOLDER = /\{(\w+)\}/g;

const MAX_SENTENCES = 6;

function corpusOf(code: string, evidence: AiEvidence[]): string {
  return `${code} ${JSON.stringify(evidence)}`;
}

/** Facts in `text` that the evidence doesn't contain; empty means the text is grounded. */
export function ungroundedFacts(text: string, corpus: string): string[] {
  const bad: string[] = [];
  const has = (t: string) => corpus.includes(t) || corpus.toLowerCase().includes(t.toLowerCase());
  const strip = (s: string) => s.replace(PLACEHOLDER, " ");
  const t = strip(text);
  for (const m of t.match(ISO_DATE) ?? []) if (!has(m)) bad.push(`date ${m}`);
  for (const m of t.match(HEXISH) ?? []) if (!has(m)) bad.push(`hash or address ${m}`);
  for (const m of t.match(TRON) ?? []) if (!has(m)) bad.push(`address ${m}`);
  for (const m of t.match(NUMBER) ?? []) {
    // 49,975,000 in prose is grounded by 49975000.000000 in evidence, and vice versa.
    if (!has(m) && !has(m.replace(/,/g, ""))) bad.push(`number ${m}`);
  }
  for (const m of t.match(UPPER_WORD) ?? []) if (!has(m)) bad.push(`token or code ${m}`);
  const month = MONTHS.exec(t);
  if (month && !has(month[0])) bad.push(`date wording "${month[0]}"`);
  return [...new Set(bad)];
}

/** The approved template's wording with each placeholder filled by any text. */
function templatePattern(template: string): RegExp {
  const parts = template.split(PLACEHOLDER);
  let re = "";
  parts.forEach((p, i) => { re += i % 2 === 0 ? p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "(.+?)"; });
  return new RegExp(`^${re}$`, "s");
}

export function validateAiOutput(raw: unknown, code: string, evidence: AiEvidence[], template: string | null): Verdict {
  const o = raw as Partial<AiOutput> | null;
  if (!o || !Array.isArray(o.paragraph) || !("reply" in o)) return { ok: false, reason: "Output is not the expected JSON shape." };
  if (o.paragraph.length === 0 || o.paragraph.length > MAX_SENTENCES) return { ok: false, reason: `Explanation must have 1–${MAX_SENTENCES} sentences.` };
  const ids = new Set(evidence.map((e) => e.id));
  const corpus = corpusOf(code, evidence);

  for (const [i, s] of o.paragraph.entries()) {
    if (!s || typeof s.text !== "string" || !Array.isArray(s.evidence_ids)) return { ok: false, reason: `Sentence ${i + 1} is malformed.` };
    const text = s.text.trim();
    if (!text || text.length > 400) return { ok: false, reason: `Sentence ${i + 1} is empty or too long.` };
    if (text.split(/(?<=[.!?])\s+(?=[A-Z])/).length > 1) return { ok: false, reason: `Sentence ${i + 1} holds more than one sentence.` };
    if (s.evidence_ids.length === 0) return { ok: false, reason: `Sentence ${i + 1} cites no evidence.` };
    const unknown = s.evidence_ids.filter((id) => !ids.has(id));
    if (unknown.length) return { ok: false, reason: `Sentence ${i + 1} cites evidence that doesn't exist: ${unknown.join(", ")}.` };
    if (BANNED.test(text)) return { ok: false, reason: `Sentence ${i + 1} uses a banned word ("${BANNED.exec(text)![0]}").` };
    const bad = ungroundedFacts(text, corpus);
    if (bad.length) return { ok: false, reason: `Sentence ${i + 1} states facts not in the evidence: ${bad.join(", ")}.` };
  }

  if (template === null) {
    if (o.reply !== null) return { ok: false, reason: "No approved template for this verdict, so there must be no reply." };
  } else {
    if (typeof o.reply !== "string") return { ok: false, reason: "Reply is missing." };
    if (!templatePattern(template).test(o.reply)) return { ok: false, reason: "Reply does not keep the approved template's wording." };
    if (BANNED.test(o.reply) && !BANNED.test(template)) return { ok: false, reason: `Reply uses a banned word ("${BANNED.exec(o.reply)![0]}").` };
    // Only the filled-in parts can carry new facts; the template's own wording is approved.
    const filled = o.reply.match(templatePattern(template))!.slice(1).join(" ");
    const bad = ungroundedFacts(filled, corpus);
    if (bad.length) return { ok: false, reason: `Reply states facts not in the evidence: ${bad.join(", ")}.` };
  }
  return { ok: true, output: { paragraph: o.paragraph.map((s) => ({ text: s.text.trim(), evidence_ids: s.evidence_ids })), reply: o.reply ?? null } };
}
