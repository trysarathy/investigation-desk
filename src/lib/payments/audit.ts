// Append-only audit log (spec 7): who did what, when, from where. Entries are only ever added:
// there is no update or delete. Until the database lands this is a JSON-lines file under .data/.
// The actor is self-declared until sign-in (week 5); system actions are logged as "system".

import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileLockKey, withLock } from "../lock";

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  actorKind: "person" | "system";
  ip?: string;
  /** e.g. "inbox.status", "review.confirm", "settings.routes", "export.csv". */
  action: string;
  /** What it was done to: an inbox item, review, payment or export. */
  subject: string;
  detail: string;
  before?: unknown;
  after?: unknown;
}

export type AuditDraft = Omit<AuditEntry, "seq">;

export interface AuditLog {
  append(entries: AuditDraft[]): Promise<AuditEntry[]>;
  list(): Promise<AuditEntry[]>;
}

export class MemoryAuditLog implements AuditLog {
  private entries: AuditEntry[] = [];
  async append(drafts: AuditDraft[]) {
    const added = drafts.map((d, i) => ({ seq: this.entries.length + i + 1, ...d }));
    this.entries.push(...added);
    return structuredClone(added);
  }
  async list() { return structuredClone(this.entries); }
}

// The last number written per file, with the file's size then: re-read only if the file changed.
const g = globalThis as { __deskAuditSeq?: Map<string, { size: number; seq: number }> };
const lastSeq = (g.__deskAuditSeq ??= new Map());

export class FileAuditLog implements AuditLog {
  constructor(private readonly file: string) {}
  async list(): Promise<AuditEntry[]> {
    try {
      return (await readFile(this.file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      return [];
    }
  }
  append(drafts: AuditDraft[]): Promise<AuditEntry[]> {
    if (!drafts.length) return Promise.resolve([]);
    // Appends to one file run one at a time (the file's lock), so two writers never take the same number.
    return withLock(fileLockKey(this.file), async () => {
      const key = path.resolve(this.file);
      const size = await stat(this.file).then((s) => s.size, () => 0);
      const cached = lastSeq.get(key);
      // Continue from the last number written, so numbers only ever increase.
      const last = cached && cached.size === size ? cached.seq : (await this.list()).at(-1)?.seq ?? 0;
      const added = drafts.map((d, i) => ({ seq: last + i + 1, ...d }));
      const body = added.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await mkdir(path.dirname(this.file), { recursive: true });
      await appendFile(this.file, body);
      lastSeq.set(key, { size: size + Buffer.byteLength(body), seq: last + added.length });
      return added;
    });
  }
}

export const SYSTEM = { actor: "system", actorKind: "system" as const };

/** A person's name as given in the app. Pseudonymous staff names only: no email addresses. */
export function checkActor(name: unknown): string | undefined {
  if (typeof name !== "string" || !name.trim()) return "Say who you are (Acting as) before making changes.";
  if (name !== name.trim()) return "Name has leading or trailing spaces.";
  if (/@/.test(name)) return "Use a name, not an email address.";
  if (name.length > 60) return "Name is longer than 60 characters.";
  return undefined;
}
