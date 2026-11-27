/**
 * rc7 phase 3b: journal proposals as DRAFT files in a ledger's own manual-journal import layout, for a sandbox /
 * demo company only. Pure. Nothing is posted: the file is for an accountant to review and import by hand into a
 * Xero demo company or a QuickBooks sandbox. Posting rules are unchanged and still pending sign-off
 * (docs/POSTING_RULES.md); every row says so.
 *
 * Layouts [ASSUMPTION: from each tool's published import template, not checked against a live import here]:
 * - Xero "Manual Journals" import: *Narration, *Date (DD/MM/YYYY), Description, *AccountCode, *TaxRate, *Amount
 *   (debit positive, credit negative), TrackingName1, TrackingOption1, TrackingName2, TrackingOption2.
 * - QuickBooks Online "Journal entries" import: Journal No, Journal Date (DD/MM/YYYY), Account, Debits, Credits,
 *   Description, Name, Currency.
 * Account columns carry Clearline's account keys / names: the accountant maps them to the chart of accounts.
 */
import { FIAT_DECIMALS } from "../merchant/config";
import { MERCHANT_ACCOUNTS } from "../merchant/journal";
import type { FiatCurrency } from "../merchant/types";
import { AMOUNT_TEXT, isFormulaLike } from "../../csv/cell";

export const DRAFT_MARKING = "DRAFT - sandbox/demo company only; posting rules pending sign-off; nothing posted";
export type DraftTool = "xero" | "quickbooks";

export interface DraftJournal {
  id: string; pattern: string; status: string; postingRuleStatus: string; entryDate: string | null; memo: string;
  lines: { side: "debit" | "credit" | string; account: string; amountMinor: string }[];
}

/** Exact minor units → plain decimal text with the currency's decimals ("596124", SGD → "5961.24"). */
export function plainAmount(minor: bigint, currency: string): string {
  const dp = FIAT_DECIMALS[currency as FiatCurrency];
  if (dp === undefined) throw new Error(`unsupported currency ${currency}`);
  const neg = minor < 0n, abs = neg ? -minor : minor, s = abs.toString().padStart(dp + 1, "0");
  return `${neg ? "-" : ""}${dp ? `${s.slice(0, -dp)}.${s.slice(-dp)}` : s}`;
}
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** One CSV cell: formula characters neutralised (a leading ' for = + - @ text), quotes doubled, line breaks removed. */
export function draftCell(v: string): string {
  let s = v.replace(/[\r\n\u2028\u2029]+/g, " ");
  if (!AMOUNT_TEXT.test(s) && isFormulaLike(s)) s = "'" + s;
  return /[",']|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: string[][]) => rows.map((r) => r.map(draftCell).join(",")).join("\r\n") + "\r\n";

/** Only proposed journals whose posting rules are pending sign-off, each balanced (debits = credits), are drafted. */
export function draftable(journals: DraftJournal[]): DraftJournal[] {
  const out = journals.filter((j) => j.status === "proposed" && j.postingRuleStatus === "pending_sign_off");
  for (const j of out) {
    const sum = j.lines.reduce((s, l) => s + (l.side === "debit" ? 1n : -1n) * BigInt(l.amountMinor), 0n);
    if (sum !== 0n) throw new Error(`journal ${j.id} does not balance`);
  }
  return out;
}

export const XERO_HEADERS = ["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount", "TrackingName1", "TrackingOption1", "TrackingName2", "TrackingOption2"];
export const QBO_HEADERS = ["Journal No", "Journal Date", "Account", "Debits", "Credits", "Description", "Name", "Currency"];

export function journalDraftCsv(tool: DraftTool, journals: DraftJournal[], currency: string, fallbackDate: string): { body: string; journals: number; lines: number } {
  const js = draftable(journals);
  const rows: string[][] = [];
  for (const [i, j] of js.entries()) {
    const date = ddmmyyyy(j.entryDate ?? fallbackDate);
    const narration = `${DRAFT_MARKING} | ${j.id} | ${j.memo}`.slice(0, 4000);
    for (const l of j.lines) {
      const name = MERCHANT_ACCOUNTS[l.account as keyof typeof MERCHANT_ACCOUNTS] ?? l.account;
      const amount = plainAmount(BigInt(l.amountMinor), currency);
      if (tool === "xero") rows.push([narration, date, `${name} (${j.pattern})`, l.account, "Tax Exempt", l.side === "debit" ? amount : plainAmount(-BigInt(l.amountMinor), currency), "", "", "", ""]);
      else rows.push([`DRAFT-${i + 1}`, date, name, l.side === "debit" ? amount : "", l.side === "credit" ? amount : "", narration, "", currency]);
    }
  }
  return { body: csv([tool === "xero" ? XERO_HEADERS : QBO_HEADERS, ...rows]), journals: js.length, lines: rows.length };
}
