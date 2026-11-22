/**
 * Reads a reconstruction report (report.json) chosen by the user in the browser. Validation only: the report is
 * never sent anywhere, and every value is shown as text. Anything that is not a report this tool wrote is refused.
 */
import { z } from "zod";
import { POSTING_RULE_PENDING, REAL_LABEL, RECONSTRUCTION_FORMAT, SAMPLE_LABEL, type ReconstructionReport } from "./types";

/** [ASSUMPTION] a one-day report fits in 10 MiB. */
export const MAX_REPORT_BYTES = 10 * 1_048_576;

const t = (max = 4000) => z.string().max(max);
const Outcome = { result: t(40), resultText: t(80), rule: t(80), decidingStep: z.number().int().min(1).max(5) };
const Journal = z.object({
  id: t(120), kind: t(40), kindText: t(80), status: z.literal("proposed"), postingRule: z.literal(POSTING_RULE_PENDING), ruleId: t(80), entryDate: t(20).nullable(),
  requiresApprovalOf: t(120).nullable(), memo: t(),
  lines: z.array(z.object({ side: z.enum(["debit", "credit"]), account: t(120), amount: t(60), orderId: t(120).nullable(), batchId: t(120).nullable() })).max(1000),
});
const Report = z.object({
  format: z.literal(RECONSTRUCTION_FORMAT),
  label: z.enum([SAMPLE_LABEL, REAL_LABEL]),
  title: t(300), generatedAt: t(40).nullable(), inputDigest: z.string().regex(/^[0-9a-f]{64}$/),
  inputs: z.array(z.object({ file: t(200), role: t(80), bytes: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).max(50),
  provider: t(200), day: t(20).nullable(),
  entity: z.object({ id: t(80), name: t(200), currency: t(8), timeZone: t(80) }),
  policy: z.object({ band: t(200), writeOffThreshold: t(60), senderFeeBound: t(60), importedBankLinesVerify: z.literal(false) }),
  figures: z.array(z.object({ key: t(40), label: t(120), value: t(80), onceBankConfirmed: t(80).optional(), note: t(300).optional() })).max(40),
  items: z.array(z.object({
    orderId: t(120), invoice: t(60), credited: t(60), openBalance: t(60), difference: t(60), ...Outcome, ruleText: t(), owner: t(80).nullable(), reason: t().nullable(), nextStep: t().nullable(),
    differences: z.array(z.object({ id: t(120), type: t(40), typeText: t(120), amount: t(60), reason: t(), ruleId: t(80) })).max(50),
    history: z.array(z.object({ step: z.number().int(), ruleId: t(80), outcome: t(10), detail: t() })).max(100),
    onceBankConfirmed: z.object(Outcome),
  })).max(20_000),
  bridges: z.array(z.object({
    batchId: t(120), currency: t(8), merchantDay: t(20), merchantTimeZone: t(80), providerDay: t(20), providerTimeZone: t(80), bankLineId: t(120).nullable(), bankLineLabel: t(80).nullable(),
    tied: z.boolean(), settlementVerified: z.boolean(), settlementVerifiedOnceBankConfirmed: z.boolean(),
    checks: z.array(z.object({ check: t(200), ok: z.boolean() })).max(20),
    lines: z.array(z.object({ kind: t(40), label: t(300), amount: t(60), reason: t() })).max(100),
  })).max(1000),
  groupings: z.array(z.object({ id: t(200), status: t(60), providerDay: t(20), currency: t(8), total: t(200), orderIds: z.array(t(120)).max(20_000), note: t() })).max(1000),
  journals: z.array(Journal).max(50_000),
  journalsOnceBankConfirmed: z.array(Journal).max(50_000),
  unmappable: z.array(z.object({ source: t(80), field: t(200), kind: z.enum(["unmapped_column", "missing_required", "mapped_column_absent", "unknown_target", "no_mapping"]), records: z.number().int().nullable(), detail: t() })).max(5000),
  questions: z.array(z.object({ id: t(300), text: t(), because: t() })).max(5000),
  rejected: z.array(z.object({ source: t(200), row: z.number().int().nullable(), code: t(60), reason: t() })).max(50_000),
  notes: z.array(t()).max(1000),
  assumptions: z.array(t()).max(1000),
}).strict();

export type ParsedReport = { ok: true; report: ReconstructionReport } | { ok: false; error: string };

export function parseReportText(text: string): ParsedReport {
  if (text.length > MAX_REPORT_BYTES) return { ok: false, error: "The file is larger than a reconstruction report can be." };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "The file is not JSON. Choose the report.json the CLI wrote." }; }
  const r = Report.safeParse(raw);
  if (!r.success) return { ok: false, error: "The file is not a reconstruction report from this tool (report.json, format clearline.reconstruction.v1)." };
  return { ok: true, report: r.data as ReconstructionReport };
}
