import type { Metadata } from "next";
import { can } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { auditLogPage, listOrgUsers } from "@/server/org-admin";
import s from "@/components/control/control.module.css";
import { RevokeSessions } from "@/components/merchant/forms";
import { Chip, Empty, one } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Admin" };

/** The organisation Admin's page: members and roles, sign a member out everywhere, and the audit log (ids only). */
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx } = await merchantMember();
  if (!can(ctx.role, "manage_members")) {
    return (<><h1 className={s.title}>Admin</h1><Empty>Only an Admin of this organisation sees this page.</Empty></>);
  }
  const before = Number(one((await searchParams).before) ?? "");
  const [users, audit] = await Promise.all([listOrgUsers(ctx), auditLogPage(ctx, Number.isInteger(before) && before > 0 ? { before } : {})]);
  return (
    <>
      <h1 className={s.title}>Admin</h1>
      <p className={s.lede}>Members of {ctx.orgName} and their roles, and the audit log. An Admin manages members but holds no financial authority. Roles are granted with the administration command.</p>

      <section className={s.section} aria-labelledby="members-h">
        <h2 className={s.h2} id="members-h">Members ({users.length})</h2>
        <div className={s.tableWrap} role="region" aria-label="Members table" tabIndex={0}>
          <table className={s.table}>
            <caption>Members, roles and active sessions</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col" className={s.num}>Active sessions</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} data-testid="member-row">
                  <td>{u.name}{u.you ? " (you)" : ""}</td>
                  <td>{u.email}</td>
                  <td>{u.revokedAt ? <Chip tone="warn">Revoked</Chip> : u.roleLabel}</td>
                  <td className={s.num}>{u.activeSessions}</td>
                  <td>{u.you ? "—" : u.activeSessions > 0 ? <RevokeSessions userId={u.userId} name={u.name} /> : "Signed out"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
