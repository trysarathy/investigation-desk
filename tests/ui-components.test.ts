/** v1 design-fluid: the shared UI components (src/components/ui): exact amounts, badges, hashes, tables, keys, theme. */
import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  compareDecimal, compareValues, explorerUrl, filterRows, formatDecimal, isPaletteKey, isShortcutSheetKey, isTypingTarget, matchItems,
  minorToDecimal, shortenMiddle, shouldPause, SHORTCUTS, sortRows, updatedAgo, windowRange,
} from "../src/components/ui/logic";
import { Amount } from "../src/components/ui/Amount";
import { EvidenceBadge, StatusBadge, STATUS_WORDS, EVIDENCE_WORDS } from "../src/components/ui/StatusBadge";
import { THEME_BOOT_SCRIPT, parseTheme, themeCookie } from "../src/lib/theme";

describe("amounts: the exact decimal string, never rounded", () => {
  it("formats every digit, grouping only on request", () => {
    expect(formatDecimal("1234567.891")).toBe("1234567.891");
    expect(formatDecimal("1234567.891", { group: true })).toBe("1,234,567.891");
    expect(formatDecimal("-0.000001", { group: true })).toBe("-0.000001");
    expect(formatDecimal("100.10")).toBe("100.10");
    expect(formatDecimal("12345678901234567890.123456789012345678")).toBe("12345678901234567890.123456789012345678");
    expect(formatDecimal("n/a")).toBe("n/a");
  });
  it("converts minor units exactly, as strings", () => {
    expect(minorToDecimal("123450", 2)).toBe("1234.50");
    expect(minorToDecimal("-5", 2)).toBe("-0.05");
    expect(minorToDecimal(5n, 6)).toBe("0.000005");
    expect(minorToDecimal("-0", 2)).toBe("0.00");
    expect(minorToDecimal("900719925474099312345", 6)).toBe("900719925474099.312345");
    expect(minorToDecimal("42", 0)).toBe("42");
    expect(() => minorToDecimal("1.5", 2)).toThrow();
  });
  it("<Amount> always carries the currency, right-aligned tabular figures", () => {
    const html = renderToStaticMarkup(h(Amount, { value: "1000.005", currency: "USDT", group: true }));
    expect(html).toContain("1,000.005");
    expect(html).toContain("USDT");
    expect(html).toContain('data-amount="1000.005"');
    expect(renderToStaticMarkup(h(Amount, { minor: "-1999", exponent: 2, currency: "SGD" }))).toMatch(/SGD<\/span> -19\.99/);
  });
});

describe("status and evidence badges: colour + icon + word", () => {
  it("every state has its own word and an icon", () => {
    expect(STATUS_WORDS).toMatchObject({ matched: "Matched", matched_with_difference: "Matched with difference", suggested_for_review: "Needs review", exception: "Exception", approved: "Approved", awaiting_evidence: "Awaiting evidence" });
    for (const kind of Object.keys(STATUS_WORDS) as (keyof typeof STATUS_WORDS)[]) {
      const html = renderToStaticMarkup(h(StatusBadge, { kind }));
      expect(html).toContain("<svg");
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(STATUS_WORDS[kind]);
    }
    expect(renderToStaticMarkup(h(StatusBadge, { kind: "exception", label: "Open exception" }))).toContain("Open exception");
  });
  it("evidence levels are distinct, and bank-authenticated is its own badge", () => {
    expect(new Set(Object.values(EVIDENCE_WORDS)).size).toBe(4);
    const classes = (Object.keys(EVIDENCE_WORDS) as (keyof typeof EVIDENCE_WORDS)[]).map((level) => /class="([^"]+)"/.exec(renderToStaticMarkup(h(EvidenceBadge, { level })))![1]);
    expect(new Set(classes).size).toBe(4);
  });
});

describe("hashes and explorers", () => {
  it("shortens the middle and keeps short values whole", () => {
    expect(shortenMiddle("0x1234567890abcdef1234")).toBe("0x1234…1234");
    expect(shortenMiddle("abc")).toBe("abc");
  });
  it("links only the networks the code knows, and only safe values", () => {
    expect(explorerUrl("tron", "tx", "abcdef01")).toBe("https://tronscan.org/#/transaction/abcdef01");
    expect(explorerUrl("ethereum", "tx", "0xabc")).toBe("https://etherscan.io/tx/0xabc");
    expect(explorerUrl("ethereum", "address", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe("https://etherscan.io/address/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(explorerUrl("tron", "address", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe("https://tronscan.org/#/address/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
    expect(explorerUrl("arbitrum_one", "tx", "0x1")).toBe("https://arbiscan.io/tx/0x1");
    expect(explorerUrl("solana", "tx", "abc")).toBeNull();
    expect(explorerUrl(null, "tx", "abc")).toBeNull();
    expect(explorerUrl("ethereum", "tx", "0xabc\"><script>")).toBeNull();
  });
});

describe("tables: sort, filter, window", () => {
  it("compares decimal strings exactly, numbers numerically, empty last", () => {
    expect(compareDecimal("10.5", "9.99")).toBe(1);
    expect(compareDecimal("-1.0", "-0.5")).toBe(-1);
    expect(compareDecimal("0.10", "0.1")).toBe(0);
    expect(compareDecimal("-0", "0.00")).toBe(0);
    expect(compareDecimal("90071992547409931.01", "90071992547409931.001")).toBe(1);
    expect(compareValues(2n, 10)).toBe(-1);
    expect(compareValues("BK-2", "BK-10")).toBe(-1);
    expect(compareValues(null, "a")).toBe(1);
  });
  it("sorts stably in both directions with empty values last", () => {
    const rows = [{ k: "a", v: "2.50" }, { k: "b", v: null }, { k: "c", v: "10.00" }, { k: "d", v: "2.5" }];
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.k)).toEqual(["a", "d", "c", "b"]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.k)).toEqual(["c", "a", "d", "b"]);
  });
  it("filters on every word, case-insensitive", () => {
    const rows = ["BK-24823 Exception TRON", "BK-24830 Matched Ethereum"];
    expect(filterRows(rows, (r) => r, "tron bk")).toEqual(["BK-24823 Exception TRON"]);
    expect(filterRows(rows, (r) => r, "  ")).toEqual(rows);
  });
  it("windows 10,000 rows to a few dozen, with spacers that keep the full height", () => {
    const w = windowRange(10_000, 32 * 5000, 600, 32);
    expect(w.end - w.start).toBeLessThan(60);
    expect(w.before + (w.end - w.start) * 32 + w.after).toBe(10_000 * 32);
    expect(windowRange(0, 0, 600, 32)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
    expect(windowRange(50, 0, 600, 32)).toMatchObject({ start: 0, end: 29 });
  });
});

describe("keys", () => {
  it("ignores single-key shortcuts while typing", () => {
    expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "TR" })).toBe(false);
    expect(isShortcutSheetKey({ key: "?", target: { tagName: "BODY" } })).toBe(true);
    expect(isShortcutSheetKey({ key: "?", target: { tagName: "INPUT", type: "search" } })).toBe(false);
    expect(isPaletteKey({ key: "k", metaKey: true })).toBe(true);
    expect(isPaletteKey({ key: "K", ctrlKey: true })).toBe(true);
    expect(isPaletteKey({ key: "k" })).toBe(false);
  });
  it("approve has no shortcut", () => {
    expect(SHORTCUTS.some((s) => /approv/i.test(s.does))).toBe(false);
  });
  it("palette matching keeps prefix matches first", () => {
    const items = [{ id: "1", label: "Batches", group: "Pages", href: "/b" }, { id: "2", label: "Settlement batch import", group: "Pages", href: "/x" }, { id: "3", label: "Payments", group: "Pages", href: "/p" }];
    expect(matchItems(items, "bat").map((i) => i.id)).toEqual(["1", "2"]);
    expect(matchItems(items, "").length).toBe(3);
  });
});

describe("live refresh and theme", () => {
  it("pauses while hidden, dirty, submitting or a dialog is open", () => {
    expect(shouldPause({ hidden: false, dirtyForms: 0, submitting: false })).toBe(false);
    expect(shouldPause({ hidden: true, dirtyForms: 0, submitting: false })).toBe(true);
    expect(shouldPause({ hidden: false, dirtyForms: 1, submitting: false })).toBe(true);
    expect(shouldPause({ hidden: false, dirtyForms: 0, submitting: true })).toBe(true);
    expect(shouldPause({ hidden: false, dirtyForms: 0, submitting: false, dialogOpen: true })).toBe(true);
    expect(updatedAgo(2000)).toBe("Updated just now");
    expect(updatedAgo(14_200)).toBe("Updated 14s ago");
    expect(updatedAgo(185_000)).toBe("Updated 3 min ago");
  });
  it("accepts only light or dark; the boot script follows a stored choice, then the system", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("blue")).toBeNull();
    expect(themeCookie("dark", true)).toBe("clearline_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(THEME_BOOT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_BOOT_SCRIPT).toContain("clearline.theme");
  });
});
