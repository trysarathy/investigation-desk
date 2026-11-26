import type { Metadata } from "next";
import { isAppRole, ROLE_LABELS } from "@/server/authz";
import { listMembers } from "@/server/control";
import { pageContext } from "@/server/control-page";
import { membershipsFor } from "@/server/tenant";
import s from "@/components/control/control.module.css";
import { OrgSwitcher, SignOutButton } from "@/components/control/forms";
import { OrgMfaPolicyForm } from "@/components/control/security-forms";
import { orgRequiresMfaForAll } from "@/server/mfa-gate";
import { can } from "@/server/authz";
import { PageTitle, TableRegion } from "@/components/control/ui";

export const metadata: Metadata = { title: "Settings" };

const roleLabel = (r: string) => (isAppRole(r) ? ROLE_LABELS[r] : r);

export default async function SettingsPage() {
  const ctx = await pageContext();
  const [members, mine, requireAll] = await Promise.all([listMembers(ctx), membershipsFor(ctx), orgRequiresMfaForAll(ctx)]);
  return (
    <>
      <PageTitle title="Settings" />
      <section className={s.section} aria-labelledby="org">
        <h2 className={s.h2} id="org">Organisation</h2>
        <dl className={s.dl}>
          <dt>Name</dt><dd>{ctx.orgName}</dd>
          <dt>Your role</dt><dd data-testid="your-role">{ROLE_LABELS[ctx.role]}</dd>
          <dt>You</dt><dd>{ctx.name} ({ctx.email})</dd>
        </dl>
      </section>
      <section className={s.section} aria-labelledby="members">
        <h2 className={s.h2} id="members">Members and roles</h2>
        <p className={`${s.small} ${s.muted}`}>Read-only. An administrator manages members outside this console.</p>
        <TableRegion label="Members">
          <table className={s.table}>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Access</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}><td>{m.name}</td><td>{m.email}</td><td>{roleLabel(m.role)}</td><td>{m.revokedAt ? "Revoked" : "Active"}</td></tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </section>
      <section className={s.section} aria-labelledby="switch">
        <h2 className={s.h2} id="switch">Your organisations</h2>
        {mine.length > 1
          ? <OrgSwitcher orgs={mine.map((m) => ({ slug: m.slug, name: m.name, role: roleLabel(m.role) }))} current={ctx.orgSlug} />
          : <p>You belong to one organisation: {ctx.orgName}. There is nothing to switch to.</p>}
      </section>
      <section className={s.section} aria-labelledby="signin">
        <h2 className={s.h2} id="signin">Sign-in security</h2>
        <p>Admins and Approvers always need multi-factor sign-in. {requireAll ? "This organisation requires it for every member." : "Other members may turn it on."}</p>
        {can(ctx.role, "manage_members") ? <OrgMfaPolicyForm requireAll={requireAll} /> : null}
        <p><a href="/control/security">Your security: second factor, passkeys, e-mail and sessions</a></p>
      </section>
      <section className={s.section} aria-labelledby="session">
        <h2 className={s.h2} id="session">Session</h2>
        <p>Sessions end after 8 hours. <SignOutButton /></p>
      </section>
    </>
  );
}
