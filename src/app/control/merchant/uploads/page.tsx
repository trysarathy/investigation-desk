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
      <p className={s.lede} data-testid="pilot-upload-notice"><strong>Pilot: anonymised or sample files only until your data agreement is signed.</strong> Need files to try it? <a href="/control/merchant/getting-started#samples">Download sample files</a>.</p>

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
          <div className={s.tableWrap} role="region" aria-label="Uploads table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Entity</th><th scope="col">Status</th><th scope="col" className={s.num}>Accepted</th><th scope="col" className={s.num}>Warnings</th><th scope="col" className={s.num}>Rejected</th><th scope="col" className={s.num}>Duplicates</th><th scope="col">Uploaded by</th><th scope="col">Delete after</th></tr></thead>
              <tbody>
                {v.uploads.map((u) => (
                  <tr key={u.id} data-testid="upload-row">
                    <td><a href={`/control/merchant/uploads/${u.id}`}>{u.originalName}</a></td>
                    <td>{FILE_TYPE_LABELS[u.fileType]}</td>
                    <td className={s.mono}>{u.entityId}</td>
                    <td><Chip tone={tone(u.status)}>{statusLabel(u.status)}</Chip></td>
                    <td className={s.num}>{u.counts.accepted}</td><td className={s.num}>{u.counts.warning}</td><td className={s.num}>{u.counts.rejected}</td><td className={s.num}>{u.counts.duplicate}</td>
                    <td>{u.uploadedByName}</td>
                    <td>{u.deleteAfter.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className={`${s.small} ${m.cutoff}`}>Uploading never moves money. A provider&rsquo;s status in a file is a claim; imported bank statements are not bank-authenticated.</p>
    </>
  );
}
