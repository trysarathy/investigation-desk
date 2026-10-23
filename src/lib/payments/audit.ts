// Append-only audit log (spec 7): who did what, when, from where. Entries are only ever added:
// there is no update or delete. Until the database lands this is a JSON-lines file under .data/.
// The actor is self-declared until sign-in (week 5); system actions are logged as "system".

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

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

export class FileAuditLog implements AuditLog {
  constructor(private readonly file: string) {}
  async list(): Promise<AuditEntry[]> {
    try {
      return (await readFile(this.file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      return [];
    }
  }
  async append(drafts: AuditDraft[]) {
    if (!drafts.length) return [];
    const start = (await this.list()).length;
    const added = drafts.map((d, i) => ({ seq: start + i + 1, ...d }));
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, added.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return added;
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
