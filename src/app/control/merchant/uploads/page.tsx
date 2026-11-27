import { usesUploadPipeline } from "@/lib/clearline/data-mode";
import type { Metadata } from "next";
import { can, ROLE_LABELS } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { uploadsOverview } from "@/server/upload-ui";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { UploadForm } from "@/components/merchant/upload-forms";
import { FlashMessage } from "@/components/control/forms";
import { Chip, Empty } from "@/components/merchant/ui";
import { FILE_TYPE_LABELS, statusLabel } from "@/lib/clearline/upload-words";
import Link from "next/link";
import { Mono } from "@/components/ui";
import { StaticTable } from "@/components/merchant/StaticTable";
import g from "@/components/merchant/screens-g2.module.css";

export const metadata: Metadata = { title: "Uploads" };

const tone = (st: string) => (st === "normalised" || st === "confirmed" ? "ok" : st === "rejected" ? "warn" : st === "validated" ? "amber" : "plain");

/** rc7: the merchant's own files. Finance and Payment Operations upload; everyone in the merchant reads the list. */
export default async function UploadsPage() {
  const { ctx } = await merchantMember();
  const v = await uploadsOverview(ctx);
  const mayUpload = can(ctx.role, "merchant_upload");
  return (
    <>
      <h1 className={s.title}>Uploads</h1>
      <p className={s.lede}>Bring in your own files: provider exports, settlement reports, orders or invoices, and bank statements. You map the columns once, check the validation report, and confirm before anything reaches reconciliation.</p>
      <FlashMessage flashKey="upload:deleted" />
      <p className={s.lede} data-testid="pilot-upload-notice"><strong>Pilot: anonymised or sample files only until your data agreement is signed.</strong> Need files to try it? <Link href="/control/merchant/getting-started#samples">Download sample files</Link>.</p>

      <section className={s.section} aria-labelledby="new-upload">
        <h2 className={s.h2} id="new-upload">Upload a file</h2>
        {!usesUploadPipeline(v.dataMode) ? (
          <Empty>This organisation holds sample data ({v.label}). Files are uploaded to your live organisation, where they are shown as &ldquo;Your data&rdquo;.</Empty>
        ) : !mayUpload ? (
          <p className={s.small} data-testid="read-only-note">Finance or Payment Operations upload files. Your role ({ROLE_LABELS[ctx.role]}) can read the list below.</p>
        ) : v.entities.length === 0 ? (
          <Empty>No entities are set up yet, so there is nothing to upload a file for.</Empty>
        ) : (
          <div className={s.panel}><UploadForm entities={v.entities} bankAccounts={v.bankAccounts} /></div>
        )}
      </section>

      <section className={s.section} aria-labelledby="list">
        <h2 className={s.h2} id="list">Your uploads</h2>
        <p className={s.small}>Each file and the data derived only from it are deleted after {v.retentionDays} days (the delete-after date is set when the file is uploaded).</p>
        {v.uploads.length === 0 ? <Empty>No uploads yet.{mayUpload && usesUploadPipeline(v.dataMode) ? " Upload a file above to start." : ""}</Empty> : (
          <div role="region" aria-label="Uploads table" tabIndex={0} className={g.region}>
            <StaticTable label="Uploads" filterLabel="Filter uploads"
              columns={[
                { id: "file", header: "File", sortable: true, hideable: false, rowHeader: true },
                { id: "type", header: "Type", sortable: true },
                { id: "entity", header: "Entity", sortable: true },
                { id: "status", header: "Status", sortable: true },
                { id: "accepted", header: "Accepted", numeric: true, sortable: true },
                { id: "warning", header: "Warnings", numeric: true, sortable: true },
                { id: "rejected", header: "Rejected", numeric: true, sortable: true },
                { id: "duplicate", header: "Duplicates", numeric: true, sortable: true },
                { id: "by", header: "Uploaded by", sortable: true },
                { id: "deleteAfter", header: "Delete after", sortable: true },
              ]}
              rows={v.uploads.map((u) => ({
                key: u.id, testId: "upload-row",
                sort: { file: u.originalName, type: FILE_TYPE_LABELS[u.fileType], entity: u.entityId, status: statusLabel(u.status), accepted: u.counts.accepted, warning: u.counts.warning, rejected: u.counts.rejected, duplicate: u.counts.duplicate, by: u.uploadedByName, deleteAfter: u.deleteAfter.slice(0, 10) },
                cells: {
                  file: <Link href={`/control/merchant/uploads/${u.id}`} prefetch={false}>{u.originalName}</Link>,
                  type: FILE_TYPE_LABELS[u.fileType],
                  entity: <Mono>{u.entityId}</Mono>,
                  status: <Chip tone={tone(u.status)}>{statusLabel(u.status)}</Chip>,
                  accepted: u.counts.accepted, warning: u.counts.warning, rejected: u.counts.rejected, duplicate: u.counts.duplicate,
                  by: u.uploadedByName,
                  deleteAfter: <Mono>{u.deleteAfter.slice(0, 10)}</Mono>,
                },
              }))} />
          </div>
        )}
      </section>
      <p className={`${s.small} ${m.cutoff}`}>Uploading never moves money. A provider&rsquo;s status in a file is a claim; imported bank statements are not bank-authenticated.</p>
    </>
  );
}
