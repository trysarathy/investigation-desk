/**
 * Header suggestions: for each Clearline field, the file's headers ranked by how well their NAME fits, with a
 * confidence (0–1) and the reason. Deterministic (ties keep the file's column order). A suggestion is never a
 * confirmation: the person confirms the mapping (`confirmed` is always false here).
 */
import { fieldsOf, type FileType } from "./catalogue";

export interface HeaderCandidate { header: string; confidence: number; why: string }
export interface FieldSuggestion { field: string; label: string; required: boolean; candidates: HeaderCandidate[] }
export interface MappingSuggestion {
  fileType: FileType;
  fields: FieldSuggestion[];
  /** One header per field, best first, never one header for two fields. A proposal for the person to confirm. */
  proposal: Record<string, { header: string }>;
  confirmed: false;
}

/** Abbreviations seen in exports → the word the catalogue uses. */
const TOKEN_SYNONYMS: Readonly<Record<string, string>> = {
  amt: "amount", amnt: "amount", ccy: "currency", cur: "currency", curr: "currency", txn: "transaction", trx: "transaction", tx: "tx",
  ref: "reference", refno: "reference", no: "id", num: "id", number: "id", nr: "id", identifier: "id", addr: "address", dt: "date",
  ts: "time", timestamp: "time", qty: "quantity", acct: "account", acc: "account", desc: "description", dest: "destination",
  fx: "fx", exp: "expires", expiry: "expires", expiration: "expires", created: "created", crt: "created", txid: "txid", recv: "received", rcvd: "received",
};
const STOP = new Set(["the", "of", "a", "an", "in", "for", "to", "at", "on", "by"]);

/** "Order No.", "orderNo", "ORDER_NO" → ["order", "id"]. */
export function headerTokens(header: string): string[] {
  const s = header.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase()
    .replace(/#/g, " id ").replace(/[^a-z0-9]+/g, " ").trim();
  return s.split(" ").filter((w) => w && !STOP.has(w)).map((w) => TOKEN_SYNONYMS[w] ?? w);
}

const bigrams = (s: string) => { const out: string[] = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
/** Sørensen–Dice similarity of character bigrams (catches typos and run-together words). */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  const x = bigrams(a), y = bigrams(b);
  if (!x.length || !y.length) return 0;
  const counts = new Map<string, number>();
  for (const g of x) counts.set(g, (counts.get(g) ?? 0) + 1);
  let both = 0;
  for (const g of y) { const n = counts.get(g) ?? 0; if (n > 0) { both++; counts.set(g, n - 1); } }
  return (2 * both) / (x.length + y.length);
}

/** Integer percent arithmetic keeps the ranking exact and platform-independent. */
function score(header: string, synonyms: readonly string[]): { pct: number; why: string } {
  const h = headerTokens(header);
  const hj = h.join(" ");
  let best = { pct: 0, why: "" };
  for (const syn of synonyms) {
    const s = headerTokens(syn);
    const sj = s.join(" ");
    let cand: { pct: number; why: string };
    if (hj === sj) cand = { pct: 100, why: `header matches "${syn}"` };
    else if (h.join("") === s.join("")) cand = { pct: 95, why: `header matches "${syn}" without spaces` };
    else {
      const shared = s.filter((w) => h.includes(w)).length;
      const overlap = Math.floor((200 * shared) / (s.length + h.length));
      const allSyn = shared === s.length;
      const fuzzy = Math.floor(dice(h.join(""), s.join("")) * 100);
      cand = allSyn && overlap >= 50
        ? { pct: Math.min(90, 50 + Math.floor(overlap / 2)), why: `header contains every word of "${syn}"` }
        : fuzzy >= overlap ? { pct: Math.floor(fuzzy * 0.8), why: `header is spelled like "${syn}"` }
          : { pct: Math.floor(overlap * 0.7), why: `header shares words with "${syn}"` };
    }
    if (cand.pct > best.pct) best = cand;
  }
  return best;
}

const MIN_PCT = 45;

export function suggestMapping(headers: readonly string[], fileType: FileType): MappingSuggestion {
  const fields = fieldsOf(fileType).map((def): FieldSuggestion => {
    const candidates = headers.map((header, i) => ({ header, i, ...score(header, def.synonyms) }))
      .filter((c) => c.pct >= MIN_PCT)
      .sort((a, b) => b.pct - a.pct || a.i - b.i)
      .slice(0, 5)
      .map((c) => ({ header: c.header, confidence: c.pct / 100, why: c.why }));
    return { field: def.key, label: def.label, required: def.required, candidates };
  });
  // Greedy proposal: the strongest (field, header) pairs first, required fields winning ties; each header once.
  const pairs = fields.flatMap((f, fi) => f.candidates.map((c) => ({ field: f.field, required: f.required, fi, ...c })))
    .sort((a, b) => b.confidence - a.confidence || Number(b.required) - Number(a.required) || a.fi - b.fi || headers.indexOf(a.header) - headers.indexOf(b.header));
  const proposal: Record<string, { header: string }> = {};
  const taken = new Set<string>();
  for (const p of pairs) {
    if (proposal[p.field] || taken.has(p.header)) continue;
    proposal[p.field] = { header: p.header };
    taken.add(p.header);
  }
  return { fileType, fields, proposal, confirmed: false };
}
