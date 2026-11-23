/**
 * The one place in the ingest module that turns a JavaScript number into text.
 *
 * Why a float is allowed here: an .xlsx file stores numeric cells as IEEE-754 doubles — the binary value IS the cell,
 * and Excel itself has already rounded anything beyond ~15 significant digits before the file was written. There is
 * no more exact source to read. `String(n)` yields the shortest decimal that round-trips to that same double, which
 * is exactly what Excel displays for a General-format cell (e.g. 0.1 + 0.2 stored as 0.30000000000000004 stays
 * visible rather than being hidden). The text is then parsed exactly, like any other cell.
 *
 * This file is deliberately excluded from the no-float source test (tests/clearline/ingest/decimal.test.ts).
 */

export interface NumberCellText {
  text: string;
  /** Set when the double has more than 15 significant digits, so Excel may have changed the value the user typed. */
  precisionWarning?: string;
}

/** Expand "1.5e-7" or "1e+21" into plain decimal digits, by moving the point in the string. */
function expandExponent(s: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
  if (!m) return s;
  const [, sign, intDigits, fracDigits = "", expText] = m;
  const exp = parseInt(expText, 10);
  const digits = intDigits + fracDigits;
  const point = intDigits.length + exp;
  let out: string;
  if (point <= 0) out = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length) out = digits + "0".repeat(point - digits.length);
  else out = digits.slice(0, point) + "." + digits.slice(point);
  out = out.replace(/^0+(?=\d)/, "");
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return sign + out;
}

export function xlsxNumberToText(n: number): NumberCellText {
  if (!Number.isFinite(n)) return { text: String(n), precisionWarning: "The cell holds a value that is not a finite number." };
  const plain = expandExponent(String(n)); // shortest round-trip representation of the stored double
  const significant = plain.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
  return significant > 15
    ? { text: plain, precisionWarning: `The number ${plain} has more than 15 significant digits; Excel stores only about 15, so it may differ from what was typed. Export amounts as text to keep every digit.` }
    : { text: plain };
}
