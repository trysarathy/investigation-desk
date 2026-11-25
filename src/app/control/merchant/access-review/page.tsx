import type { Metadata } from "next";
import { can } from "@/server/authz";
import { merchantPage } from "@/server/merchant-page";
import { accessReview, invitedLabel, MFA_LABEL, scopeLabel } from "@/server/access-review";
import s from "@/components/control/control.module.css";
import { Chip, Empty } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Access review" };

/**
 * v1 phase 1.4: who has access to what — every membership of this organisation with its role, entity scope, second
 * factor (when recorded), when it was granted, the last sign-in and who invited the member. For a merchant Admin, or a
 * Provider Admin for the provider's own members; downloadable as CSV and PDF for an auditor (each download audited).
 */
export default async function AccessReviewPage() {
  const { ctx } = await merchantPage();
  if (!can(ctx.role, "access_review") || ctx.entityScope !== null) {
    return (<><h1 className={s.title}>Access review</h1><Empty>Only an Admin with access to every entity of this organisation reviews access.</Empty></>);
  }
  const v = await accessReview(ctx);
  const active = v.rows.filter((r) => r.status === "active").length;
  return (
    <>
      <h1 className={s.title}>Access review</h1>
      <p className={s.lede}>Who has access to {v.organisation.name}, in which role and for which entities. Generated {when(v.generatedAt)}. Roles and entity limits are changed with the administration command; this page changes nothing.</p>
      <p className={s.small} data-testid="review-summary">{active} active and {v.rows.length - active} revoked membership(s).{" "}
        Second factor: the authenticator app (required for Admins and Approvers), with any passkeys counted apart.</p>
      <p className={s.small}>
        <a href="/api/control/merchant/access-review/export?format=csv" download data-testid="export-csv">Download CSV</a>{" · "}
        <a href="/api/control/merchant/access-review/export?format=pdf" download data-testid="export-pdf">Download PDF</a>{" "}
        (for an auditor; every download is recorded in the audit log)
      </p>

      <section className={s.section} aria-labelledby="access-h">
        <h2 className={s.h2} id="access-h">Memberships ({v.rows.length})</h2>
        {v.rows.length === 0 ? <Empty>No memberships.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Access review table" tabIndex={0}>
            <table className={s.table}>
              <caption>Members, roles, entity scope, second factor, access dates and inviter</caption>
              <thead><tr>
                <th scope="col">Member</th><th scope="col">Role</th><th scope="col">Entity scope</th><th scope="col">Second factor</th>
                <th scope="col">Access granted</th><th scope="col">Last sign-in</th><th scope="col">Invited by</th>
              </tr></thead>
              <tbody>
                {v.rows.map((r) => (
                  <tr key={r.userId} data-testid="access-row">
                    <td><strong>{r.name}</strong><br /><span className={s.small}>{r.email}</span></td>
                    <td>{r.roleLabel}{r.status === "revoked" ? <> <Chip tone="warn">Revoked {when(r.revokedAt)}</Chip></> : null}</td>
                    <td data-testid="access-scope">{r.entityScope === "all" ? scopeLabel(r.entityScope) : <Chip tone="info">{scopeLabel(r.entityScope)}</Chip>}</td>
                    <td data-testid="access-mfa">{MFA_LABEL[r.mfa]}{r.passkeys ? ` (+${r.passkeys} passkey${r.passkeys === 1 ? "" : "s"})` : ""}</td>
                    <td>{when(r.grantedAt)}</td>
                    <td>{r.lastSignInAt ? when(r.lastSignInAt) : "Not recorded"}</td>
                    <td>{invitedLabel(r.invitedBy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {v.entities.length ? (
        <section className={s.section} aria-labelledby="entities-h">
          <h2 className={s.h2} id="entities-h">Entities</h2>
          <ul className={s.small}>{v.entities.map((e) => <li key={e.id}><span className={s.mono}>{e.id}</span> — {e.name}</li>)}</ul>
        </section>
      ) : null}
    </>
  );
}
