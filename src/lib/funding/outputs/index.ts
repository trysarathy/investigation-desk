import { createHash } from "node:crypto";
import { exportCsv } from "../../advances/ledger";
import { compare, type FundingData } from "../model";
import { fundingLedger } from "../ledger";
import {
  genericJournalCsv,
  journals,
  netsuiteCsv,
  xeroCsv,
  type ExportSettings,
} from "./journals";
import { workbook } from "./xlsx";
export const openColumns = [
  "record_scope",
  "as_of",
  "advance_id",
  "customer_id",
  "invoice_ref",
  "account",
  "currency",
  "due_at",
  "state",
  "supplier_delivery",
  "approved_amount",
  "paid",
  "repaid",
  "written_off",
  "outstanding",
  "remaining_commitment",
  "sources",
];
const numeric = new Set([
  "approved_amount",
  "paid",
  "repaid",
  "written_off",
  "outstanding",
  "remaining_commitment",
]);
export const exceptionColumns = [
  "record_scope",
  "as_of",
  "code",
  "advance_id",
  "receipt_id",
  "amount",
  "currency",
  "reason",
  "sources",
];
export function outputTables(
  data: FundingData,
  at: string,
  simulation = false,
) {
  const ledger = fundingLedger(data, at);
  const scope = simulation ? "SYNTHETIC SAMPLE" : "PROVIDER-SUPPLIED RECORDS";
  return {
    ledger,
    open: ledger.rows
      .filter(
        (r) =>
          compare(r.outstanding, "0") > 0 ||
          compare(r.remaining_commitment, "0") > 0,
      )
      .map((r) => ({
        ...r,
        record_scope: scope,
        as_of: at,
        sources: r.sources.join(";"),
      })),
    exceptions: ledger.exceptions.map((e) => ({
      ...e,
      record_scope: scope,
      as_of: at,
      sources: e.sources.join(";"),
    })),
  };
}
const exceptionLabels: Record<string, string> = {
  overdue: "Repayment overdue",
  supplier_paid_unrepaid_by_due: "Payout recorded; repayment due",
  partial_repayment: "Partial repayment",
  unmatched_receipt: "Receipt needs review",
  over_limit: "Customer limit exceeded",
  duplicate_receipt: "Possible duplicate receipt",
  duplicate_payout: "Possible duplicate payout",
  approval_evidence_missing: "Approval evidence missing",
};
export function digest(data: FundingData, at: string, simulation = false) {
  const { ledger } = outputTables(data, at, simulation);
  const text = ledger.exceptions.length
    ? `${simulation ? "Synthetic sample — " : ""}Exceptions as of ${at}\n` +
      ledger.exceptions
        .map(
          (e) =>
            `${exceptionLabels[e.code] ?? "Needs review"}: ${e.advance_id || e.receipt_id || "customer exposure"}; ${e.amount} ${e.currency}. ${e.reason} Evidence: ${e.sources.join(";")}`,
        )
        .join("\n")
    : "All clear in the supplied records.";
  const slack = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return {
    email: text,
    slack,
    payload: {
      version: 1,
      as_of: at,
      simulation,
      status: ledger.exceptions.length ? "exceptions" : "all_clear",
      text,
      exceptions: ledger.exceptions,
    },
  };
}
export function buildOutputs(
  data: FundingData,
  at: string,
  settings: ExportSettings,
  simulation = false,
) {
  const tables = outputTables(data, at, simulation);
  const report = digest(data, at, simulation);
  const lines = journals(data, at, settings);
  const files: Record<string, string | Buffer> = {
    "open-advances.csv": exportCsv(tables.open, openColumns),
    "exceptions.csv": exportCsv(tables.exceptions, exceptionColumns),
    "journals-generic.csv": genericJournalCsv(lines),
    "digest-email.txt": report.email + "\n",
    "digest-slack.txt": report.slack + "\n",
    "digest-webhook.json": JSON.stringify(report.payload, null, 2) + "\n",
    "REVIEW-BEFORE-IMPORT.txt": `${simulation ? "SYNTHETIC SAMPLE\n" : ""}Controller review only. These are cumulative snapshots as of ${at}, not an incremental posting queue. Stable event IDs do not make repeated ERP imports safe. Compare against prior exports and book entries already present; changed allocations can require reversals. Clearing accounts must reconcile to existing bank feeds to prevent duplicate cash booking. No files are transmitted.\n`,
  };
  try {
    files["open-advances.xlsx"] = workbook(
      openColumns,
      tables.open,
      numeric,
    ).bytes;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("XLSX "))
      files["XLSX-NOT-CREATED.txt"] = e.message + "\n";
    else throw e;
  }
  for (const [name, enabled, render] of [
    ["xero", settings.xero, xeroCsv],
    ["netsuite", settings.netsuite, netsuiteCsv],
  ] as const) {
    if (!enabled) continue;
    try {
      files[`journals-${name}.csv`] = render(lines, settings);
    } catch (e) {
      files[`${name.toUpperCase()}-NOT-CREATED.txt`] =
        `${e instanceof Error ? e.message : "Adapter rejected its configuration."}\nGeneric review files were retained. No currencies were silently dropped.\n`;
    }
  }
  files["manifest.json"] =
    JSON.stringify(
      {
        version: 1,
        as_of: at,
        simulation,
        settings_sha256: createHash("sha256")
          .update(JSON.stringify(settings))
          .digest("hex"),
        files: Object.fromEntries(
          Object.entries(files).map(([name, body]) => [
            name,
            {
              sha256: createHash("sha256").update(body).digest("hex"),
              bytes: Buffer.byteLength(body),
            },
          ]),
        ),
      },
      null,
      2,
    ) + "\n";
  return files;
}
