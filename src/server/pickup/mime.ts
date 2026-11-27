/**
 * v1 phase 2.1: a small, bounded reader for the emails the inbox pickup handles: headers (unfolded), the sender
 * address, the receiving server's authentication verdict, and the attachments of a (nested) multipart message
 * (base64, quoted-printable, 7bit/8bit/binary). Anything unexpected is skipped with a code, never thrown past the
 * caller. Pure: no disk, no network. Bodies are worked on as latin1 strings so every byte survives.
 */

export interface MailAttachment { fileName: string; bytes: Uint8Array }
export interface ParsedMail {
  /** The From address, lower-cased (null when there is none). */
  from: string | null;
  /**
   * The verdict of the TOPMOST Authentication-Results header (the one the receiving server adds; lower ones can be
   * written by the sender): true only for dkim=pass or dmarc=pass.
   */
  authenticated: boolean;
  attachments: MailAttachment[];
  /** Codes for parts that were not taken (unsupported encoding, too many attachments, too deep). */
  skipped: string[];
}

export const MAIL_LIMITS = Object.freeze({ maxAttachments: 10, maxDepth: 5, maxParts: 100 });

type Headers = Map<string, string[]>;

function splitHead(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) } : { head: raw, body: "" };
}

function parseHeaders(head: string): Headers {
  const out: Headers = new Map();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    out.set(k, [...(out.get(k) ?? []), line.slice(i + 1).trim()]);
  }
  return out;
}

/** A header parameter (boundary, filename, name), quoted or not; RFC 2231 `name*=charset''value` decoded. */
function param(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  const ext = new RegExp(`(?:^|;)\\s*${name}\\*=([^;]*)`, "i").exec(value);
  if (ext) {
    const m = /^([^']*)'[^']*'(.*)$/.exec(ext[1].trim().replace(/^"|"$/g, ""));
    if (m) {
      try { return /utf-?8/i.test(m[1]) ? decodeURIComponent(m[2]) : m[2].replace(/%([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))); } catch { return undefined; }
    }
  }
  const p = new RegExp(`(?:^|;)\\s*${name}=("((?:[^"\\\\]|\\\\.)*)"|[^;\\s]+)`, "i").exec(value);
  return p ? (p[2] !== undefined ? p[2].replace(/\\(.)/g, "$1") : p[1]) : undefined;
}

/** RFC 2047 encoded words (=?UTF-8?B?...?= / =?UTF-8?Q?...?=) in a file name. */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs: string, enc: string, text: string) => {
    const bytes = enc.toUpperCase() === "B" ? Buffer.from(text, "base64")
      : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
    return bytes.toString(/utf-?8/i.test(cs) ? "utf8" : "latin1");
  });
}

function decodeBody(body: string, encoding: string | undefined): Uint8Array | null {
  const e = (encoding ?? "7bit").trim().toLowerCase();
  if (e === "base64") return new Uint8Array(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64"));
  if (e === "quoted-printable") {
    return new Uint8Array(Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1"));
  }
  if (e === "7bit" || e === "8bit" || e === "binary") return new Uint8Array(Buffer.from(body, "latin1"));
  return null;
}

/** The address inside "Name <a@b>" (or a bare address), lower-cased. */
export function addressOf(from: string | undefined): string | null {
  if (!from) return null;
  const m = /<([^<>\s@]+@[^<>\s@]+)>/.exec(from) ?? /([^\s<>"@,;]+@[^\s<>"@,;]+)/.exec(from);
  return m ? m[1].toLowerCase() : null;
}

export function parseMail(raw: Uint8Array, limits = MAIL_LIMITS): ParsedMail {
  const text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("latin1");
  const { head, body } = splitHead(text);
  const headers = parseHeaders(head);
  const verdict = headers.get("authentication-results")?.[0] ?? "";
  const out: ParsedMail = { from: addressOf(headers.get("from")?.[0]), authenticated: /\b(dkim|dmarc)=pass\b/i.test(verdict), attachments: [], skipped: [] };
  let parts = 0;

  const walk = (h: Headers, b: string, depth: number) => {
    if (++parts > limits.maxParts) { if (!out.skipped.includes("too_many_parts")) out.skipped.push("too_many_parts"); return; }
    const type = h.get("content-type")?.[0] ?? "text/plain";
    if (/^multipart\//i.test(type)) {
      const boundary = param(type, "boundary");
      if (!boundary || boundary.length > 200) { out.skipped.push("multipart_without_boundary"); return; }
      if (depth >= limits.maxDepth) { out.skipped.push("too_deep"); return; }
      const sections = b.split(`--${boundary}`);
      // sections[0] is the preamble; the last one (after "--boundary--") is the epilogue
      for (let i = 1; i < sections.length; i++) {
        const sec = sections[i];
        if (sec.startsWith("--")) break;
        const part = splitHead(sec.replace(/^\r?\n/, ""));
        walk(parseHeaders(part.head), part.body.replace(/\r?\n$/, ""), depth + 1);
      }
      return;
    }
    const disposition = h.get("content-disposition")?.[0];
    const name = param(disposition, "filename") ?? param(type, "name");
    if (!name && !/^\s*attachment/i.test(disposition ?? "")) return; // the message text itself
    if (out.attachments.length >= limits.maxAttachments) { if (!out.skipped.includes("too_many_attachments")) out.skipped.push("too_many_attachments"); return; }
    const bytes = decodeBody(b, h.get("content-transfer-encoding")?.[0]);
    if (!bytes) { out.skipped.push("unsupported_transfer_encoding"); return; }
    out.attachments.push({ fileName: decodeWords(name ?? "attachment"), bytes });
  };
  walk(headers, body, 0);
  return out;
}

/** An allowed-senders entry: an exact address ("ap@vendor.example") or a whole domain ("@vendor.example"). */
export function senderAllowed(from: string | null, allowed: readonly string[]): boolean {
  if (!from) return false;
  const domain = from.slice(from.lastIndexOf("@"));
  return allowed.some((a) => { const x = a.trim().toLowerCase(); return x.startsWith("@") ? domain === x : from === x; });
}
