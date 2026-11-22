/**
 * rc6 phase 10: the Case Reconstruction report. Plain JSON data (strings and numbers only, no BigInt), so the same
 * object is written by the local CLI and read back by the pilot screen in the browser. Nothing in a report is
 * evaluated: every value is text to display.
 */
export const RECONSTRUCTION_FORMAT = "clearline.reconstruction.v1" as const;
/** On the bundled, fictional sample only. */
export const SAMPLE_LABEL = "Test mode · illustrative data" as const;
/** On every run over real (anonymised) provider data. */
export const REAL_LABEL = "Reconstruction · anonymised provider data · not for distribution" as const;
export type ReconstructionLabel = typeof SAMPLE_LABEL | typeof REAL_LABEL;
export const POSTING_RULE_PENDING = "Posting rule pending sign-off" as const;

export interface ReportInputFile { file: string; role: string; bytes: number; sha256: string }

export interface ReportFigure { key: string; label: string; value: string; onceBankConfirmed?: string; note?: string }

export interface ReportDifference { id: string; type: string; typeText: string; amount: string; reason: string; ruleId: string }

export interface ReportOutcome { result: string; resultText: string; rule: string; decidingStep: number }

export interface ReportItem extends ReportOutcome {
  orderId: string;
  invoice: string;
  credited: string;
  openBalance: string;
  difference: string;
  differences: ReportDifference[];
  ruleText: string;
  owner: string | null;
  reason: string | null;
  nextStep: string | null;
  history: { step: number; ruleId: string; outcome: string; detail: string }[];
  /** The same item if the bank line were confirmed in the bank feed (an imported line never verifies settlement). */
  onceBankConfirmed: ReportOutcome;
}

export interface ReportBridge {
  batchId: string;
  currency: string;
  merchantDay: string;
  merchantTimeZone: string;
  providerDay: string;
  providerTimeZone: string;
  bankLineId: string | null;
  bankLineLabel: string | null;
  tied: boolean;
  settlementVerified: boolean;
  settlementVerifiedOnceBankConfirmed: boolean;
  checks: { check: string; ok: boolean }[];
  lines: { kind: string; label: string; amount: string; reason: string }[];
}

export interface ReportGrouping { id: string; status: string; providerDay: string; currency: string; total: string; orderIds: string[]; note: string }

export interface ReportJournal {
  id: string;
  kind: string;
  kindText: string;
  status: "proposed";
  postingRule: typeof POSTING_RULE_PENDING;
  ruleId: string;
  entryDate: string | null;
  requiresApprovalOf: string | null;
  memo: string;
  lines: { side: "debit" | "credit"; account: string; amount: string; orderId: string | null; batchId: string | null }[];
}

export type UnmappableKind = "unmapped_column" | "missing_required" | "mapped_column_absent" | "unknown_target" | "no_mapping";
export interface ReportUnmappable { source: string; field: string; kind: UnmappableKind; records: number | null; detail: string }

export interface ReportQuestion { id: string; text: string; because: string }

export interface ReportRejected { source: string; row: number | null; code: string; reason: string }

export interface ReconstructionReport {
  format: typeof RECONSTRUCTION_FORMAT;
  label: ReconstructionLabel;
  title: string;
  /** From --generated-at; null when not given. Output never depends on the clock. */
  generatedAt: string | null;
  /** SHA-256 over the input files' names and bytes: identical input, identical report. */
  inputDigest: string;
  inputs: ReportInputFile[];
  provider: string;
  day: string | null;
  entity: { id: string; name: string; currency: string; timeZone: string };
  policy: { band: string; writeOffThreshold: string; senderFeeBound: string; importedBankLinesVerify: false };
  figures: ReportFigure[];
  items: ReportItem[];
  bridges: ReportBridge[];
  groupings: ReportGrouping[];
  journals: ReportJournal[];
  /** Journal proposals there would be once the bank line is confirmed in the bank feed. */
  journalsOnceBankConfirmed: ReportJournal[];
  unmappable: ReportUnmappable[];
  questions: ReportQuestion[];
  rejected: ReportRejected[];
  notes: string[];
  assumptions: string[];
}
