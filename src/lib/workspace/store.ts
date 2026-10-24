// The company's uploaded files (Files A and B) and their upload history. Until the database
// lands (week 5) this is a JSON file under the git-ignored .data/ directory; tests use memory.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RowError, ValidationResult } from "../csv/files";
import { fileLockKey, LockedStore, writeAtomic, type Store } from "../lock";
import type { DepositAddressRow, LedgerRow } from "../types";

export type FileKind = "A" | "B";

export interface UploadRecord {
  kind: FileKind;
  filename: string;
  sha256: string;
  uploadedAt: string;
  acceptedRows: number;
  rejectedRows: number;
  /** The first rejected rows, for display. The count above is the full total. */
  rowErrors: RowError[];
  ignoredColumns: string[];
  notes: string[];
  outcome: "replaced" | "no_change" | "rejected";
  fileErrors: string[];
}

export interface WorkspaceData {
  fileA?: { upload: UploadRecord; rows: DepositAddressRow[] };
  fileB?: { upload: UploadRecord; rows: LedgerRow[] };
  history: UploadRecord[];
  /** The seeded demo workspace (sample company files). A real upload ends it. */
  demo?: boolean;
}

export type WorkspaceStore = Store<WorkspaceData>;

export class MemoryWorkspaceStore extends LockedStore<WorkspaceData> {
  protected readonly lockKey = `memory:${randomUUID()}`;
  private data: WorkspaceData = { history: [] };
  async load() { return structuredClone(this.data); }
  protected async write(data: WorkspaceData) { this.data = structuredClone(data); }
}

export class FileWorkspaceStore extends LockedStore<WorkspaceData> {
  protected readonly lockKey: string;
  constructor(private readonly file: string) { super(); this.lockKey = fileLockKey(file); }
  async load(): Promise<WorkspaceData> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as WorkspaceData;
    } catch {
      return { history: [] };
    }
  }
  // Written whole or not at all, so a crash never leaves a half-written workspace.
  protected write(data: WorkspaceData) { return writeAtomic(this.file, JSON.stringify(data)); }
}

const SHOWN_ROW_ERRORS = 500;

/**
 * Apply one upload. A file-level error keeps the previous file. The same bytes as the current
 * file (same SHA-256) change nothing. Otherwise the accepted rows replace the previous file in
 * full; rejected rows are listed and counted, never fixed.
 */
export async function applyUpload<T extends DepositAddressRow | LedgerRow>(
  store: WorkspaceStore, kind: FileKind, filename: string, result: ValidationResult<T>, now: Date,
): Promise<UploadRecord> {
  return store.update((data) => uploadInto(data, kind, filename, result, now));
}

function uploadInto<T extends DepositAddressRow | LedgerRow>(data: WorkspaceData, kind: FileKind, filename: string, result: ValidationResult<T>, now: Date): [WorkspaceData, UploadRecord] {
  const current = kind === "A" ? data.fileA : data.fileB;
  const base = {
    kind, filename, sha256: result.sha256, uploadedAt: now.toISOString(),
    acceptedRows: result.rows.length, rejectedRows: result.rowErrors.length,
    rowErrors: result.rowErrors.slice(0, SHOWN_ROW_ERRORS), ignoredColumns: result.ignoredColumns,
    notes: result.notes, fileErrors: result.fileErrors,
  };
  let record: UploadRecord;
  if (result.fileErrors.length) {
    record = { ...base, acceptedRows: 0, outcome: "rejected" };
  } else if (current && current.upload.sha256 === result.sha256) {
    record = { ...current.upload, outcome: "no_change", uploadedAt: now.toISOString(), filename };
  } else {
    record = { ...base, outcome: "replaced" };
    data.demo = false;
    if (kind === "A") data.fileA = { upload: record, rows: result.rows as DepositAddressRow[] };
    else data.fileB = { upload: record, rows: result.rows as LedgerRow[] };
  }
  data.history = [record, ...data.history].slice(0, 50);
  return [data, record];
}
