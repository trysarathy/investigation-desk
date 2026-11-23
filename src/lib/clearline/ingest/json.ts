/**
 * A small strict JSON reader that keeps every number as the exact text it was written as. JSON.parse would turn
 * 1234.5678901234567891 into a binary double and lose digits; amounts must arrive exactly.
 */
import { IngestError } from "./errors";

/** A JSON number, kept as its source text. */
export class JsonNumber {
  constructor(readonly text: string) {}
}
export type JsonValue = null | boolean | string | JsonNumber | JsonValue[] | { [key: string]: JsonValue };

const MAX_DEPTH = 64;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function parseJson(text: string): JsonValue {
  let i = 0;
  const bad = (what: string): never => {
    const before = text.slice(0, i);
    const line = before.split("\n").length;
    throw new IngestError("invalid_json", `The file is not valid JSON: ${what} on line ${line}.`, { row: line });
  };
  const ws = () => { while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++; };
  const str = (): string => {
    i++; // opening quote
    let out = "";
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') { i++; return out; }
      if (ch === "\\") {
        const e = text[i + 1];
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e in simple) { out += simple[e]; i += 2; continue; }
        if (e === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6; continue; }
        bad("an invalid escape in a string");
      }
      if (ch.charCodeAt(0) < 0x20) bad("a control character inside a string");
      out += ch;
      i++;
    }
    return bad("an unterminated string");
  };
  const value = (depth: number): JsonValue => {
    if (depth > MAX_DEPTH) bad(`nesting deeper than ${MAX_DEPTH} levels`);
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      const obj: { [key: string]: JsonValue } = Object.create(null);
      ws();
      if (text[i] === "}") { i++; return obj; }
      for (;;) {
        ws();
        if (text[i] !== '"') bad("a property name was expected");
        const key = str();
        ws();
        if (text[i] !== ":") bad('":" was expected');
        i++;
        obj[key] = value(depth + 1);
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return obj; }
        bad('"," or "}" was expected');
      }
    }
    if (ch === "[") {
      i++;
      const arr: JsonValue[] = [];
      ws();
      if (text[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return arr; }
        bad('"," or "]" was expected');
      }
    }
    if (ch === '"') return str();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) { i += m[0].length; return new JsonNumber(m[0]); }
    return bad(i >= text.length ? "the text ends too early" : `unexpected "${ch}"`);
  };
  const v = value(0);
  ws();
  if (i < text.length) bad("extra text after the JSON value");
  return v;
}
