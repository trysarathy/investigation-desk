/**
 * v1 design-fluid: the pure logic behind the shared UI components (src/components/ui). No React, no DOM globals, so
 * every rule here is unit-tested (tests/ui-components.test.ts).
 */

// ---- Amounts: exact decimal strings, never through a float ----

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/** True for a plain decimal string such as "1234.50" or "-0.000001" (no exponent, no grouping). */
export const isDecimalString = (v: string): boolean => DECIMAL.test(v.trim());

/**
 * The exact decimal string for display: every digit kept (nothing rounded or trimmed), optionally grouped in thousands
 * ("1234567.891" → "1,234,567.891"). A value that is not a plain decimal string is returned unchanged.
 */
export function formatDecimal(value: string, opts: { group?: boolean } = {}): string {
  const m = DECIMAL.exec(value.trim());
  if (!m) return value;
  const [, sign, int, frac] = m;
  const i = opts.group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  return `${sign === "-" ? "-" : ""}${i}${frac !== undefined ? `.${frac}` : ""}`;
}

/** Minor units (an integer string or bigint) to the exact decimal string: ("-12345", 2) → "-123.45"; ("5", 6) → "0.000005". */
export function minorToDecimal(minor: string | bigint, exponent: number): string {
  const s = typeof minor === "bigint" ? minor.toString() : minor.trim();
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`Not an integer amount: ${s}`);
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 36) throw new Error(`Bad exponent: ${exponent}`);
  const neg = s.startsWith("-");
  const digits = s.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "");
  if (exponent === 0) return `${neg && digits !== "0" ? "-" : ""}${digits}`;
  const padded = digits.padStart(exponent + 1, "0");
  const out = `${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
  return neg && /[1-9]/.test(digits) ? `-${out}` : out;
}

// ---- Hashes and addresses ----

/** "0x1234567890abcdef" → "0x1234…cdef": the middle shortened, both ends kept. Short values are returned whole. */
export function shortenMiddle(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export type HashKind = "tx" | "address";

/**
 * Block explorers for the networks the code knows: the merchant networks (src/lib/clearline/merchant/config.ts
 * NETWORKS) and the investigation chains (src/lib/catalogue.ts EXPLORER_TX). Solana and TON have no explorer here yet.
 */
const EXPLORERS: Readonly<Record<string, { tx: (h: string) => string; address: (a: string) => string }>> = {
  tron: { tx: (h) => `https://tronscan.org/#/transaction/${h.replace(/^0x/i, "")}`, address: (a) => `https://tronscan.org/#/address/${a}` },
  ethereum: { tx: (h) => `https://etherscan.io/tx/0x${h.replace(/^0x/i, "")}`, address: (a) => `https://etherscan.io/address/${a}` },
  bsc: { tx: (h) => `https://bscscan.com/tx/0x${h.replace(/^0x/i, "")}`, address: (a) => `https://bscscan.com/address/${a}` },
  polygon: { tx: (h) => `https://polygonscan.com/tx/0x${h.replace(/^0x/i, "")}`, address: (a) => `https://polygonscan.com/address/${a}` },
  base: { tx: (h) => `https://basescan.org/tx/0x${h.replace(/^0x/i, "")}`, address: (a) => `https://basescan.org/address/${a}` },
  arbitrum: { tx: (h) => `https://arbiscan.io/tx/0x${h.replace(/^0x/i, "")}`, address: (a) => `https://arbiscan.io/address/${a}` },
  arbitrum_one: { tx: (h) => `https://arbiscan.io/tx/0x${h.replace(/^0x/i, "")}`, address: (a) => `https://arbiscan.io/address/${a}` },
  optimism: { tx: (h) => `https://optimistic.etherscan.io/tx/0x${h.replace(/^0x/i, "")}`, address: (a) => `https://optimistic.etherscan.io/address/${a}` },
};

const SAFE_VALUE = /^[A-Za-z0-9]+$/;

/** The explorer URL for a transaction or address on a known network, or null (unknown network or an unsafe value). */
export function explorerUrl(network: string | null | undefined, kind: HashKind, value: string): string | null {
  const e = network ? EXPLORERS[network.toLowerCase()] : undefined;
  if (!e || !SAFE_VALUE.test(value)) return null;
  return e[kind](value);
}

// ---- Keyboard ----

interface KeyTarget { tagName?: string; isContentEditable?: boolean; type?: string; getAttribute?: (n: string) => string | null }
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week", ""]);

/** True while the person is typing: a text input, textarea, select, contenteditable or a combobox. Single-key shortcuts are ignored then. */
export function isTypingTarget(t: KeyTarget | null | undefined): boolean {
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toUpperCase();
  if (t.isContentEditable === true) return true;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((t.type ?? "text").toLowerCase());
  const role = typeof t.getAttribute === "function" ? t.getAttribute("role") : null;
  return role === "combobox" || role === "textbox";
}

export interface KeyLike { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; target?: unknown }

/** ⌘K / Ctrl+K opens the command palette (a modified key, so it works from inside a field too). */
export const isPaletteKey = (e: KeyLike): boolean => !!(e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
/** "?" opens the shortcut sheet, never while typing. */
export const isShortcutSheetKey = (e: KeyLike) => e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target as KeyTarget);

/** The shortcuts, as the sheet lists them. Approve has none, on purpose: it always needs a click and a confirmation. */
export const SHORTCUTS: readonly { keys: string[]; does: string }[] = [
  { keys: ["⌘", "K"], does: "Open the command palette (Ctrl+K on Windows and Linux)" },
  { keys: ["?"], does: "Show these keyboard shortcuts" },
  { keys: ["j"], does: "Next row in a table" },
  { keys: ["k"], does: "Previous row in a table" },
  { keys: ["Enter"], does: "Open the selected row" },
  { keys: ["a"], does: "Exceptions: assign the selected or open exception (moves to its Owner control)" },
  { keys: ["e"], does: "Exceptions: add evidence to the selected or open exception" },
  { keys: ["Esc"], does: "Close a dialog" },
];

// ---- Tables: sort, filter, windowing ----

export type SortValue = string | number | bigint | null | undefined;
export type SortDir = "asc" | "desc";

/** Compares two cell values: empty last, numbers and bigints numerically, decimal strings exactly, other text naturally. */
export function compareValues(a: SortValue, b: SortValue): number {
  const empty = (v: SortValue) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  if ((typeof a === "number" || typeof a === "bigint") && (typeof b === "number" || typeof b === "bigint")) return a < b ? -1 : a > b ? 1 : 0;
  const sa = String(a), sb = String(b);
  if (isDecimalString(sa) && isDecimalString(sb)) return compareDecimal(sa, sb);
  return sa.localeCompare(sb, "en", { numeric: true, sensitivity: "base" });
}

/** Exact comparison of two decimal strings (no float). */
export function compareDecimal(a: string, b: string): number {
  const parse = (s: string) => { const m = DECIMAL.exec(s.trim())!; return { neg: m[1] === "-", int: m[2].replace(/^0+(?=\d)/, ""), frac: m[3] ?? "" }; };
  const x = parse(a), y = parse(b);
  const zero = (p: typeof x) => /^0*$/.test(p.int + p.frac);
  if (zero(x) && zero(y)) return 0;
  const xn = x.neg && !zero(x), yn = y.neg && !zero(y);
  if (xn !== yn) return xn ? -1 : 1;
  const w = Math.max(x.frac.length, y.frac.length);
  const xs = x.int + x.frac.padEnd(w, "0"), ys = y.int + y.frac.padEnd(w, "0");
  const mag = xs.length !== ys.length ? (xs.length < ys.length ? -1 : 1) : xs < ys ? -1 : xs > ys ? 1 : 0;
  return xn ? -mag : mag;
}

/** A stable sort (equal keys keep their loaded order). */
export function sortRows<T>(rows: readonly T[], value: (r: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows.map((r, i) => ({ r, i })).sort((p, q) => {
    const c = compareValues(value(p.r), value(q.r));
    // empty values stay last in both directions
    const pe = value(p.r) === null || value(p.r) === undefined || value(p.r) === "";
    const qe = value(q.r) === null || value(q.r) === undefined || value(q.r) === "";
    return (pe || qe ? c : c * sign) || p.i - q.i;
  }).map((x) => x.r);
}

/** Rows whose text contains every word of the query (case-insensitive). */
export function filterRows<T>(rows: readonly T[], text: (r: T) => string, query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((r) => { const t = text(r).toLowerCase(); return words.every((w) => t.includes(w)); });
}

/** The rows to render for a scroll position: [start, end) plus spacer heights above and below. */
export function windowRange(total: number, scrollTop: number, viewport: number, rowHeight: number, overscan = 10) {
  if (total <= 0) return { start: 0, end: 0, before: 0, after: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start: first, end: last, before: first * rowHeight, after: (total - last) * rowHeight };
}

// ---- Live refresh ----

export interface PauseState { hidden: boolean; dirtyForms: number; submitting: boolean; dialogOpen?: boolean }
/** Live refresh waits while the tab is hidden, a form has unsaved input or is submitting, or a dialog is open. */
export const shouldPause = (s: PauseState): boolean => s.hidden || s.dirtyForms > 0 || s.submitting || !!s.dialogOpen;

/** "Updated just now" / "Updated 14s ago" / "Updated 3 min ago". */
export function updatedAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  return `Updated ${Math.floor(s / 60)} min ago`;
}

// ---- Command palette ----

export interface PaletteItem { id: string; label: string; group: string; href: string; hint?: string }

/** Items whose label (or hint) contains every word of the query, labels starting with the query first. */
export function matchItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const hit = filterRows(items, (i) => `${i.label} ${i.hint ?? ""}`, q);
  return hit.map((i, n) => ({ i, n, s: i.label.toLowerCase().startsWith(q) ? 0 : 1 })).sort((a, b) => a.s - b.s || a.n - b.n).map((x) => x.i);
}

/** Escapes LIKE wildcards so a search for "50%" means the text "50%". */
export const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
