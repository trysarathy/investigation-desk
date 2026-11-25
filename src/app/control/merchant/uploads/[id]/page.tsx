/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { can } from "@/server/authz";
import { orNotFound } from "@/server/control-page";
import { merchantMember } from "@/server/merchant-page";
import { uploadWorkspace } from "@/server/upload-ui";
import { validationReport } from "@/server/uploads";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { FlashMessage } from "@/components/control/forms";
import { MappingForm } from "@/components/merchant/upload-forms";
import { RunReconciliation } from "@/components/merchant/forms";
import { DeleteUpload, NormaliseUpload, UploadDecisionForm, ValidateUpload } from "@/components/merchant/upload-review-forms";
import { Chip, Empty, one, q } from "@/components/merchant/ui";
import { fieldOf, type Mapping } from "@/lib/clearline/mapping";
import { DELIMITER_WORDS, ENCODING_WORDS, FILE_TYPE_LABELS, FORMAT_LABELS, bankAccountLabel, isStatementFormat, reasonText, statusLabel, warningText } from "@/lib/clearline/upload-words";

export const metadata: Metadata = { title: "Upload" };

const STEPS = ["Upload", "Preview", "Map columns", "Validate", "Confirm", "Reconcile"] as const;
const stepOf = (status: string, statement: boolean) => (status === "stored" ? (statement ? 3 : 2) : status === "mapped" ? 3 : status === "validated" ? 4 : 5);
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function MappingSummary({ mapping }: { mapping: Mapping }) {
  return (
    <dl className={m.facts} data-testid="mapping-summary">
      {Object.entries(mapping.columns).map(([k, c]) => (
        <div key={k} style={{ display: "contents" }}><dt>{fieldOf(mapping.fileType, k)?.label ?? k}</dt><dd>{c.derive ? "worked out from the network and token symbol (configured tokens)" : c.header ?? c.headers?.join(" + ") ?? `fixed value “${c.constant}”`}{c.dateFormat ? ` · dates ${c.dateFormat}` : ""}{c.decimalSeparator ? ` · decimal “${c.decimalSeparator}”` : ""}{c.deductionSign === "negative" ? " · refunds and fees negative" : ""}</dd></div>
      ))}
    </dl>
  );
}

/** rc7: one upload, from preview and mapping to the validation report, confirmation (a second person for bank statements) and reconciliation. */
const ROW_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "amber" | "plain" }> = {
  accepted: { label: "Accepted", tone: "ok" }, warning: { label: "Accepted with a warning", tone: "amber" }, rejected: { label: "Rejected", tone: "warn" }, duplicate: { label: "Duplicate (already imported)", tone: "plain" },
};
const PAGE_SIZE = 50;

export default async function UploadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx } = await merchantMember();
  const sp = await searchParams;
  const w = await orNotFound(uploadWorkspace(ctx, (await params).id));
  const u = w.upload, p = w.preview;
  const statement = isStatementFormat(u.fileFormat);
  const mayMap = can(ctx.role, "merchant_upload") && ["stored", "mapped", "validated"].includes(u.status) && !statement;
  const step = stepOf(u.status, statement);
  const exact = w.suggestion?.exact ?? null;
  const filter = ["accepted", "warning", "rejected", "duplicate"].includes(one(sp.status) ?? "") ? (one(sp.status) as "accepted" | "warning" | "rejected" | "duplicate") : undefined;
  const pageNo = Math.min(100_000, Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  const report = u.rowsSha256 ? await validationReport(ctx, u.id, { page: pageNo, pageSize: PAGE_SIZE, status: filter }) : null;
  const pages = report ? Math.max(1, Math.ceil(report.total / PAGE_SIZE)) : 1;
  const bank = u.fileType === "bank_statement";
  const isUploader = u.uploadedBy === ctx.userId;
  const mayDecide = u.status === "validated" && (bank ? can(ctx.role, "confirm_import") && !isUploader : can(ctx.role, "merchant_upload"));
  const mayValidate = can(ctx.role, "merchant_upload") && (u.status === "mapped" || u.status === "validated" || (u.status === "stored" && statement));
  const mayNormalise = u.status === "confirmed" && (can(ctx.role, "merchant_upload") || can(ctx.role, "confirm_import"));
  const mayDelete = can(ctx.role, "merchant_upload") && !["confirmed", "normalised"].includes(u.status);
  const href = (x: Record<string, string | undefined>) => `/control/merchant/uploads/${u.id}${q(x)}#report`;
  const fieldLabel = (f: string) => fieldOf(u.fileType, f)?.label ?? f.replace(/_/g, " ");
  return (
    <>
      <p className={s.small}><a href="/control/merchant/uploads">← All uploads</a></p>
      <h1 className={s.title}>{u.originalName}</h1>
      <p className={s.lede}>{FILE_TYPE_LABELS[u.fileType]} for {w.entity.name} ({u.entityId}){w.bankAccount ? <> · bank account <span data-testid="upload-bank-account">{bankAccountLabel(w.bankAccount)}</span></> : bank ? " · no bank account recorded (uploaded before accounts existed)" : ""} · uploaded by {w.uploadedByName} · <Chip tone="plain" testId="upload-status">{statusLabel(u.status)}</Chip></p>
      <ol className={m.steps} aria-label="Steps">{STEPS.map((x, i) => <li key={x} aria-current={i === step ? "step" : undefined}>{i + 1}. {x}</li>)}</ol>
      <FlashMessage flashKey={`upload:${u.id}`} />
      <FlashMessage flashKey={`mapping:${u.id}`} />
      <FlashMessage flashKey={`validate:${u.id}`} />

      <section className={s.section} aria-labelledby="read">
        <h2 className={s.h2} id="read">What Clearline read</h2>
        <div className={s.panel}>
          <dl className={m.facts} data-testid="file-facts">
            <dt>Format</dt><dd>{FORMAT_LABELS[u.fileFormat] ?? u.fileFormat}{p.sheet ? `, sheet “${p.sheet}”${p.sheets && p.sheets.length > 1 ? ` (of ${p.sheets.length})` : ""}` : ""}</dd>
            {p.list ? <><dt>Records read from</dt><dd data-testid="json-list">the list “{p.list}”{p.lists && p.lists.length > 1 ? ` (chosen at upload, of ${p.lists.length} lists: ${p.lists.map((x) => `“${x}”`).join(", ")})` : ""}</dd></> : null}
            {p.encoding ? <><dt>Text encoding</dt><dd>{ENCODING_WORDS[p.encoding] ?? p.encoding}{p.bom ? ", with a byte-order mark (removed)" : ""}</dd></> : null}
            {p.delimiter ? <><dt>Columns separated by</dt><dd>{DELIMITER_WORDS[p.delimiter] ?? p.delimiter}</dd></> : null}
            {p.headerRow ? <><dt>Header row</dt><dd>Row {p.headerRow}</dd></> : null}
            <dt>Rows</dt><dd>{p.totalRows.toLocaleString("en-GB")} {statement ? "statement entries" : "data rows"}{p.excludedRows ? `; ${p.excludedRows} total row${p.excludedRows === 1 ? "" : "s"} left out` : ""}</dd>
            <dt>Decimals and dates</dt><dd>{statement ? "Read by the statement format itself." : "Decided per column in the mapping below; where the first rows cannot decide, you choose."}</dd>
            <dt>Size</dt><dd>{kb(u.byteSize)}{u.encrypted ? ", stored encrypted" : ""}; deleted after {u.deleteAfter.slice(0, 10)}</dd>
          </dl>
          {p.warnings.length ? <ul className={s.small} data-testid="read-warnings">{[...new Set(p.warnings)].map((x) => <li key={x}>{warningText(x)}</li>)}</ul> : null}
        </div>
        <h3 className={s.h3} id="preview-h">First {Math.min(20, p.rows.length)} rows</h3>
        {p.rows.length === 0 ? <p className={s.small}>The file has no data rows.</p> : (
          <div className={s.tableWrap} role="region" aria-label={`First ${Math.min(20, p.rows.length)} rows of ${u.originalName}`} tabIndex={0} data-testid="preview">
            <table className={s.table}>
              <thead><tr><th scope="col">#</th>{p.headers.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
              <tbody>{p.rows.map((r, i) => <tr key={i}><td className={s.num}>{i + 1}</td>{r.map((c, j) => <td key={j} className={m.cell} title={c.length > 28 ? c : undefined}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={s.section} aria-labelledby="map">
        <h2 className={s.h2} id="map">Map columns</h2>
        {statement ? <p className={s.small}>MT940, camt.053, camt.054 and BAI2 statements need no column mapping: the statement format says which value is which.</p>
          : mayMap && w.suggestion ? (
            <>
              {u.mapping ? <p className={s.small}>Mapped{w.templateName ? ` with template “${w.templateName}” v${u.templateVersion}` : ""}. You can change it until the upload is confirmed; changing it clears the validation report.</p> : null}
              <MappingForm uploadId={u.id} fileType={u.fileType} headers={p.headers} rows={p.rows} suggestion={w.suggestion.suggestion} current={u.mapping}
                exact={exact ? { id: exact.id, name: exact.name, version: exact.version, mapping: exact.mapping } : null} currency={w.entity.currency} entityName={w.entity.name} />
            </>
          ) : u.mapping ? <MappingSummary mapping={u.mapping} /> : <p className={s.small}>Not mapped yet. Finance or Payment Operations map the columns.</p>}
      </section>

      <section className={s.section} aria-labelledby="report">
        <h2 className={s.h2} id="report">Validation report</h2>
        {mayValidate ? <ValidateUpload uploadId={u.id} again={!!report} /> : null}
        {!report ? <Empty>{statement || u.mapping ? "Not validated yet. Validation reads every row and says which are accepted, which have warnings, which are rejected and why, and which were already imported." : "Map the columns first; then every row is validated."}</Empty> : (
          <>
            <ul className={m.kpis} data-testid="report-counts">
              <li className={m.kpi}><span className={m.kpiValue}>{u.counts.rows}</span><span className={m.kpiLabel}>Rows</span></li>
              <li className={m.kpi}><span className={m.kpiValue}>{u.counts.accepted}</span><span className={m.kpiLabel}>Accepted</span></li>
              <li className={m.kpi}><span className={m.kpiValue}>{u.counts.warning}</span><span className={m.kpiLabel}>Accepted with a warning</span></li>
              <li className={m.kpi}><span className={m.kpiValue}>{u.counts.rejected}</span><span className={m.kpiLabel}>Rejected</span></li>
              <li className={m.kpi}><span className={m.kpiValue}>{u.counts.duplicate}</span><span className={m.kpiLabel}>Duplicates</span></li>
            </ul>
            {u.notes.length ? <ul className={s.small} data-testid="report-notes">{u.notes.map((x) => <li key={x}>{warningText(x)}</li>)}</ul> : null}
            <nav aria-label="Filter rows by status" className={m.filterLinks}>
              <a href={href({})} aria-current={!filter ? "true" : undefined}>All rows</a>
              {Object.entries(ROW_STATUS).map(([k, v]) => <a key={k} href={href({ status: k })} aria-current={filter === k ? "true" : undefined}>{v.label}</a>)}
            </nav>
            <p className={s.small} role="status" data-testid="report-range">{report.total === 0 ? "No rows with this status." : `Rows ${(pageNo - 1) * PAGE_SIZE + 1}–${Math.min(report.total, pageNo * PAGE_SIZE)} of ${report.total}${filter ? ` (${ROW_STATUS[filter].label.toLowerCase()})` : ""}.`} Reasons name the field, never the value.</p>
            {report.rows.length ? (
              <div className={s.tableWrap} role="region" aria-label="Validation report rows" tabIndex={0}>
                <table className={s.table}>
                  <thead><tr><th scope="col" className={s.num}>Row in file</th><th scope="col">Status</th><th scope="col">Reason</th></tr></thead>
                  <tbody>{report.rows.map((r) => {
                    const codes = (r.reasonCodes as { field?: string; code: string; level: string }[]) ?? [];
                    return (
                      <tr key={r.rowNumber} data-testid="report-row">
                        <td className={s.num}>{r.rowNumber}</td>
                        <td><Chip tone={ROW_STATUS[r.status]?.tone ?? "plain"}>{ROW_STATUS[r.status]?.label ?? r.status}</Chip></td>
                        <td>{r.status === "duplicate" ? "The same row is already in another upload of this entity and file type; it is not imported twice." : codes.length === 0 ? "—" : (
                          <ul className={m.reasons}>{codes.map((c, i) => <li key={i}>{c.level === "warning" ? "Warning: " : ""}{c.field ? `${fieldLabel(c.field)} ` : ""}{reasonText(c.code)}.</li>)}</ul>
                        )}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            ) : null}
            {pages > 1 ? (
              <nav aria-label="Report pages" className={m.filterLinks}>
                {pageNo > 1 ? <a href={href({ status: filter, page: String(pageNo - 1) })}>Previous page</a> : null}
                <span className={s.small}>Page {pageNo} of {pages}</span>
                {pageNo < pages ? <a href={href({ status: filter, page: String(pageNo + 1) })}>Next page</a> : null}
              </nav>
            ) : null}
            <p className={s.small}>No downloadable error report is offered: the report lists row numbers and reasons only, so it can be kept without the file&rsquo;s contents.</p>
          </>
        )}
      </section>

      <section className={s.section} aria-labelledby="confirm">
        <h2 className={s.h2} id="confirm">Confirm and reconcile</h2>
        <FlashMessage flashKey={`decision:${u.id}`} />
        <FlashMessage flashKey={`normalise:${u.id}`} />
        {u.status === "validated" ? (
          <div className={s.panel}>
            {bank ? <p data-testid="second-person">{isUploader || !can(ctx.role, "confirm_import") ? <strong>Waiting for a second person (an Approver who did not upload it).</strong> : <strong>You are the second person: you did not upload this statement.</strong>} Bank statements are confirmed by an Approver other than the person who uploaded them{isUploader ? "; you uploaded this one, so you cannot confirm it" : ""}. Imported statements stay &ldquo;imported, not bank-authenticated&rdquo;.</p> : null}
            {mayDecide ? <UploadDecisionForm uploadId={u.id} contentSha256={u.contentSha256} rowsSha256={u.rowsSha256!} importable={u.counts.accepted + u.counts.warning} bank={bank} />
              : !bank ? <p className={s.small}>Finance or Payment Operations confirm this upload.</p> : null}
          </div>
        ) : u.status === "confirmed" ? (
          <div className={s.panel}>
            <p>Confirmed by {w.confirmedByName}. {u.counts.accepted + u.counts.warning} row(s) are ready to be brought into reconciliation.</p>
            {mayNormalise ? <NormaliseUpload uploadId={u.id} /> : <p className={s.small}>Finance, Payment Operations or an Approver bring it into reconciliation.</p>}
          </div>
        ) : u.status === "normalised" ? (
          <div className={s.panel} data-testid="in-reconciliation">
            <p>In reconciliation{w.confirmedByName ? ` (confirmed by ${w.confirmedByName})` : ""}. Run reconciliation for {w.entity.name} to match it with the other records, then read the <a href={`/control/merchant${q({ entity: u.entityId })}`}>daily report</a> or the <a href={`/control/merchant/payments${q({ entity: u.entityId })}`}>payments</a>.</p>
            {can(ctx.role, "merchant_reconcile") ? <RunReconciliation entityId={u.entityId} entityName={w.entity.name} /> : <p className={s.small}>Payment Operations or Finance run reconciliation.</p>}
          </div>
        ) : u.status === "rejected" ? <p>Declined{w.confirmedByName ? ` by ${w.confirmedByName}` : ""}: nothing from this file is imported.</p>
          : <p className={s.small}>Validate the upload first; then it can be confirmed.</p>}
        {mayDelete ? <><h3 className={s.h3}>Delete this upload</h3><DeleteUpload uploadId={u.id} name={u.originalName} /></> : u.status === "confirmed" || u.status === "normalised" ? <p className={s.small}>Confirmed data is deleted on the retention schedule, on {u.deleteAfter.slice(0, 10)}.</p> : null}
      </section>
    </>
  );
}
