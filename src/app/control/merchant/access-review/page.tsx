import { Fragment } from "react";
import type { Metadata } from "next";
import { can } from "@/server/authz";
import { merchantPage } from "@/server/merchant-page";
import { accessReview, invitedLabel, MFA_LABEL, scopeLabel } from "@/server/access-review";
import s from "@/components/control/control.module.css";
import x from "@/components/control/screens.module.css";
import { Empty } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";
import { AccessTable } from "@/components/merchant/admin-tables";

export const metadata: Metadata = { title: "Access review" };

const IconDownload = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2M2.8 13.5h10.4" />
  </svg>
);

/**
 * v1 phase 1.4: who has access to what — every membership of this organisation with its role, entity scope, second
 * factor (when recorded), when it was granted, the last sign-in and who invited the member. For a merchant Admin, or a
 * Provider Admin for the provider's own members; downloadable as CSV and PDF for an auditor (each download audited).
 */
export default async function AccessReviewPage() {
  const { ctx } = await merchantPage();
  if (!can(ctx.role, "access_review") || ctx.entityScope !== null) {
    return (<><div className={x.head}><div className={x.headText}><h1 className={s.title}>Access review</h1></div></div><Empty>Only an Admin with access to every entity of this organisation reviews access.</Empty></>);
  }
  const v = await accessReview(ctx);
  const active = v.rows.filter((r) => r.status === "active").length;
  return (
    <>
      <div className={x.head}>
        <div className={x.headText}>
          <h1 className={s.title}>Access review</h1>
          <p>Who has access to {v.organisation.name}, in which role and for which entities. Generated <span className={x.mono}>{when(v.generatedAt)}</span>. Roles and entity limits are changed with the administration command; this page changes nothing.</p>
        </div>
        <div className={x.headTools}>
          {/* plain links: each is a file download (audited on the server), not a page */}
          <a className={x.linkButton} href="/api/control/merchant/access-review/export?format=csv" download data-testid="export-csv"><IconDownload />Download CSV</a>
          <a className={x.linkButton} href="/api/control/merchant/access-review/export?format=pdf" download data-testid="export-pdf"><IconDownload />Download PDF</a>
        </div>
      </div>
      <p className={x.note} data-testid="review-summary">{active} active and {v.rows.length - active} revoked membership(s).{" "}
        Second factor: the authenticator app (required for Admins and Approvers), with any passkeys counted apart.</p>
      <p className={x.note}>The downloads are for an auditor; every download is recorded in the audit log.</p>

      <section className={x.section} aria-labelledby="access-h">
        <div className={x.sectionHead}><h2 id="access-h">Memberships <span className={x.count}>({v.rows.length})</span></h2></div>
        {v.rows.length === 0 ? <Empty>No memberships.</Empty> : (
          <AccessTable rows={v.rows.map((r) => ({
            userId: r.userId, name: r.name, email: r.email, roleLabel: r.roleLabel, revoked: r.status === "revoked" ? when(r.revokedAt) : null,
            scope: scopeLabel(r.entityScope), scopeLimited: r.entityScope !== "all",
            mfa: `${MFA_LABEL[r.mfa]}${r.passkeys ? ` (+${r.passkeys} passkey${r.passkeys === 1 ? "" : "s"})` : ""}`,
            granted: when(r.grantedAt), lastSignIn: r.lastSignInAt ? when(r.lastSignInAt) : "Not recorded", invitedBy: invitedLabel(r.invitedBy),
          }))} />
        )}
      </section>
      {v.entities.length ? (
        <section className={x.section} aria-labelledby="entities-h">
          <div className={x.sectionHead}><h2 id="entities-h">Entities <span className={x.count}>({v.entities.length})</span></h2></div>
          <dl className={`${x.kv} ${x.card}`}>{v.entities.map((e) => <Fragment key={e.id}><dt className={x.mono}>{e.id}</dt><dd>{e.name}</dd></Fragment>)}</dl>
        </section>
      ) : null}
    </>
  );
}
