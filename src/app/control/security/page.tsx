import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { listMySessions, securityStatus } from "@/server/account-security";
import { SignOutButton } from "@/components/control/forms";
import { ActionButton, AddPasskey, EnrolTotp, RegenerateCodes, StepUp } from "@/components/control/security-forms";
import { TableRegion, when } from "@/components/control/ui";
import s from "@/components/control/control.module.css";

export const metadata: Metadata = { title: "Security" };

/**
 * The caller's own sign-in security. Deliberately OUTSIDE the MFA gate (it needs a session only): this is where an
 * Admin or Approver without MFA is sent to set it up, and where a session that has not proved a second factor proves it.
 */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const sess = await currentSession(await headers());
  if (!sess) redirect("/control/sign-in");
  const [st, sessions] = await Promise.all([securityStatus(sess), listMySessions(sess)]);
  await searchParams; // ?required=enrol|verify only explains the redirect; the page re-derives the state itself
  const mustEnrol = !st.mfaEnrolled && st.requiredIn.length > 0;
  const mustVerify = st.mfaEnrolled && !st.mfaVerifiedThisSession;
  return (
    <>
      <header className={s.header}>
        <div className={s.headerInner}>
          <p className={s.brand}>Clearline Control<span className={s.brandOrg}>Security</span></p>
          <p className={s.who} data-testid="signed-in-as">Signed in as <strong>{sess.principal.name}</strong> ({sess.principal.email}) · <SignOutButton /></p>
        </div>
      </header>
      <main className={s.main} id="main">
        <h1 className={s.title}>Security</h1>
        <p className={s.lede}>Your second factor, your e-mail address and where you are signed in.</p>
        {mustEnrol ? (
          <div className={s.panel} role="alert" data-testid="mfa-required">
            <p><strong>Set up multi-factor sign-in to continue.</strong> It is required for you in {st.requiredIn.map((r) => `${r.name} (${r.reason === "role" ? "your role" : "the organisation’s policy"})`).join(", ")}. Until it is on, Clearline Control stays closed to this account.</p>
          </div>
        ) : mustVerify ? (
          <div className={s.panel} role="alert"><p><strong>Confirm your second factor to continue.</strong> This session has not proved it yet.</p></div>
        ) : null}

        <section className={s.section} aria-labelledby="mfa">
          <h2 className={s.h2} id="mfa">Multi-factor sign-in</h2>
          {!st.mfaEnrolled ? (
            <>
              <p>Off. Turn it on with an authenticator app (any app that shows 6-digit codes). You also get 10 one-time recovery codes. Passkeys can be added afterwards.</p>
              <div className={s.panel}><EnrolTotp /></div>
            </>
          ) : (
            <>
              <p data-testid="mfa-status">On: authenticator app{st.passkeys.length ? ` and ${st.passkeys.length} passkey${st.passkeys.length > 1 ? "s" : ""}` : ""}.</p>
              {!st.fresh || mustVerify ? (
                <div className={s.panel}>
                  <h3 className={s.label}>Confirm it is you</h3>
                  <p className={s.small}>Needed before changing your second factors (good for 10 minutes).</p>
                  <StepUp mfaEnrolled hasPasskey={st.passkeys.length > 0} />
                </div>
              ) : (
                <>
                  <h3 className={s.label}>Passkeys</h3>
                  {st.passkeys.length ? (
                    <TableRegion label="Passkeys">
                      <table className={s.table}>
                        <thead><tr><th scope="col">Name</th><th scope="col">Added</th><th scope="col">Last used</th><th scope="col">Action</th></tr></thead>
                        <tbody>{st.passkeys.map((p) => (
                          <tr key={p.id}><td>{p.name}</td><td>{when(p.createdAt)}</td><td>{when(p.lastUsedAt)}</td>
                            <td><ActionButton url="/api/control/security/remove-passkey" body={{ id: p.id }} label={`Remove ${p.name}`} done="Passkey removed." flashKey="passkey-add" variant="secondary" /></td></tr>
                        ))}</tbody>
                      </table>
                    </TableRegion>
                  ) : <p className={s.small}>No passkeys yet.</p>}
                  <AddPasskey />
                  <h3 className={s.label}>Recovery codes</h3>
                  <RegenerateCodes />
                  {st.requiredIn.length === 0 ? (
                    <p><ActionButton url="/api/control/security/disable-mfa" label="Turn off multi-factor sign-in" done="Multi-factor sign-in is off." flashKey="mfa-off" variant="danger" confirmText="Turn off multi-factor sign-in and remove your passkeys?" /></p>
                  ) : <p className={s.small}>Multi-factor sign-in cannot be turned off: it is required for you in {st.requiredIn.map((r) => r.name).join(", ")}.</p>}
                </>
              )}
            </>
          )}
        </section>

        <section className={s.section} aria-labelledby="email">
          <h2 className={s.h2} id="email">E-mail address</h2>
          <p data-testid="email-status">{st.email}: {st.emailVerified ? "verified." : "not verified yet. Password-reset links are only sent to a verified address."}</p>
          {!st.emailVerified ? <ActionButton url="/api/control/security/send-verification-email" label="Send a verification link" done="A verification link is on its way (it works once, for 30 minutes)." flashKey="verify-send" variant="secondary" /> : null}
        </section>

        <section className={s.section} aria-labelledby="sessions">
          <h2 className={s.h2} id="sessions">Where you are signed in</h2>
          <TableRegion label="Sessions">
            <table className={s.table}>
              <thead><tr><th scope="col">Device</th><th scope="col">Signed in</th><th scope="col">Last active</th><th scope="col">Second factor</th><th scope="col">Action</th></tr></thead>
              <tbody>{sessions.map((x) => (
                <tr key={x.id} data-testid={x.current ? "session-current" : "session-other"}>
                  <td>{x.device}{x.current ? " (this session)" : ""}</td><td>{when(x.createdAt)}</td><td>{when(x.lastActiveAt)}</td><td>{x.mfa ? "Yes" : "No"}</td>
                  <td>{x.current ? <SignOutButton /> : <ActionButton url="/api/control/security/revoke-session" body={{ id: x.id }} label="Revoke" done="Session revoked." flashKey="sessions" variant="secondary" />}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableRegion>
          {/* Always shown: it also carries the confirmation of a revoke after the reload (the revoked row is gone). */}
          <ActionButton url="/api/control/security/revoke-other-sessions" label="Sign out all other sessions" done="Every other session is signed out." flashKey="sessions" variant="secondary" />
        </section>

        {!mustEnrol && !mustVerify ? <p><a href="/control">Continue to Clearline Control</a></p> : null}
      </main>
    </>
  );
}
