import "server-only";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_MAX_BYTES } from "@/lib/limits";
import { parseMail, senderAllowed } from "./mime";

/**
 * v1 phase 2.1: where scheduled pickup reads files from. A `PickupSource` lists the items waiting at one configured
 * location; each item is read only when it is processed, and an item that must not be read at all carries a refusal
 * code instead (it is recorded once, so it is not looked at again). Sources never delete or move anything at the
 * customer's end: what was seen is remembered by the database (upload_pickup_items), keyed by a hash of the item's
 * remote identity.
 *
 * No SFTP or IMAP client is installed in this build (none in node_modules, and none is added). Two local stand-ins
 * implement the interface and are what the tests use:
 *   - LocalDirectorySource ("sftp"): a folder under CLEARLINE_PICKUP_ROOT. In a deployment this is also a real
 *     option: an SFTP folder mirrored into that directory by a sync agent the operator runs.
 *   - MaildirSource ("email"): a Maildir (new/ and cur/) under CLEARLINE_PICKUP_ROOT, as a local mail server or a
 *     fetch agent writes it; attachments of messages from an allowed sender, authenticated by the receiving server.
 * A real SFTP or IMAP adapter implements the same interface and reads its credential from the environment variable
 * the source names (credential_ref) through `pickupCredential`, which never prints it. See docs/runbooks/UPLOAD_PICKUP_V1.md.
 */

export interface PickupItem {
  /** sha256 hex of the item's remote identity; the same item always has the same key. */
  key: string;
  /** The name to record (sanitised again by the upload pipeline). */
  fileName: string;
  /** A refusal code when the item must not be read (too large, sender not allowed, …). */
  refusal?: string;
  read(): Promise<Uint8Array>;
}

export interface PickupSource {
  readonly kind: "sftp" | "email";
  list(): Promise<PickupItem[]>;
}

/** The source cannot be reached or is not configured; the run records this code and tries again next time. */
export class PickupUnavailable extends Error { constructor(readonly code: string, message: string) { super(message); } }

export interface SourceConfig { kind: string; location: string; credentialRef: string | null; allowedSenders: unknown }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** Mail is larger than its attachments (base64 adds a third); the attachment limit still applies to each file. */
export const MAX_MESSAGE_BYTES = Math.ceil(UPLOAD_MAX_BYTES * 1.5);

/** The credential a real adapter would use: read from the variable the source names; its value is never echoed. */
export function pickupCredential(ref: string | null, env: Record<string, string | undefined> = process.env): string | null {
  if (!ref) return null;
  if (!/^CLEARLINE_PICKUP_[A-Z0-9_]{1,64}$/.test(ref)) throw new PickupUnavailable("CREDENTIAL_REF_INVALID", "The credential reference is not a CLEARLINE_PICKUP_* variable name.");
  const v = env[ref];
  if (!v) throw new PickupUnavailable("CREDENTIAL_MISSING", `The credential variable ${ref} is not set.`);
  return v;
}

/** <root>/<location>, refusing anything that resolves outside the root (symlinks included). */
async function folder(root: string, location: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(location) || location.split("/").some((p) => p === "." || p === "..")) {
    throw new PickupUnavailable("LOCATION_INVALID", "The pickup location is not a plain relative folder name.");
  }
  let realRoot: string, real: string;
  try { realRoot = await realpath(root); real = await realpath(path.join(realRoot, location)); } catch {
    throw new PickupUnavailable("LOCATION_NOT_FOUND", "The pickup folder does not exist.");
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new PickupUnavailable("LOCATION_OUTSIDE_ROOT", "The pickup folder is outside the pickup root.");
  return real;
}

/** Regular files directly in `dir` (no symlinks, no dot files, no partial transfers), older than `minAgeMs`. */
async function settledFiles(dir: string, minAgeMs: number, now: number) {
  const out: { name: string; full: string; size: number; mtimeMs: number }[] = [];
  let names: string[];
  try { names = await readdir(dir); } catch { return out; }
  for (const name of names.sort()) {
    if (name.startsWith(".") || /\.(tmp|part|partial|filepart)$/i.test(name)) continue;
    const full = path.join(dir, name);
    const st = await lstat(full).catch(() => null);
    if (!st || !st.isFile() || now - st.mtimeMs < minAgeMs) continue; // a file still being written waits for the next run
    out.push({ name, full, size: st.size, mtimeMs: st.mtimeMs });
  }
  return out;
}

export class LocalDirectorySource implements PickupSource {
  readonly kind = "sftp" as const;
  constructor(private readonly root: string, private readonly location: string, private readonly opts: { minAgeMs?: number; now?: () => number } = {}) {}
  async list(): Promise<PickupItem[]> {
    const dir = await folder(this.root, this.location);
    const files = await settledFiles(dir, this.opts.minAgeMs ?? 60_000, (this.opts.now ?? Date.now)());
    return files.map((f) => ({
      key: sha(`sftp|${this.location}|${f.name}|${f.size}|${Math.floor(f.mtimeMs)}`),
      fileName: f.name,
      ...(f.size > UPLOAD_MAX_BYTES ? { refusal: "FILE_FILE_TOO_LARGE" } : f.size === 0 ? { refusal: "FILE_FILE_EMPTY" } : {}),
      read: async () => new Uint8Array(await readFile(f.full)),
    }));
  }
}

export class MaildirSource implements PickupSource {
  readonly kind = "email" as const;
  constructor(private readonly root: string, private readonly location: string, private readonly allowed: readonly string[], private readonly opts: { minAgeMs?: number; now?: () => number } = {}) {}
  async list(): Promise<PickupItem[]> {
    const dir = await folder(this.root, this.location);
    const now = (this.opts.now ?? Date.now)();
    const out: PickupItem[] = [];
    for (const sub of ["new", "cur"]) {
      for (const f of await settledFiles(path.join(dir, sub), this.opts.minAgeMs ?? 0, now)) {
        // a Maildir file name is unique and stable; the ":2,flags" suffix in cur/ changes, so it is not part of the identity
        const id = f.name.replace(/:2,[A-Za-z]*$/, "");
        const whole = (code: string): PickupItem => ({ key: sha(`email|${this.location}|${id}`), fileName: "message", refusal: code, read: () => Promise.reject(new Error("refused")) });
        if (f.size > MAX_MESSAGE_BYTES) { out.push(whole("EMAIL_TOO_LARGE")); continue; }
        const mail = parseMail(new Uint8Array(await readFile(f.full)));
        if (!mail.authenticated) { out.push(whole("EMAIL_NOT_AUTHENTICATED")); continue; }
        if (!senderAllowed(mail.from, this.allowed)) { out.push(whole("EMAIL_SENDER_NOT_ALLOWED")); continue; }
        if (mail.attachments.length === 0) { out.push(whole("EMAIL_NO_ATTACHMENT")); continue; }
        mail.attachments.forEach((a, i) => out.push({
          key: sha(`email|${this.location}|${id}|${i}`), fileName: a.fileName,
          ...(a.bytes.byteLength > UPLOAD_MAX_BYTES ? { refusal: "FILE_FILE_TOO_LARGE" } : {}),
          read: async () => a.bytes,
        }));
      }
    }
    return out;
  }
}

/** The source for a configured row: the local stand-ins under CLEARLINE_PICKUP_ROOT. */
export function pickupSourceFor(row: SourceConfig, env: Record<string, string | undefined> = process.env): PickupSource {
  const root = env.CLEARLINE_PICKUP_ROOT;
  if (!root) throw new PickupUnavailable("PICKUP_NOT_CONFIGURED", "CLEARLINE_PICKUP_ROOT is not set, so there is nowhere to pick files up from.");
  pickupCredential(row.credentialRef, env); // a source that names a credential needs it set (the stand-ins do not use it)
  const minAgeMs = Number(env.CLEARLINE_PICKUP_MIN_AGE_SECONDS ?? 60) * 1000;
  if (row.kind === "sftp") return new LocalDirectorySource(root, row.location, { minAgeMs });
  if (row.kind === "email") return new MaildirSource(root, row.location, Array.isArray(row.allowedSenders) ? row.allowedSenders.map(String) : [], { minAgeMs });
  throw new PickupUnavailable("KIND_UNKNOWN", "Unknown pickup kind.");
}
