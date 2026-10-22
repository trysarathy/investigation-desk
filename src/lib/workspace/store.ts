// The company's uploaded files (Files A and B) and their upload history. Until the database
// lands (week 5) this is a JSON file under the git-ignored .data/ directory; tests use memory.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowError, ValidationResult } from "../csv/files";
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
}

export interface WorkspaceStore {
  load(): Promise<WorkspaceData>;
  save(data: WorkspaceData): Promise<void>;
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  private data: WorkspaceData = { history: [] };
  async load() { return structuredClone(this.data); }
  async save(data: WorkspaceData) { this.data = structuredClone(data); }
}

export class FileWorkspaceStore implements WorkspaceStore {
  constructor(private readonly file: string) {}
  async load(): Promise<WorkspaceData> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as WorkspaceData;
    } catch {
      return { history: [] };
    }
  }
  async save(data: WorkspaceData) {
    await mkdir(path.dirname(this.file), { recursive: true });
    // Write then rename, so a crash never leaves a half-written workspace.
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, this.file);
  }
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
  const data = await store.load();
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
    if (kind === "A") data.fileA = { upload: record, rows: result.rows as DepositAddressRow[] };
    else data.fileB = { upload: record, rows: result.rows as LedgerRow[] };
  }
  data.history = [record, ...data.history].slice(0, 50);
  await store.save(data);
  return record;
}
