import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { zipEntries, type SyntheticFile } from "@/lib/clearline/synthetic";

export const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
export const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Every text the file carries: the bytes themselves, or each decompressed entry of a ZIP container (xlsx). */
export function textsOf(f: SyntheticFile): string[] {
  if (!f.name.endsWith(".xlsx")) return [text(f.bytes)];
  return zipEntries(f.bytes).filter((e) => !e.name.endsWith("/")).map((e) => {
    const raw = f.bytes.slice(e.dataOffset, e.dataOffset + e.compressedSize);
    return text(e.method === 8 ? inflateRawSync(raw) : raw);
  });
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes), for checking our own writers. */
export function parseCsv(src: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Well-formedness check for the XML we write: one root, balanced and properly nested tags, quoted attributes, legal entities. */
export function xmlWellFormed(xml: string): { ok: boolean; error?: string; root?: string } {
  let s = xml.replace(/^﻿/, "");
  if (s.startsWith("<?xml")) s = s.slice(s.indexOf("?>") + 2);
  const stack: string[] = [];
  let root: string | undefined;
  const tag = /<([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(s))) {
    if (m[2] !== undefined) {
      if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[2])) return { ok: false, error: `bad entity in text: ${m[2].slice(0, 40)}` };
      if (!stack.length && m[2].trim()) return { ok: false, error: "text outside the root element" };
      continue;
    }
    const body = m[1];
    if (body.startsWith("!--")) continue;
    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      if (stack.pop() !== name) return { ok: false, error: `mismatched </${name}>` };
      continue;
    }
    const self = body.endsWith("/");
    const inner = self ? body.slice(0, -1) : body;
    const nm = /^([A-Za-z_][\w.:-]*)/.exec(inner);
    if (!nm) return { ok: false, error: `bad tag <${body}>` };
    const attrs = inner.slice(nm[1].length).trim();
    if (attrs && !/^([A-Za-z_][\w.:-]*\s*=\s*("[^"<]*"|'[^'<]*')\s*)+$/.test(attrs)) return { ok: false, error: `bad attributes in <${body}>` };
    if (!stack.length) { if (root) return { ok: false, error: "more than one root element" }; root = nm[1]; }
    if (!self) stack.push(nm[1]);
  }
  return stack.length ? { ok: false, error: `unclosed <${stack[stack.length - 1]}>` } : { ok: true, root };
}

/** "1.234,56" / "(1.234,56)" → minor units. */
export function euroMinor(v: string): bigint {
  const neg = v.startsWith("(") && v.endsWith(")");
  const d = v.replace(/[()]/g, "").replace(/\./g, "").replace(",", "");
  return (neg ? -1n : 1n) * BigInt(d);
}
/** "1234,56" / "1234.56" (any group-less decimal with 2 places) → minor units. */
export const plainMinor = (v: string): bigint => BigInt(v.replace(/[.,]/, ""));
