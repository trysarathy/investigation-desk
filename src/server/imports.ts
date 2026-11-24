import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { applyAction, type StatementLineInput } from "@/lib/clearline";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { loadWorkspaceForUpdate, readWorkspace, saveWorkspaceDiff } from "./engine-store";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";
import { csvCell } from "@/lib/csv/cell";

/**
 * Bank-statement CSV import (Clearline Control).
 *
 * FORMAT (also docs/product/STATEMENT_CSV_FORMAT.md)
 *   UTF-8 (an optional BOM is accepted), RFC 4180: comma-separated, double-quote escaping, CRLF or LF line endings.
 *   Row 1 is a header naming EXACTLY these nine columns, in any order, lower case, nothing else:
 *     line_id       1-64 chars, A-Z a-z 0-9 _ - : .        the bank's own line id
 *     account_ref   2-64 chars, letters, digits, space ( ) / . , : ; ' _ & # + -
 *     value_date    YYYY-MM-DD, a real calendar date
 *     direction     debit | credit
 *     kind          payment | return | reversal
 *     amount        positive plain decimal, at most the currency's decimals (SGD/USD/PHP/EUR 2, USDC 6); no sign,
 *                   no exponent, no thousands separators, no surrounding spaces, at most 32 characters
 *     currency      SGD | USD | PHP | EUR | USDC
 *     reference     0-140 chars as printed on the statement; no < >, no control characters except TAB
 *     counterparty  0-120 chars; same character rules as reference
 *   At most 1 MiB (1,048,576 bytes) and 5,000 data rows. Blank lines are ignored (and reported as notes).
 *   (account_ref, line_id) must be unique within the file; the engine also refuses a line already ingested.
 *
 * GUARANTEES
 *   - Finance only (`import_statement`), inside the caller's RLS-scoped tenant transaction.
 *   - Size is checked before anything is decoded or parsed; NUL bytes and invalid UTF-8 refuse the file.
 *   - All-or-nothing: one invalid row (or one line the engine refuses) and nothing is imported. The attempt is
 *     recorded as a `rejected` statement_imports row with per-row errors, and audited.
 *   - A file whose SHA-256 was already uploaded in this organisation is refused (409) and audited.
 *   - Cells are stored as raw text and never evaluated. Every CSV this module emits goes through csvCell, which
 *     prefixes = + - @ TAB CR cells with ' so a spreadsheet never runs them.
 *   - Provenance is set by the server: every row the engine creates for an imported line is stored with
 *     provenance 'csv_import' and the import id. No column can claim provenance, verification or bank
 *     authentication; unknown columns refuse the file.
 *   - The engine decides matching (reference-based; amount-only never allocates).
 *   - Parsing happens in memory only. Nothing is written to disk; the file itself is never stored or served back
 *     (only its hash, name, size and the parsed lines).
 */

export { MAX_FILE_BYTES, MAX_ROWS, MAX_STORED_ERRORS, STATEMENT_COLUMNS, parseStatementCsv } from "@/lib/csv/statement";
export type { ImportErrorCode, ImportError, ParsedStatementRow, ParseResult, ParseOptions } from "@/lib/csv/statement";
import { MAX_FILE_BYTES, MAX_STORED_ERRORS, hasForbiddenText, parseStatementCsv, type ImportError, type StatementColumn } from "@/lib/csv/statement";
import { stampNow } from "./live-clock";

/** The import error report as CSV. Every cell goes through csvCell, so a formula in the file is never re-armed. */
export function importErrorReportCsv(errors: readonly ImportError[]): string {
  const lines = [["row", "column", "code", "message", "value"].join(",")];
  for (const e of errors) lines.push([csvCell(e.row ?? ""), csvCell(e.column), csvCell(e.code), csvCell(e.message), csvCell(e.value)].join(","));
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------
// Service helpers (copied from control.ts's pattern)
// ---------------------------------------------------------------------------------------------

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
async function serverAudit(tx: Tx, ctx: TenantContext, action: string, entityType: string | null, entityId: string | null, summary: string, details?: unknown) {
  await tx.insert(t.auditEvents).values({ orgId: ctx.orgId, source: "server", actorUserId: ctx.userId, action, entityType, entityId, summary, at: stampNow(), details: details ?? null });
}
const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

async function idempotent<T>(tx: Tx, ctx: TenantContext, key: string, request: unknown, run: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T; replayed: boolean }> {
  const fingerprint = sha256Hex(canonical({ userId: ctx.userId, request }));
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.orgId + "|" + key}))`);
  const [prev] = await tx.select().from(t.idempotencyRecords).where(and(eq(t.idempotencyRecords.orgId, ctx.orgId), eq(t.idempotencyRecords.key, key)));
  if (prev) {
    if (prev.fingerprint !== fingerprint) throw new RequestRefused(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request.");
    return { status: prev.statusCode, body: prev.response as T, replayed: true };
  }
  const r = await run();
  await tx.insert(t.idempotencyRecords).values({ orgId: ctx.orgId, key, userId: ctx.userId, fingerprint, statusCode: r.status, response: r.body as object });
  return { ...r, replayed: false };
}

/** A display file name: 1-200 characters, ends in .csv, no path separators or control characters. Never used as a path. */
export const ImportFileName = z.string().min(5).max(200)
  .refine((s) => !/[/\\]/.test(s) && !hasForbiddenText(s) && !s.includes("\t"), "File name must not contain path separators, < > or control characters.")
  .refine((s) => s.toLowerCase().endsWith(".csv"), "Only .csv files are accepted.");

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

export interface ImportAccepted {
  importId: string; status: "pending_confirmation"; fileName: string; fileSha256: string; linesSha256: string; sizeBytes: number;
  rowCount: number; acceptedCount: number; outcomes: Record<string, number>;
  lines: { row: number; lineId: string; statementLineId: string; outcome: string }[];
  notes: string[];
}
export interface ImportRejected {
  importId: string; status: "rejected"; fileName: string; fileSha256: string; sizeBytes: number;
  rowCount: number; rejectedCount: number; errors: ImportError[]; errorsTruncated: boolean; notes: string[];
}
type ImportBody = ImportAccepted | ImportRejected | { status: "duplicate"; code: "DUPLICATE_FILE"; fileSha256: string; existingImportId: string; existingStatus: string };

/**
 * Import one bank-statement CSV for the session user. Returns 201 (imported) or 422 (rejected, nothing imported,
 * attempt recorded). A file already uploaded in this organisation is refused with RequestRefused 409. An empty or
 * oversized file is refused before it is read (422) and audited; it gets no statement_imports row because the table
 * only holds files of 1..1,048,576 bytes.
 */
export async function importStatementCsv(ctx: TenantContext, input: { fileName: string; bytes: Uint8Array }, idempotencyKey: string) {
  require(ctx, "import_statement");
  const key = IdempotencyKey.parse(idempotencyKey);
  const fileName = ImportFileName.parse(input.fileName);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) throw new RequestRefused(400, "INVALID_FILE", "The upload is not a file.");
  // size first: nothing is hashed, decoded or parsed beyond the limit
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
    const code = bytes.byteLength === 0 ? "FILE_EMPTY" : "FILE_TOO_LARGE";
    const message = bytes.byteLength === 0 ? "The file is empty." : `The file is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES} bytes (1 MiB).`;
    await tenantTx(ctx, (tx) => serverAudit(tx, ctx, "statement_import_rejected", "statement_import", null, `Statement import refused before reading: ${message}`,
      { code, fileName, sizeBytes: bytes.byteLength, actor: ctx.userId, rowCount: 0, acceptedCount: 0, rejectedCount: 0 }));
    throw new RequestRefused(422, code, message);
  }
  const fileSha256 = sha256Hex(bytes);
  const sizeBytes = bytes.byteLength;

  const result = await tenantTx(ctx, (tx) => idempotent<ImportBody>(tx, ctx, key, { op: "statement_import", fileName, fileSha256, sizeBytes }, async () => {
    // serialise uploads of the same file in this organisation (the unique index is the backstop)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.orgId + "|statement-import|" + fileSha256}))`);
    const [existing] = await tx.select({ id: t.statementImports.id, status: t.statementImports.status }).from(t.statementImports)
      .where(and(eq(t.statementImports.orgId, ctx.orgId), eq(t.statementImports.fileSha256, fileSha256)));
    if (existing) {
      await serverAudit(tx, ctx, "statement_import_duplicate", "statement_import", existing.id, `Duplicate statement file refused (sha256 ${fileSha256.slice(0, 12)}…, first upload ${existing.status})`,
        { fileSha256, fileName, sizeBytes, existingImportId: existing.id, actor: ctx.userId });
      return { status: 409, body: { status: "duplicate", code: "DUPLICATE_FILE", fileSha256, existingImportId: existing.id, existingStatus: existing.status } };
    }

    const importId = randomUUID();
    const parsed = parseStatementCsv(bytes);
    let errors: ImportError[] = [];
    let errorCount = 0;
    const lines: ImportAccepted["lines"] = [];
    if (!parsed.ok) {
      errors = parsed.errors;
      errorCount = parsed.errorCount;
    } else {
      // Every line goes through the engine, in file order, against one locked workspace; the diff is persisted once,
      // only if the engine accepted every line (all-or-nothing). This is runEngineAction's sequence (lock, applyAction
      // with the session user as actor, saveWorkspaceDiff with provenance) done once per file instead of once per line:
      // per-line reloads of the whole workspace made a 300-line file take ~20 s (quadratic).
      const loaded = await loadWorkspaceForUpdate(tx, ctx.orgId);
      let ws = loaded.workspace;
      let at = Date.parse(ws.asOf);
      for (const r of parsed.rows) {
        at = Math.max(stampNow().getTime(), at + 1);
        const out = applyAction(ws, { type: "ingest_statement_line", line: r.line }, { actorId: ctx.userId, at: new Date(at).toISOString() });
        if (!out.ok) {
          errorCount++;
          const field = (out.error as { field?: string }).field;
          if (errors.length < MAX_STORED_ERRORS) errors.push({ row: r.row, column: field ? engineFieldColumn(field) : null, code: "engine_refused", message: `${out.error.code}: ${out.error.message}`, value: r.line.lineId });
          continue;
        }
        ws = out.value.workspace;
        lines.push({ row: r.row, lineId: r.line.lineId, statementLineId: out.value.createdIds.find((id) => id.startsWith("stl")) ?? out.value.createdIds[0] ?? "", outcome: out.value.outcome });
      }
      // Dry run only. Nothing is ingested until a second person (an Approver) confirms the import: an uploaded file is
      // a person's assertion, not an authenticated bank feed, and the engine treats bank lines as independent evidence.
    }
    const rowCount = parsed.rowCount;
    const notes = parsed.notes;

    if (errorCount) {
      const rejectedRows = new Set(errors.filter((x) => x.row !== null && x.row > 1).map((x) => x.row)).size;
      await tx.insert(t.statementImports).values({ orgId: ctx.orgId, id: importId, fileSha256, fileName, sizeBytes, rowCount, acceptedCount: 0, rejectedCount: rejectedRows, status: "rejected", errors: { errors, errorCount, truncated: errorCount > errors.length }, importedBy: ctx.userId });
      await serverAudit(tx, ctx, "statement_import_rejected", "statement_import", importId, `Statement file rejected, nothing imported: ${errorCount} error(s) in ${rowCount} row(s) (sha256 ${fileSha256.slice(0, 12)}…)`,
        { fileSha256, fileName, sizeBytes, rowCount, acceptedCount: 0, rejectedCount: rejectedRows, errorCount, actor: ctx.userId });
      return { status: 422, body: { importId, status: "rejected", fileName, fileSha256, sizeBytes, rowCount, rejectedCount: rejectedRows, errors, errorsTruncated: errorCount > errors.length, notes } };
    }

    const outcomes: Record<string, number> = {};
    for (const l of lines) outcomes[l.outcome] = (outcomes[l.outcome] ?? 0) + 1;
    const staged = parsed.ok ? parsed.rows.map((r) => ({ row: r.row, line: r.line })) : [];
    const linesSha256 = linesDigest(staged);
    await tx.insert(t.statementImports).values({ orgId: ctx.orgId, id: importId, fileSha256, fileName, sizeBytes, rowCount, acceptedCount: 0, rejectedCount: 0, status: "pending_confirmation", errors: { errors: [], errorCount: 0, truncated: false }, importedBy: ctx.userId, lines: staged, linesSha256 });
    await serverAudit(tx, ctx, "statement_import_staged", "statement_import", importId, `Statement file validated, awaiting a second person's confirmation: ${lines.length} line(s) (sha256 ${fileSha256.slice(0, 12)}…); nothing ingested yet`,
      { fileSha256, fileName, sizeBytes, rowCount, acceptedCount: 0, stagedCount: lines.length, rejectedCount: 0, dryRunOutcomes: outcomes, actor: ctx.userId });
    return { status: 201, body: { importId, status: "pending_confirmation", fileName, fileSha256, linesSha256, sizeBytes, rowCount, acceptedCount: 0, outcomes, lines, notes } };
  }));

  if (result.status === 409) {
    const b = result.body as Extract<ImportBody, { status: "duplicate" }>;
    throw new RequestRefused(409, "DUPLICATE_FILE", `This file (sha256 ${b.fileSha256.slice(0, 12)}…) was already uploaded in this organisation (import ${b.existingImportId}, ${b.existingStatus}).`);
  }
  return result as { status: 201 | 422; body: ImportAccepted | ImportRejected; replayed: boolean };
}

export const ImportDecision = z.object({ decision: z.enum(["confirm", "decline"]), reason: z.string().trim().min(3).max(1000), fileSha256: z.string().regex(/^[0-9a-f]{64}$/), linesSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/** SHA-256 of the canonical staged lines: the approver reviews and confirms exactly these (review H2). */
export function linesDigest(staged: unknown): string {
  return createHash("sha256").update(canonical(staged)).digest("hex");
}

/** What a confirming approver reviews: every staged line as it will be ingested, and the hash their decision binds. */
export async function stagedImport(ctx: TenantContext, importId: string) {
  require(ctx, "read");
  if (!z.uuid().safeParse(importId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, async (tx) => {
    const [imp] = await tx.select().from(t.statementImports).where(and(eq(t.statementImports.orgId, ctx.orgId), eq(t.statementImports.id, importId)));
    if (!imp) throw new AccessDenied(404, "Not found.");
    return { importId: imp.id, status: imp.status, fileName: imp.fileName, fileSha256: imp.fileSha256, linesSha256: imp.linesSha256, importedBy: imp.importedBy, lines: imp.lines as { row: number; line: StatementLineInput }[] };
  });
}

/**
 * Second-person confirmation. An active Approver who did not upload the file confirms (the engine then ingests every
 * staged line, all-or-nothing, with provenance csv_import) or declines it. The approver states the file hash they
 * reviewed. The database trigger refuses the importer, a non-approver, a closed import or changed content.
 */
export async function decideStatementImport(ctx: TenantContext, importId: string, input: z.infer<typeof ImportDecision>, idempotencyKey: string) {
  require(ctx, "confirm_import");
  const d = ImportDecision.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!z.uuid().safeParse(importId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "statement_import_decision", importId, ...d }, async () => {
    const [imp] = await tx.select().from(t.statementImports).where(and(eq(t.statementImports.orgId, ctx.orgId), eq(t.statementImports.id, importId))).for("update");
    if (!imp) throw new AccessDenied(404, "Not found.");
    if (imp.importedBy === ctx.userId) throw new RequestRefused(409, "MAKER_CANNOT_CONFIRM", "You uploaded this file; another approver must confirm it.");
    if (imp.status !== "pending_confirmation") throw new RequestRefused(409, "IMPORT_CLOSED", `This import is ${imp.status}.`);
    if (imp.fileSha256 !== d.fileSha256 || imp.linesSha256 !== d.linesSha256 || linesDigest(imp.lines) !== d.linesSha256) throw new RequestRefused(409, "VERSION_MISMATCH", "The lines you reviewed do not match this import.");
    let accepted = 0;
    const outcomes: Record<string, number> = {};
    if (d.decision === "confirm") {
      const staged = imp.lines as { row: number; line: StatementLineInput }[];
      const loaded = await loadWorkspaceForUpdate(tx, ctx.orgId);
      let ws = loaded.workspace;
      let at = Date.parse(ws.asOf);
      for (const s of staged) {
        at = Math.max(stampNow().getTime(), at + 1);
        const out = applyAction(ws, { type: "ingest_statement_line", line: s.line }, { actorId: imp.importedBy, at: new Date(at).toISOString() });
        if (!out.ok) throw new RequestRefused(422, "ENGINE_REFUSED", `Row ${s.row}: ${out.error.code}: ${out.error.message}. Nothing was ingested; decline this import and upload a corrected file.`);
        ws = out.value.workspace;
        outcomes[out.value.outcome] = (outcomes[out.value.outcome] ?? 0) + 1;
        accepted++;
      }
      await saveWorkspaceDiff(tx, ctx.orgId, loaded.workspace, ws, { provenance: "csv_import", importId, actorUserId: ctx.userId });
    }
    await tx.update(t.statementImports).set({ status: d.decision === "confirm" ? "imported" : "declined", acceptedCount: accepted, confirmedBy: ctx.userId, confirmedAt: stampNow(), decisionReason: d.reason })
      .where(and(eq(t.statementImports.orgId, ctx.orgId), eq(t.statementImports.id, importId)));
    await serverAudit(tx, ctx, d.decision === "confirm" ? "statement_import_accepted" : "statement_import_declined", "statement_import", importId,
      d.decision === "confirm" ? `Statement import confirmed by a second person: ${accepted} line(s) ingested (sha256 ${imp.fileSha256.slice(0, 12)}…); matching decided by the engine` : `Statement import declined: ${d.reason}`,
      { fileSha256: imp.fileSha256, importedBy: imp.importedBy, confirmedBy: ctx.userId, acceptedCount: accepted, outcomes, reason: d.reason });
    return { status: 200, body: { importId, status: d.decision === "confirm" ? "imported" : "declined", acceptedCount: accepted, outcomes } };
  }));
}

const ENGINE_FIELD_COLUMN: Record<string, StatementColumn> = {
  lineId: "line_id", accountRef: "account_ref", valueDate: "value_date", direction: "direction", kind: "kind",
  amountMinor: "amount", currency: "currency", reference: "reference", counterparty: "counterparty",
};
const engineFieldColumn = (f: string) => ENGINE_FIELD_COLUMN[f] ?? f;

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** This organisation's imports, newest first (no file contents: the file is never stored). */
export async function listImports(ctx: TenantContext) {
  require(ctx, "read");
  return tenantTx(ctx, async (tx) => {
    const rows = await tx.select({
      id: t.statementImports.id, fileName: t.statementImports.fileName, fileSha256: t.statementImports.fileSha256, sizeBytes: t.statementImports.sizeBytes,
      rowCount: t.statementImports.rowCount, acceptedCount: t.statementImports.acceptedCount, rejectedCount: t.statementImports.rejectedCount,
      status: t.statementImports.status, importedBy: t.statementImports.importedBy, importedByName: t.users.name, createdAt: t.statementImports.createdAt,
    }).from(t.statementImports).innerJoin(t.users, eq(t.users.id, t.statementImports.importedBy))
      .where(eq(t.statementImports.orgId, ctx.orgId)).orderBy(desc(t.statementImports.createdAt));
    return rows;
  });
}

/** The error report of one rejected import, as CSV (formula-safe). */
export async function importErrorReport(ctx: TenantContext, importId: string): Promise<{ body: string; sha256: string }> {
  require(ctx, "read");
  if (!z.uuid().safeParse(importId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, async (tx) => {
    const [row] = await tx.select().from(t.statementImports).where(and(eq(t.statementImports.orgId, ctx.orgId), eq(t.statementImports.id, importId)));
    if (!row) throw new AccessDenied(404, "Not found.");
    const body = importErrorReportCsv(((row.errors as { errors?: ImportError[] }).errors) ?? []);
    const digest = sha256Hex(body);
    await serverAudit(tx, ctx, "statement_import_error_report_exported", "statement_import", importId, `Import error report exported (sha256 ${digest.slice(0, 12)}…)`, { sha256: digest });
    return { body, sha256: digest };
  });
}

export interface EvidenceProvenanceItem {
  evidenceId: string;
  kind: string;
  lineId: string | null;
  provenance: "engine_action" | "seed_fictional" | "csv_import";
  importId: string | null;
  fileSha256: string | null;
  fileName: string | null;
  importedBy: string | null;
  importedByName: string | null;
  importedAt: Date | null;
  /** What the UI must show next to the line. */
  label: string;
}

/**
 * Where each piece of settlement evidence about one payment came from. Imported lines are labelled as imported
 * by a person from a file, never as an authenticated bank feed.
 */
export async function evidenceProvenance(ctx: TenantContext, intentId: string): Promise<EvidenceProvenanceItem[]> {
  require(ctx, "read");
  return tenantTx(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    if (!ws.intents.some((i) => i.id === intentId)) throw new AccessDenied(404, "Not found.");
    const lineIds = new Set<string>();
    for (const a of ws.allocations) if ((a.target as { intentId?: string }).intentId === intentId) lineIds.add(a.statementLineId);
    for (const e of ws.exceptions) if (e.intentId === intentId && e.statementLineId) lineIds.add(e.statementLineId);
    const evidenceIds = ws.evidence.filter((e) => e.intentId === intentId).map((e) => e.id);
    const ids = [...lineIds, ...evidenceIds];
    if (ids.length === 0) return [];
    const rows = await tx.select({
      id: t.settlementEvidence.id, kind: t.settlementEvidence.kind, provenance: t.settlementEvidence.provenance, importId: t.settlementEvidence.importId, record: t.settlementEvidence.record,
      fileSha256: t.statementImports.fileSha256, fileName: t.statementImports.fileName, importedBy: t.statementImports.importedBy, importedAt: t.statementImports.createdAt, importedByName: t.users.name,
    }).from(t.settlementEvidence)
      .leftJoin(t.statementImports, and(eq(t.statementImports.orgId, t.settlementEvidence.orgId), eq(t.statementImports.id, t.settlementEvidence.importId)))
      .leftJoin(t.users, eq(t.users.id, t.statementImports.importedBy))
      .where(and(eq(t.settlementEvidence.orgId, ctx.orgId), inArray(t.settlementEvidence.id, ids)))
      .orderBy(t.settlementEvidence.ord);
    return rows.map((r): EvidenceProvenanceItem => {
      const provenance = r.provenance as EvidenceProvenanceItem["provenance"];
      const label = provenance === "csv_import"
        ? `Imported by ${r.importedByName ?? "unknown user"} from ${r.fileSha256 ?? "unknown file"} — not an authenticated bank feed`
        : provenance === "seed_fictional" ? "Fictional seed data — not an authenticated bank feed" : "Recorded by a Clearline engine action";
      return {
        evidenceId: r.id, kind: r.kind, lineId: r.kind === "statement_line" ? String((r.record as { lineId?: string }).lineId ?? "") : null, provenance,
        importId: r.importId, fileSha256: r.fileSha256, fileName: r.fileName, importedBy: r.importedBy, importedByName: r.importedByName, importedAt: r.importedAt, label,
      };
    });
  });
}
