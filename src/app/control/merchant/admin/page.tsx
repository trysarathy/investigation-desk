import type { Metadata } from "next";
import Link from "next/link";
import { can, isAppRole, ROLE_LABELS } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { auditLogPage, listOrgUsers } from "@/server/org-admin";
import { MFA_LABEL, scopeLabel } from "@/server/access-review";
import { membersView } from "@/server/onboarding/members";
import { MEMBER_ROLES } from "@/server/onboarding/wizard";
import s from "@/components/control/control.module.css";
import x from "@/components/control/screens.module.css";
import { JsonForm } from "@/components/onboarding/forms";
import { AuditTable, InvitationsTable, MembersTable, type MemberRow } from "@/components/merchant/admin-tables";
import { Empty, one } from "@/components/merchant/ui";
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
    return (<><div className={x.head}><div className={x.headText}><h1 className={s.title}>Admin</h1></div></div><Empty>Only an Admin of this organisation sees this page.</Empty></>);
  }
  const before = Number(one((await searchParams).before) ?? "");
  const unscoped = ctx.entityScope === null;
  const [view, users, audit] = await Promise.all([unscoped ? membersView(ctx) : null, listOrgUsers(ctx), auditLogPage(ctx, Number.isInteger(before) && before > 0 ? { before } : {})]);
  const sessions = new Map(users.map((u) => [u.userId, u.activeSessions]));
  const canWrite = view?.invitations != null;
  const members: MemberRow[] = (view?.members ?? []).map((u) => ({
    userId: u.userId, name: u.name, email: u.email, you: u.userId === ctx.userId, roleLabel: u.roleLabel, active: u.status !== "revoked",
    scope: scopeLabel(u.entityScope), mfa: `${MFA_LABEL[u.mfa]}${u.passkeys ? ` +${u.passkeys} passkey${u.passkeys === 1 ? "" : "s"}` : ""}`,
    lastSignIn: u.lastSignInAt ? when(u.lastSignInAt) : "Never recorded", lastSignInSort: u.lastSignInAt ? new Date(u.lastSignInAt).toISOString() : "",
    sessions: sessions.get(u.userId) ?? 0, canDeactivate: canWrite,
  }));
  const paged = Number.isInteger(before) && before > 0;
  return (
    <>
      <div className={x.head}>
        <div className={x.headText}>
          <h1 className={s.title}>Admin</h1>
          <p>Members of {ctx.orgName}: who has access, invitations, and the audit log. An Admin manages members but holds no financial authority. Admins and Approvers must set up multi-factor sign-in before they can use Clearline, and nobody approves their own request.</p>
        </div>
        {view !== null ? <div className={x.headTools}><Link className={x.linkButton} href="/control/merchant/access-review">Access review</Link></div> : null}
      </div>

      {view === null ? (
        <section className={x.section} aria-labelledby="members-h">
          <div className={x.sectionHead}><h2 id="members-h">Members</h2></div>
          <Empty>Your access is limited to some entities, so you do not manage members. An Admin with access to every entity does.</Empty>
        </section>
      ) : (
        <>
          <section className={x.section} aria-labelledby="members-h">
            <div className={x.sectionHead}>
              <h2 id="members-h">Who has access <span className={x.count}>({view.members.filter((m) => m.status === "active").length} active)</span></h2>
              <p>Second factor: the authenticator app, required for Admins and Approvers.</p>
            </div>
            <MembersTable rows={members} />
          </section>

          <section className={x.section} aria-labelledby="invite-h">
            <div className={x.sectionHead}><h2 id="invite-h">Invite a member</h2></div>
            {!canWrite ? <Empty>Inviting and deactivating members is not available on this deployment (no provisioning connection). The operator&rsquo;s administration command grants roles.</Empty> : (
              <>
                <div className={`${x.card} ${x.formCard}`}>
                  <p className={x.note}>The person gets a one-time link to choose their name and password. With no email provider on this deployment, the link is shown to you once, right after you submit: copy it and send it to them yourself. It works once and expires after 72 hours.</p>
                  <p className={x.note}>Choose the least role that fits: Finance prepares, an Approver approves (never their own request), a Viewer only reads.</p>
                  <JsonForm flashKey="admin:invite" url={`${API}/invite`} submit="Create invitation link" success="Sent: the invitation email is on its way."
                    fields={[
                      { name: "email", label: "Email", type: "email", required: true, maxLength: 254 },
                      { name: "role", label: "Role", type: "select", required: true, options: MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })), defaultValue: "finance" },
                    ]} />
                </div>
                <h3 className={x.h3}>Pending invitations <span className={x.count}>({view.invitations!.length})</span></h3>
                {view.invitations!.length === 0 ? <Empty>No pending invitation.</Empty> : (
                  <InvitationsTable api={API} flashPrefix="admin" success="Saved: the invitation was revoked; its link no longer works."
                    rows={view.invitations!.map((i) => ({ id: i.id, email: i.email, role: roleLabel(i.role), expired: i.expired, expires: when(i.expiresAt) }))} />
                )}
              </>
            )}
          </section>
        </>
      )}

      <section className={x.section} aria-labelledby="audit-h">
        <div className={x.sectionHead}>
          <h2 id="audit-h">Audit log</h2>
          <p>Newest first, 50 per page. Ids and actions only; what a person wrote stays on its own screen.</p>
        </div>
        {audit.events.length === 0 ? <Empty>No audit events.</Empty> : (
          <AuditTable rows={audit.events.map((e) => ({ seq: e.seq, at: when(e.at), action: e.action, subject: e.entityType ? `${e.entityType}:${e.entityId ?? ""}` : "—", actor: e.actorUserId ?? e.source }))} />
        )}
        <p className={x.links}>
          {paged ? <a className={x.linkButton} href="/control/merchant/admin">Newest</a> : null}
          {audit.nextBefore ? <a className={x.linkButton} href={`/control/merchant/admin?before=${audit.nextBefore}`}>Older events</a> : null}
        </p>
      </section>
    </>
  );
}
