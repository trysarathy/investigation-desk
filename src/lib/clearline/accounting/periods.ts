/**
 * Accounting Bridge (rc4) — accounting periods and the chart-of-accounts mapping.
 *
 * Periods are calendar dates in the organisation's time zone, [from, to). A closed period refuses new
 * proposals dated in it: a late item is moved to the next open period with an explicit prior-period flag.
 *
 * The mapping turns Clearline account keys ("bank:<accountRef>", supplier_payable, customer_receivable,
 * stablecoin_clearing, provider_clearing, suspense) into the customer's own account codes. A journal export
 * is refused while any key its entries use is unmapped.
 */
import { isIsoDate, safeText } from "../tx";
import type { AccountKey, AccountMapping, AccountMappingEntry, AccountRole, AccountingBridge, AccountingPeriod } from "./types";

export const NON_BANK_ROLES: readonly Exclude<AccountRole, "bank">[] = ["supplier_payable", "customer_receivable", "stablecoin_clearing", "provider_clearing", "suspense"];
export const ACCOUNT_ROLES: readonly AccountRole[] = ["bank", ...NON_BANK_ROLES];

/** The role of an account key ("bank:X" → bank), or undefined when the key is not valid. */
export function roleOfKey(key: unknown): AccountRole | undefined {
  if (typeof key !== "string") return undefined;
  if (key.startsWith("bank:")) return safeText(key.slice(5), 2, 64) ? "bank" : undefined;
  return (NON_BANK_ROLES as readonly string[]).includes(key) ? (key as AccountRole) : undefined;
}

export const ACCOUNT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,23}$/;

/** Validates a mapping's entries. Returns the problem, or undefined when valid. */
export function mappingProblem(entries: unknown): { field: string; message: string } | undefined {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 50) return { field: "entries", message: "entries must be 1–50 account mappings." };
  const keys = new Set<string>();
  const codes = new Set<string>();
  for (const [i, e] of entries.entries()) {
    const f = `entries[${i}]`;
    if (!e || typeof e !== "object") return { field: f, message: `${f} must be an object.` };
    const m = e as Partial<AccountMappingEntry>;
    if (!roleOfKey(m.accountKey)) return { field: `${f}.accountKey`, message: `${f}.accountKey must be "bank:<account ref>" or one of ${NON_BANK_ROLES.join(", ")}.` };
    if (typeof m.accountCode !== "string" || !ACCOUNT_CODE_RE.test(m.accountCode)) return { field: `${f}.accountCode`, message: `${f}.accountCode must be 1–24 letters, digits, dots or hyphens.` };
    if (!safeText(m.accountName, 2, 80)) return { field: `${f}.accountName`, message: `${f}.accountName must be 2–80 plain characters.` };
    if (keys.has(m.accountKey!)) return { field: `${f}.accountKey`, message: `${m.accountKey} is mapped twice.` };
    // Two roles on one code would net debits and credits that mean different things (e.g. bank and payable).
    if (codes.has(m.accountCode)) return { field: `${f}.accountCode`, message: `Account code ${m.accountCode} is used for two roles; each role needs its own account.` };
    keys.add(m.accountKey!);
    codes.add(m.accountCode);
  }
  return undefined;
}

/** Keys of `used` that the mapping does not map (sorted). */
export function unmappedKeys(mapping: AccountMapping | undefined, used: Iterable<AccountKey>): AccountKey[] {
  const mapped = new Set((mapping?.entries ?? []).map((e) => e.accountKey));
  return [...new Set(used)].filter((k) => !mapped.has(k)).sort();
}

/** The fictional default mapping the sample workspace starts with (the bank accounts it uses, plus every non-bank role). */
export const DEFAULT_SAMPLE_MAPPING: readonly AccountMappingEntry[] = [
  { accountKey: "bank:BANK-SGD-OPS (fictional)", accountCode: "1010", accountName: "Operating bank SGD (fictional)" },
  { accountKey: "bank:BANK-USD-OPS (fictional)", accountCode: "1020", accountName: "Operating bank USD (fictional)" },
  { accountKey: "customer_receivable", accountCode: "1200", accountName: "Advances receivable from customers (fictional)" },
  { accountKey: "provider_clearing", accountCode: "1300", accountName: "Payment provider clearing (fictional)" },
  { accountKey: "stablecoin_clearing", accountCode: "1310", accountName: "Stablecoin clearing USDC (fictional)" },
  { accountKey: "suspense", accountCode: "1999", accountName: "Suspense, unidentified items (fictional)" },
  { accountKey: "supplier_payable", accountCode: "2100", accountName: "Supplier payables (fictional)" },
];

export function periodProblem(bridge: AccountingBridge | undefined, name: unknown, from: unknown, to: unknown): { field: string; message: string; overlap?: AccountingPeriod } | undefined {
  if (!safeText(name, 2, 40)) return { field: "name", message: "name must be 2–40 plain characters." };
  if (!isIsoDate(from)) return { field: "from", message: "from must be YYYY-MM-DD." };
  if (!isIsoDate(to)) return { field: "to", message: "to must be YYYY-MM-DD." };
  if (!(from < to)) return { field: "to", message: "to must be after from (the period is [from, to))." };
  if ((bridge?.periods ?? []).some((p) => p.name === name)) return { field: "name", message: `A period named ${name} already exists.` };
  const overlap = (bridge?.periods ?? []).find((p) => from < p.to && p.from < to);
  if (overlap) return { field: "from", message: `PERIOD_OVERLAP: [${from}, ${to}) overlaps period ${overlap.name} [${overlap.from}, ${overlap.to}).`, overlap };
  return undefined;
}

export const periodContaining = (bridge: AccountingBridge | undefined, date: string): AccountingPeriod | undefined =>
  (bridge?.periods ?? []).find((p) => p.from <= date && date < p.to);

export type PeriodResolution =
  | { ok: true; periodId: string; postingDate: string; priorPeriodItem?: { originalDate: string; originalPeriodId: string; reason: string } }
  | { ok: false; reason: string };

/**
 * Where an entry dated `date` is proposed. In its own period when that is open. In a closed period it is never
 * dated there: it goes to the first day of the earliest open period after it, flagged as a prior-period item.
 */
export function resolvePeriod(bridge: AccountingBridge | undefined, date: string): PeriodResolution {
  const p = periodContaining(bridge, date);
  if (!p) return { ok: false, reason: `No accounting period covers ${date}.` };
  if (p.status === "open") return { ok: true, periodId: p.id, postingDate: date };
  const next = (bridge?.periods ?? []).filter((x) => x.status === "open" && x.from >= p.to).sort((a, b) => (a.from < b.from ? -1 : 1))[0];
  if (!next) return { ok: false, reason: `${date} is in closed period ${p.name} and no later period is open.` };
  return { ok: true, periodId: next.id, postingDate: next.from, priorPeriodItem: { originalDate: date, originalPeriodId: p.id, reason: `Dated ${date}, in closed period ${p.name}; proposed in ${next.name} on ${next.from} as a prior-period item.` } };
}
