/**
 * rc6 public cases demo: the per-case CSV. One row per typed difference (or one row for an order with none), built
 * from the engine output. Every cell that a spreadsheet could read as a formula is escaped.
 */
import { fmtFiat } from "../merchant";
import { DECISION_TEXT, LABEL, bookCurrency, caseModel, type CaseSlug } from "./view";
import { formulaSafe } from "../../csv/cell";

export const CSV_COLUMNS = ["order", "amounts", "difference", "type", "result", "rule", "owner"] as const;

/**
 * A cell that starts with = + - @, a tab or a carriage return is prefixed with ' so a spreadsheet shows it as text
 * (CSV injection). Then RFC 4180 quoting: a cell with a comma, quote or line break is quoted, quotes doubled.
 */
export function escapeCell(value: string): string {
  const safe = formulaSafe(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: readonly string[]): string => cells.map(escapeCell).join(",");

export function caseCsvRows(slug: CaseSlug): string[][] {
  const rows: string[][] = [];
  for (const b of caseModel(slug).books) {
    const cur = bookCurrency(b);
    for (const r of b.result.records) {
      const e = r.explanation;
      const amounts = `Invoice ${fmtFiat(r.ledger.invoice.amountMinor, cur)}; credited ${fmtFiat(r.ledger.creditedMinor, cur)}`;
      const result = `${e.decision} (${DECISION_TEXT[e.decision]}, step ${e.decidingStep})`;
      const owner = r.attention?.owner ?? "";
      const diffs = e.differences.length ? e.differences : [null];
      for (const d of diffs) rows.push([r.orderId, amounts, d ? fmtFiat(d.amountMinor, d.currency) : fmtFiat(0n, cur), d ? d.type : "none", result, e.ruleId, owner]);
    }
  }
  return rows;
}

/** UTF-8 with a byte-order mark (spreadsheets then read "·" correctly); CRLF line ends (RFC 4180). */
export function caseCsv(slug: CaseSlug): string {
  const m = caseModel(slug);
  const lines = [csvLine([LABEL]), csvLine([`Clearline · Case ${m.number}: ${m.title}. Every name is fictional.`]), csvLine(CSV_COLUMNS), ...caseCsvRows(slug).map(csvLine)];
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const csvFileName = (slug: CaseSlug): string => `clearline-case-${caseModel(slug).number}-${slug}-test-mode.csv`;
