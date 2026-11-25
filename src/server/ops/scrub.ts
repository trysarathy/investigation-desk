/**
 * v1 phase 5.4: the PII scrubber every log line and error report passes through (src/server/ops/log.ts,
 * src/server/ops/errors.ts). Pure: no I/O, no clock. Logs should already carry ids, codes and counts only; this is the
 * second line of defence for the day someone logs more than they meant to.
 *
 * What it removes:
 * - wallet addresses of every supported network (src/lib/clearline/merchant/types.ts NetworkId): EVM (Ethereum, Polygon,
 *   Arbitrum One, Base: 0x + 40 hex), Tron (base58check T… and the 41-prefixed hex form), Solana (base58, 32–44
 *   characters), TON (user-friendly EQ…/UQ…/kQ…/0Q… 48 characters, and the raw 0:<64 hex> / -1:<64 hex> form);
 *   0x-prefixed 64-hex transaction hashes too (they lead straight to the addresses). A bare 64-hex string is kept: it is
 *   how the app logs its own sha256 checksums.
 * - e-mail addresses, IPv4 and IPv6 addresses, bearer tokens, JWTs, `key=value` secrets in query strings and headers
 * - by field name: customer references, names, addresses, bank details, secrets, cookies, file contents and request
 *   bodies (see SENSITIVE_KEYS / CONTENT_KEYS); a Buffer or typed array is replaced by its length
 * - any string longer than MAX_STRING (a file's content, a pasted statement) is replaced by its length
 *
 * Replacements are fixed tokens ("[address]", "[email]", …) so a log stays readable and greppable.
 */

import { isIPv6 } from "node:net";

export const MAX_STRING = 512;
const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ITEMS = 50;

/** Field names whose value is personal or secret, whatever it looks like (compared lower-case, without _ and -). */
const SENSITIVE_KEYS = new Set([
  "email", "emailaddress", "to", "from", "cc", "bcc", "recipient", "sender", "name", "fullname", "firstname", "lastname",
  "displayname", "payername", "payeename", "customername", "customer", "customerref", "customerreference", "reference",
  "ref", "memo", "narrative", "description", "note", "notes", "comment", "address", "walletaddress", "fromaddress",
  "toaddress", "counterparty", "iban", "accountnumber", "bankaccount", "bic", "swift", "sortcode", "routingnumber",
  "phone", "phonenumber", "ip", "ipaddress", "clientip", "remoteaddress", "xforwardedfor", "useragent",
  "password", "passwd", "secret", "token", "accesstoken", "refreshtoken", "idtoken", "apikey", "key", "privatekey",
  "authorization", "cookie", "setcookie", "session", "sessiontoken", "otp", "totp", "recoverycode", "backupcode",
  "signature", "credential", "credentials", "connectionstring", "databaseurl", "url", "link", "href",
  "mnemonic", "seed", "seedphrase",
]);
/** Field names that hold content (a body, a file, rows): replaced by their size. */
const CONTENT_KEYS = new Set([
  "body", "rawbody", "requestbody", "responsebody", "payload", "content", "contents", "file", "filecontent", "data",
  "csv", "text", "html", "rows", "lines", "buffer", "bytes", "formdata", "attachment", "statement",
]);
/** Keys that are known safe identifiers and codes even though they would match a pattern above. */
const SAFE_KEYS = new Set(["event", "level", "code", "errorcode", "status", "kind", "rule", "severity"]);

const ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;
const normKey = (k: string) => k.toLowerCase().replace(/[_\-\s]/g, "");

interface Pattern { re: RegExp; token: string; generic?: boolean }
const B58 = "1-9A-HJ-NP-Za-km-z";
/** Order matters: longer and more specific forms first. */
const PATTERNS: Pattern[] = [
  // credentials in URLs and headers
  { re: /\b(postgres(?:ql)?|mysql|redis|amqp|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, token: "[connection-string]" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, token: "Bearer [token]" },
  { re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, token: "[jwt]" },
  { re: /\b((?:access_|refresh_|id_|api_?|session_?)?(?:token|key|secret|password|passwd|signature|code))=([^\s&"'<>]+)/gi, token: "$1=[redacted]" },
  // e-mail before anything that could eat its domain
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, token: "[email]" },
  // transaction hashes and addresses
  { re: /\b0x[0-9a-fA-F]{64}\b/g, token: "[tx]" },
  { re: /\b(?:0x)?41[0-9a-fA-F]{40}\b/g, token: "[address]" },
  { re: /\b0x[0-9a-fA-F]{40}\b/g, token: "[address]" },
  { re: /(?<![A-Za-z0-9:])-?[01]:[0-9a-fA-F]{64}\b/g, token: "[address]" },
  { re: /\b[EUk0]Q[A-Za-z0-9_-]{46}(?![A-Za-z0-9_-])/g, token: "[address]" },
  { re: new RegExp(`\\bT[${B58}]{33}\\b`, "g"), token: "[address]" },
  // Solana: any base58 run of 32–44 characters. `generic`: skipped for a value under an id field (orgId, jobId …),
  // where a 32-character random id would otherwise be taken for an address.
  { re: new RegExp(`(?<![A-Za-z0-9])[${B58}]{32,44}(?![A-Za-z0-9])`, "g"), token: "[address]", generic: true },
  // network addresses
  { re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, token: "[ip]" },
];

/** Every pattern above applied to one string; long strings are replaced by their length first. */
export function scrubString(s: string, opts: { idField?: boolean } = {}): string {
  if (s.length > MAX_STRING) return `[text ${s.length} chars]`;
  let out = s;
  for (const p of PATTERNS) if (!(p.generic && opts.idField)) out = out.replace(p.re, p.token);
  // IPv6: any run of hex digits, colons and dots with two or more colons that node:net accepts as an address
  return out.replace(IPV6_CANDIDATE, (m) => (isIPv6(m) ? "[ip]" : m));
}
const IPV6_CANDIDATE = /(?<![A-Za-z0-9:.])(?=[0-9a-fA-F:.]*:[0-9a-fA-F.]*:)[0-9a-fA-F:.]{2,45}(?![A-Za-z0-9:])/g;

const isBinary = (v: unknown): v is ArrayBufferView | ArrayBuffer => ArrayBuffer.isView(v) || v instanceof ArrayBuffer;

/** A deep, bounded copy with sensitive fields redacted and every string scrubbed. Never throws. */
export function scrubValue(v: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return scrubString(v);
  if (typeof v === "function" || typeof v === "symbol") return `[${typeof v}]`;
  if (isBinary(v)) return `[binary ${v.byteLength} bytes]`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "[invalid date]" : v.toISOString();
  if (v instanceof Error) return scrubError(v);
  if (typeof v !== "object") return "[unknown]";
  if (seen.has(v)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[nested]";
  seen.add(v);
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_ITEMS).map((x) => scrubValue(x, depth + 1, seen));
    return v.length > MAX_ITEMS ? [...items, `[${v.length - MAX_ITEMS} more]`] : items;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  for (const [k, x] of entries.slice(0, MAX_KEYS)) out[scrubString(k).slice(0, 64)] = scrubField(k, x, depth, seen);
  if (entries.length > MAX_KEYS) out["[more]"] = entries.length - MAX_KEYS;
  return out;
}

function sizeOf(x: unknown): string {
  if (typeof x === "string") return `[content ${x.length} chars]`;
  if (isBinary(x)) return `[binary ${x.byteLength} bytes]`;
  if (Array.isArray(x)) return `[content ${x.length} items]`;
  if (x && typeof x === "object") return "[content]";
  return x === null || x === undefined ? String(x) : "[content]";
}

function scrubField(key: string, x: unknown, depth: number, seen: WeakSet<object>): unknown {
  const k = normKey(key);
  if (SAFE_KEYS.has(k)) return scrubValue(x, depth + 1, seen);
  if (CONTENT_KEYS.has(k)) return sizeOf(x);
  if (SENSITIVE_KEYS.has(k)) return x === null || x === undefined ? x : "[redacted]";
  if (typeof x === "string" && (k === "id" || k.endsWith("id")) && ID_SHAPE.test(x)) return scrubString(x, { idField: true });
  return scrubValue(x, depth + 1, seen);
}

/** An error as {type, message, code}: message scrubbed, no cause chain, no own properties beyond a code. */
export function scrubError(e: Error): { type: string; message: string; code?: string } {
  const code = (e as { code?: unknown }).code;
  return {
    type: scrubString(e.name || "Error").slice(0, 64),
    message: scrubString(e.message ?? ""),
    ...(typeof code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? { code } : {}),
  };
}

/**
 * A stack trace reduced to frames (function and file:line only; never source text). Absolute paths are cut to the part
 * from `src/`, `scripts/` or `node_modules/` on, so a machine's directory layout or user name never leaves it.
 */
export function scrubStack(stack: string | undefined): { function?: string; filename?: string; lineno?: number; colno?: number }[] {
  if (!stack) return [];
  const frames: { function?: string; filename?: string; lineno?: number; colno?: number }[] = [];
  for (const line of stack.split("\n").slice(1, 40)) {
    const m = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
    if (!m) continue;
    const file = m[2].replace(/^file:\/\//, "");
    const rel = file.match(/(?:^|\/)((?:src|scripts|node_modules|\.next)\/.*)$/)?.[1] ?? file.split("/").pop() ?? "?";
    frames.push({ ...(m[1] ? { function: scrubString(m[1]).slice(0, 120) } : {}), filename: rel.slice(0, 200), lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames;
}
