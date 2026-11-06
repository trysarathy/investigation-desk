import { createHash } from "node:crypto";
import { csvCell, csvValue } from "../../csv/cell";
import { exportCsv } from "../../advances/ledger";
import { sum, sub } from "../../payments/money";
import { canonicalPayouts, fundingLedger } from "../ledger";
import { compare, instant, type Currency, type FundingData } from "../model";
export interface Accounts {
  receivable: string;
  payout_clearing: string;
  receipt_clearing: string;
  writeoff_expense: string;
}
export interface ExportSettings {
  timezone: string;
  base_currency: Currency;
  policy_confirmed: boolean;
  clearing_confirmed: boolean;
  accounts: Partial<Record<Currency, Accounts>>;
  xero?: {
    accounts: Accounts;
    no_tax_rate: string;
    mapping_confirmed: boolean;
  };
  netsuite?: {
    accounts: Accounts;
    currency_value: string;
    subsidiary: string;
    mapping_confirmed: boolean;
    date_format: "DD/MM/YYYY";
  };
}
export interface JournalLine {
  journal_id: string;
  event_id: string;
  as_of: string;
  date: string;
  currency: Currency;
  account: string;
  debit: string;
  credit: string;
  description: string;
  source: string;
}
export const journalColumns = [
  "journal_id",
  "event_id",
  "as_of",
  "date",
  "currency",
  "account",
  "debit",
  "credit",
  "description",
  "source",
];
const plainLabel = (value: unknown) =>
  typeof value === "string" &&
  !!value.trim() &&
  value.trim() === value &&
  value.length <= 200 &&
  !/[\u0000-\u001f]/.test(value) &&
  !/^[=+\-@]/.test(
    value.normalize("NFKC").replace(/^[\p{White_Space}\p{Cf}]+/u, ""),
  );
export function localDate(time: string, zone: string) {
  instant(time);
  if (typeof zone !== "string" || !zone.trim() || zone.trim() !== zone)
    throw Error("Configure an explicit IANA accounting timezone.");
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(new Date(time));
  } catch {
    throw Error(
      "Configure a supported IANA accounting timezone; no fallback is allowed.",
    );
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("day")}/${part("month")}/${part("year")}`;
}
function accountMap(accounts: Accounts | undefined) {
  if (
    !accounts ||
    [
      "receivable",
      "payout_clearing",
      "receipt_clearing",
      "writeoff_expense",
    ].some(
      (k) =>
        typeof accounts[k as keyof Accounts] !== "string" ||
        accounts[k as keyof Accounts].trim() !==
          accounts[k as keyof Accounts] ||
        !/^[A-Za-z0-9][A-Za-z0-9 .:_/-]{0,99}$/.test(
          accounts[k as keyof Accounts],
        ),
    )
  )
    throw Error("Map every account to a valid provider account code.");
  if (new Set(Object.values(accounts)).size !== 4)
    throw Error("Use distinct receivable, clearing and write-off accounts.");
  return accounts;
}
export function journals(
  data: FundingData,
  at: string,
  settings: ExportSettings,
) {
  if (
    settings.policy_confirmed !== true ||
    settings.clearing_confirmed !== true ||
    !["SGD", "USD"].includes(settings.base_currency)
  )
    throw Error(
      "A controller must confirm the policy, base currency and clearing-account treatment.",
    );
  localDate(at, settings.timezone);
  const lines: JournalLine[] = [];
  const ledger = fundingLedger(data, at);
  const append = (
    kind: string,
    id: string,
    time: string,
    currency: Currency,
    value: string,
    dr: keyof Accounts,
    cr: keyof Accounts,
    source: string,
  ) => {
    const accounts = accountMap(settings.accounts?.[currency]);
    if (compare(value, "0") <= 0) return;
    const journal_id = `CL-${createHash("sha256")
      .update(JSON.stringify([kind, id]))
      .digest("hex")
      .slice(0, 24)}`;
    const base = {
      journal_id,
      event_id: `${kind}:${id}`,
      as_of: at,
      date: localDate(time, settings.timezone),
      currency,
      description: `Clearline review: ${kind} ${id}`,
      source,
    };
    lines.push(
      { ...base, account: accounts[dr], debit: value, credit: "0" },
      { ...base, account: accounts[cr], debit: "0", credit: value },
    );
  };
  for (const p of canonicalPayouts(data, at).accepted)
    append(
      "payout",
      p.id,
      p.effective_at,
      p.currency,
      p.amount,
      "receivable",
      "payout_clearing",
      p.source,
    );
  for (const allocation of ledger.allocations) {
    const r = data.receipts.find((r) => r.id === allocation.receipt_id)!;
    append(
      "repayment",
      r.id,
      r.effective_at,
      r.currency,
      allocation.amount,
      "receipt_clearing",
      "receivable",
      r.source,
    );
  }
  for (const e of data.events.filter(
    (e) => e.action === "write_off" && instant(e.at) <= instant(at),
  )) {
    const a = data.advances.find((a) => a.id === e.advance_id)!;
    append(
      "writeoff",
      e.id,
      e.at,
      a.currency,
      e.amount!,
      "writeoff_expense",
      "receivable",
      e.id,
    );
  }
  assertBalanced(lines);
  return lines;
}
export function assertBalanced(lines: JournalLine[]) {
  for (const id of new Set(lines.map((l) => l.journal_id))) {
    const group = lines.filter((l) => l.journal_id === id);
    if (
      group.length < 2 ||
      new Set(group.map((l) => l.currency)).size !== 1 ||
      compare(
        sum(group.map((l) => l.debit)),
        sum(group.map((l) => l.credit)),
      ) !== 0 ||
      group.some(
        (l) =>
          compare(l.debit, "0") < 0 ||
          compare(l.credit, "0") < 0 ||
          (compare(l.debit, "0") > 0 && compare(l.credit, "0") > 0),
      )
    )
      throw Error(
        "Each journal must have balanced nonnegative lines in one currency.",
      );
  }
}
export const genericJournalCsv = (lines: JournalLine[]) => {
  assertBalanced(lines);
  return exportCsv(
    lines as unknown as Record<string, string>[],
    journalColumns,
  );
};
function remap(line: JournalLine, settings: ExportSettings, target: Accounts) {
  const original = accountMap(settings.accounts?.[line.currency]);
  const key = (Object.keys(original) as (keyof Accounts)[]).find(
    (k) => original[k] === line.account,
  );
  if (!key) throw Error("Journal account has no provider mapping.");
  return accountMap(target)[key];
}
export function xeroCsv(lines: JournalLine[], settings: ExportSettings) {
  assertBalanced(lines);
  const config = settings.xero;
  if (config?.mapping_confirmed !== true || !plainLabel(config.no_tax_rate))
    throw Error("Confirm Xero account mapping and the exact no-tax rate name.");
  if (
    lines.length > 300 ||
    lines.some((l) => l.currency !== settings.base_currency)
  )
    throw Error(
      "Xero manual-journal CSV supports this base currency only and at most 300 lines. Use generic CSV for controller review.",
    );
  accountMap(config.accounts);
  const headers = [
    "Narration",
    "Date",
    "Description",
    "AccountCode",
    "TaxRate",
    "Amount",
  ];
  return (
    [
      headers.map(csvCell).join(","),
      ...lines.map((l) =>
        [
          l.journal_id,
          l.date,
          l.description,
          remap(l, settings, config.accounts),
          config.no_tax_rate,
        ]
          .map(csvCell)
          .concat(csvValue(sub(l.debit, l.credit)))
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export function netsuiteCsv(lines: JournalLine[], settings: ExportSettings) {
  assertBalanced(lines);
  const config = settings.netsuite;
  if (
    config?.mapping_confirmed !== true ||
    config.date_format !== "DD/MM/YYYY" ||
    !plainLabel(config.subsidiary) ||
    !plainLabel(config.currency_value) ||
    lines.some((l) => l.currency !== settings.base_currency)
  )
    throw Error(
      "Confirm NetSuite subsidiary, base currency, DD/MM/YYYY date and account mappings. Foreign-currency journals require an FX policy outside this adapter.",
    );
  accountMap(config.accounts);
  const headers = [
    "External ID",
    "Date",
    "Currency",
    "Subsidiary",
    "Journal Entry -Line: Account",
    "Journal Entry -Line: Debit",
    "Journal Entry -Line: Credit",
    "Journal Entry -Line: Memo",
  ];
  return exportCsv(
    lines.map((l) =>
      Object.fromEntries(
        headers.map((h, i) => [
          h,
          [
            l.journal_id,
            l.date,
            config.currency_value,
            config.subsidiary,
            remap(l, settings, config.accounts),
            l.debit,
            l.credit,
            l.description,
          ][i],
        ]),
      ),
    ),
    headers,
  );
}
