/**
 * One normalised bank-statement line for every source: CSV/XLSX (after column mapping), SWIFT MT940 and ISO 20022
 * camt.053. Amounts are positive BigInt minor units; the sign lives in `direction`.
 */
import type { IngestWarning } from "../errors";

export type BankSourceFormat = "csv" | "xlsx" | "mt940" | "camt053";
export type BankDirection = "credit" | "debit";

export interface BankLine {
  /** Deterministic: format | account | value date | direction | amount | bank reference | occurrence index. */
  lineId: string;
  account: string;
  /** ISO 4217 code as stated by the statement. */
  currency: string;
  /** YYYY-MM-DD. */
  valueDate: string;
  bookingDate?: string;
  direction: BankDirection;
  /** Always positive, in the currency's minor units. */
  amountMinor: bigint;
  /** The structured reference (MT940 customer reference, camt EndToEndId), else the narrative text, else "". */
  reference: string;
  /** Free text: MT940 :86:, camt RmtInf/Ustrd. */
  narrative?: string;
  counterparty?: string;
  /** The bank's own reference (MT940 after //, camt AcctSvcrRef). */
  bankReference?: string;
  sourceFormat: BankSourceFormat;
  /** MT940: the file line of the :61: field. camt.053: the entry's position in the file (1-based). CSV/XLSX: the row. */
  sourceRow: number;
}

/** A balance as the bank states it: signed minor units (negative = debit balance). */
export interface StatedBalance { date: string; amountMinor: bigint; currency: string }

export interface BankStatement {
  sourceFormat: BankSourceFormat;
  account: string;
  currency: string;
  /** MT940 :20: / camt Stmt/Id. */
  statementId?: string;
  /** MT940 :28C: / camt ElctrncSeqNb. */
  sequence?: string;
  opening?: StatedBalance;
  closing?: StatedBalance;
  lines: BankLine[];
  /** True when opening + entries = closing; undefined when a balance is missing. */
  balanced?: boolean;
}

export interface SkippedEntry { sourceRow: number; reason: string; status?: string }

export interface BankParseResult {
  sourceFormat: BankSourceFormat;
  statements: BankStatement[];
  /** Every statement's lines, in file order. */
  lines: BankLine[];
  /** Entries that were read but are not lines (e.g. camt.053 pending entries). */
  skipped: SkippedEntry[];
  warnings: IngestWarning[];
}

/** A line before its id is assigned. */
export type BankLineDraft = Omit<BankLine, "lineId">;

/**
 * Give each line its deterministic id. Lines that agree on every id field are told apart by their occurrence index
 * in file order (0 for the first), so re-reading the same file always yields the same ids.
 */
export function assignLineIds(drafts: readonly BankLineDraft[]): BankLine[] {
  const seen = new Map<string, number>();
  return drafts.map((d) => {
    const key = [d.sourceFormat, d.account, d.valueDate, d.direction === "credit" ? "C" : "D", d.amountMinor.toString(), d.bankReference ?? ""].join("|");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { lineId: `${key}|${n}`, ...d };
  });
}

/** opening + Σ(credits) − Σ(debits) for one statement's lines. */
export function expectedClosing(openingMinor: bigint, lines: readonly Pick<BankLine, "direction" | "amountMinor">[]): bigint {
  return lines.reduce((t, l) => (l.direction === "credit" ? t + l.amountMinor : t - l.amountMinor), openingMinor);
}
