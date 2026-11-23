/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { can } from "@/server/authz";
import { orNotFound } from "@/server/control-page";
import { merchantMember } from "@/server/merchant-page";
import { uploadWorkspace } from "@/server/upload-ui";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { FlashMessage } from "@/components/control/forms";
import { MappingForm } from "@/components/merchant/upload-forms";
import { Chip } from "@/components/merchant/ui";
import { fieldOf, type Mapping } from "@/lib/clearline/mapping";
import { DELIMITER_WORDS, ENCODING_WORDS, FILE_TYPE_LABELS, FORMAT_LABELS, statusLabel, warningText } from "@/lib/clearline/upload-words";

export const metadata: Metadata = { title: "Upload" };

const STEPS = ["Upload", "Preview", "Map columns", "Validate", "Confirm", "Reconcile"] as const;
const stepOf = (status: string, statement: boolean) => (status === "stored" ? (statement ? 3 : 2) : status === "mapped" ? 3 : status === "validated" ? 4 : 5);
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function MappingSummary({ mapping }: { mapping: Mapping }) {
  return (
    <dl className={m.facts} data-testid="mapping-summary">
      {Object.entries(mapping.columns).map(([k, c]) => (
        <div key={k} style={{ display: "contents" }}><dt>{fieldOf(mapping.fileType, k)?.label ?? k}</dt><dd>{c.header ?? c.headers?.join(" + ") ?? `fixed value “${c.constant}”`}{c.dateFormat ? ` · dates ${c.dateFormat}` : ""}{c.decimalSeparator ? ` · decimal “${c.decimalSeparator}”` : ""}</dd></div>
      ))}
    </dl>
  );
}

/** rc7: one upload, from preview to mapping (validation, confirmation and reconciliation follow on the same page). */
export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await merchantMember();
  const w = await orNotFound(uploadWorkspace(ctx, (await params).id));
  const u = w.upload, p = w.preview;
  const statement = u.fileFormat === "mt940" || u.fileFormat === "camt053";
  const mayMap = can(ctx.role, "merchant_upload") && ["stored", "mapped", "validated"].includes(u.status) && !statement;
  const step = stepOf(u.status, statement);
  const exact = w.suggestion?.exact ?? null;
  return (
    <>
      <p className={s.small}><a href="/control/merchant/uploads">← All uploads</a></p>
      <h1 className={s.title}>{u.originalName}</h1>
      <p className={s.lede}>{FILE_TYPE_LABELS[u.fileType]} for {w.entity.name} ({u.entityId}) · uploaded by {w.uploadedByName} · <Chip tone="plain" testId="upload-status">{statusLabel(u.status)}</Chip></p>
      <ol className={m.steps} aria-label="Steps">{STEPS.map((x, i) => <li key={x} aria-current={i === step ? "step" : undefined}>{i + 1}. {x}</li>)}</ol>
      <FlashMessage flashKey={`upload:${u.id}`} />
      <FlashMessage flashKey={`mapping:${u.id}`} />

      <section className={s.section} aria-labelledby="read">
        <h2 className={s.h2} id="read">What Clearline read</h2>
        <div className={s.panel}>
          <dl className={m.facts} data-testid="file-facts">
            <dt>Format</dt><dd>{FORMAT_LABELS[u.fileFormat] ?? u.fileFormat}{p.sheet ? `, sheet “${p.sheet}”${p.sheets && p.sheets.length > 1 ? ` (of ${p.sheets.length})` : ""}` : ""}</dd>
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
        {statement ? <p className={s.small}>MT940 and camt.053 statements need no column mapping: the statement format says which value is which.</p>
          : mayMap && w.suggestion ? (
            <>
              {u.mapping ? <p className={s.small}>Mapped{w.templateName ? ` with template “${w.templateName}” v${u.templateVersion}` : ""}. You can change it until the upload is confirmed; changing it clears the validation report.</p> : null}
              <MappingForm uploadId={u.id} fileType={u.fileType} headers={p.headers} rows={p.rows} suggestion={w.suggestion.suggestion} current={u.mapping}
                exact={exact ? { id: exact.id, name: exact.name, version: exact.version, mapping: exact.mapping } : null} currency={w.entity.currency} entityName={w.entity.name} />
            </>
          ) : u.mapping ? <MappingSummary mapping={u.mapping} /> : <p className={s.small}>Not mapped yet. Finance or Payment Operations map the columns.</p>}
      </section>
    </>
  );
}
