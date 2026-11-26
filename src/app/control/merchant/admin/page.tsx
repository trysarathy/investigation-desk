import type { Metadata } from "next";
import { can, isAppRole, ROLE_LABELS } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { auditLogPage, listOrgUsers } from "@/server/org-admin";
import { MFA_LABEL, scopeLabel } from "@/server/access-review";
import { membersView } from "@/server/onboarding/members";
import { MEMBER_ROLES } from "@/server/onboarding/wizard";
import s from "@/components/control/control.module.css";
import { DeactivateMember, RevokeSessions } from "@/components/merchant/forms";
import { ActionButton, JsonForm } from "@/components/onboarding/forms";
import { Chip, Empty, one } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

const API = "/api/control/merchant/admin/member-actions";
const roleLabel = (r: string) => (isAppRole(r) ? ROLE_LABELS[r] : r);

export const metadata: Metadata = { title: "Admin" };

/**
 * The organisation Admin's page: who has access (role, status, second factor, last sign-in), invite a member by link
 * with a role, revoke a pending invitation, deactivate a member, sign a member out everywhere, and the audit log (ids
 * only). Managing members needs an Admin with access to every entity (w1-31); a scoped Admin sees the audit log only.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx } = await merchantMember();
  if (!can(ctx.role, "manage_members")) {
    return (<><h1 className={s.title}>Admin</h1><Empty>Only an Admin of this organisation sees this page.</Empty></>);
  }
  const before = Number(one((await searchParams).before) ?? "");
  const unscoped = ctx.entityScope === null;
  const [view, users, audit] = await Promise.all([unscoped ? membersView(ctx) : null, listOrgUsers(ctx), auditLogPage(ctx, Number.isInteger(before) && before > 0 ? { before } : {})]);
  const sessions = new Map(users.map((u) => [u.userId, u.activeSessions]));
  const canWrite = view?.invitations != null;
  return (
    <>
      <h1 className={s.title}>Admin</h1>
      <p className={s.lede}>Members of {ctx.orgName}: who has access, invitations, and the audit log. An Admin manages members but holds no financial authority. Admins and Approvers must set up multi-factor sign-in before they can use Clearline, and nobody approves their own request.</p>

      {view === null ? (
        <section className={s.section} aria-labelledby="members-h">
          <h2 className={s.h2} id="members-h">Members</h2>
          <Empty>Your access is limited to some entities, so you do not manage members. An Admin with access to every entity does.</Empty>
        </section>
      ) : (
        <>
          <section className={s.section} aria-labelledby="members-h">
            <h2 className={s.h2} id="members-h">Who has access ({view.members.filter((m) => m.status === "active").length} active)</h2>
            <div className={s.tableWrap} role="region" aria-label="Members table" tabIndex={0}>
              <table className={s.table}>
                <caption>Members, roles, status, second factor and last sign-in</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Entities</th><th scope="col">Second factor</th><th scope="col">Last sign-in</th><th scope="col" className={s.num}>Active sessions</th><th scope="col">Action</th></tr></thead>
                <tbody>
                  {view.members.map((u) => {
                    const you = u.userId === ctx.userId;
                    const n = sessions.get(u.userId) ?? 0;
                    return (
                      <tr key={u.userId} data-testid="member-row">
                        <td>{u.name}{you ? " (you)" : ""}</td>
                        <td>{u.email}</td>
                        <td>{u.roleLabel}</td>
                        <td>{u.status === "revoked" ? <Chip tone="warn">Deactivated</Chip> : "Active"}</td>
                        <td>{scopeLabel(u.entityScope)}</td>
                        <td>{MFA_LABEL[u.mfa]}{u.passkeys ? ` +${u.passkeys} passkey${u.passkeys === 1 ? "" : "s"}` : ""}</td>
                        <td>{u.lastSignInAt ? when(u.lastSignInAt) : "Never recorded"}</td>
                        <td className={s.num}>{n}</td>
                        <td>{you || u.status === "revoked" ? "—" : (
                          <>
                            {canWrite ? <DeactivateMember userId={u.userId} name={u.name} /> : null}
                            {n > 0 ? <RevokeSessions userId={u.userId} name={u.name} /> : null}
                          </>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={s.section} aria-labelledby="invite-h">
            <h2 className={s.h2} id="invite-h">Invite a member</h2>
            {!canWrite ? <Empty>Inviting and deactivating members is not available on this deployment (no provisioning connection). The operator&rsquo;s administration command grants roles.</Empty> : (
              <>
                <p className={s.small}>The person gets a one-time link to choose their name and password. With no email provider on this deployment, the link is shown to you once, right after you submit: copy it and send it to them yourself. It works once and expires after 72 hours. Choose the least role that fits: Finance prepares, an Approver approves (never their own request), a Viewer only reads.</p>
                <div className={s.panel}>
                  <JsonForm flashKey="admin:invite" url={`${API}/invite`} submit="Create invitation link" success="Sent: the invitation email is on its way."
                    fields={[
                      { name: "email", label: "Email", type: "email", required: true, maxLength: 254 },
                      { name: "role", label: "Role", type: "select", required: true, options: MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })), defaultValue: "finance" },
                    ]} />
                </div>
                <h3 className={s.label}>Pending invitations</h3>
                {view.invitations!.length === 0 ? <Empty>No pending invitation.</Empty> : (
                  <div className={s.tableWrap} role="region" aria-label="Pending invitations table" tabIndex={0}>
                    <table className={s.table}>
                      <caption>Pending invitations (a link is shown only when it is created)</caption>
                      <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Expires</th><th scope="col">Action</th></tr></thead>
                      <tbody>
                        {view.invitations!.map((x) => (
                          <tr key={x.id} data-testid="invitation-row">
                            <td>{x.email}</td><td>{roleLabel(x.role)}</td><td>{x.expired ? "Expired" : when(x.expiresAt)}</td>
                            <td><ActionButton flashKey={`admin:revoke:${x.id}`} url={`${API}/revoke-invitation`} body={{ invitationId: x.id }} label={`Revoke invitation for ${x.email}`} success="Saved: the invitation was revoked; its link no longer works." variant="secondary" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      <section className={s.section} aria-labelledby="audit-h">
        <h2 className={s.h2} id="audit-h">Audit log</h2>
        <p className={s.small}>Newest first, 50 per page. Ids and actions only; what a person wrote stays on its own screen.</p>
        {audit.events.length === 0 ? <Empty>No audit events.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Audit log table" tabIndex={0}>
            <table className={s.table}>
              <caption>Audit events</caption>
              <thead><tr><th scope="col" className={s.num}>#</th><th scope="col">When</th><th scope="col">Action</th><th scope="col">Subject</th><th scope="col">Actor</th></tr></thead>
              <tbody>
                {audit.events.map((e) => (
                  <tr key={e.seq} data-testid="audit-row">
                    <td className={s.num}>{e.seq}</td><td>{when(e.at)}</td><td className={s.mono}>{e.action}</td>
                    <td className={s.mono}>{e.entityType ? `${e.entityType}:${e.entityId ?? ""}` : "—"}</td><td className={s.mono}>{e.actorUserId ?? e.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={s.row}>
          {Number.isInteger(before) && before > 0 ? <a href="/control/merchant/admin">Newest</a> : null}
          {audit.nextBefore ? <a href={`/control/merchant/admin?before=${audit.nextBefore}`}>Older events</a> : null}
        </p>
      </section>
    </>
  );
}
