import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { listMySessions, securityStatus } from "@/server/account-security";
import { SignOutButton } from "@/components/control/forms";
import { ActionButton, AddPasskey, EnrolTotp, RegenerateCodes, StepUp } from "@/components/control/security-forms";
import { TableRegion, when } from "@/components/control/ui";
import s from "@/components/control/control.module.css";
import x from "@/components/control/screens.module.css";
import { MemberStatus, ProductMark } from "@/components/control/member-status";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { IconAlert } from "@/components/ui/icons";

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
      <header className={x.bar}>
        <div className={x.barInner}>
          <div className={x.barLeft}>
            <ProductMark className={x.mark} />
            <p className={x.product}><span>Clearline Control<span className={x.barSub}>Security</span></span></p>
          </div>
          <div className={x.barRight}>
            <ThemeToggle />
            <p data-testid="signed-in-as">Signed in as <strong>{sess.principal.name}</strong> (<span className={x.mono}>{sess.principal.email}</span>) · <SignOutButton /></p>
          </div>
        </div>
      </header>
      <main className={x.page} id="main">
        <div className={x.head}>
          <div className={x.headText}>
            <h1 className={s.title}>Security</h1>
            <p>Your second factor, your e-mail address and where you are signed in.</p>
          </div>
        </div>
        {mustEnrol ? (
          <div className={`${x.callout} ${x.calloutWarn}`} role="alert" data-testid="mfa-required">
            <IconAlert />
            <p><strong>Set up multi-factor sign-in to continue.</strong> It is required for you in {st.requiredIn.map((r) => `${r.name} (${r.reason === "role" ? "your role" : "the organisation’s policy"})`).join(", ")}. Until it is on, Clearline Control stays closed to this account.</p>
          </div>
        ) : mustVerify ? (
          <div className={`${x.callout} ${x.calloutWarn}`} role="alert"><IconAlert /><p><strong>Confirm your second factor to continue.</strong> This session has not proved it yet.</p></div>
        ) : null}

        <section className={x.section} aria-labelledby="mfa">
          <div className={x.sectionHead}><h2 id="mfa">Multi-factor sign-in</h2>{st.requiredIn.length ? <p>Required for you in {st.requiredIn.map((r) => r.name).join(", ")}.</p> : null}</div>
          {!st.mfaEnrolled ? (
            <>
              <div className={`${x.card} ${x.formCard}`}>
                <p><MemberStatus state="deactivated" label="Off" /> Turn it on with an authenticator app (any app that shows 6-digit codes). You also get 10 one-time recovery codes. Passkeys can be added afterwards.</p>
                <div className={x.otp}><EnrolTotp /></div>
              </div>
            </>
          ) : (
            <>
              <p className={x.row}><MemberStatus state="active" label="On" /><span data-testid="mfa-status">On: authenticator app{st.passkeys.length ? ` and ${st.passkeys.length} passkey${st.passkeys.length > 1 ? "s" : ""}` : ""}.</span></p>
              {!st.fresh || mustVerify ? (
                <div className={`${x.card} ${x.formCard} ${x.otp}`}>
                  <h3 className={x.h3}>Confirm it is you</h3>
                  <p className={x.note}>Needed before changing your second factors (good for 10 minutes).</p>
                  <StepUp mfaEnrolled hasPasskey={st.passkeys.length > 0} />
                </div>
              ) : (
                <div className={x.card}>
                  <h3 className={x.h3}>Passkeys</h3>
                  {st.passkeys.length ? (
                    <TableRegion label="Passkeys">
                      <table className={s.table}>
                        <thead><tr><th scope="col">Name</th><th scope="col">Added</th><th scope="col">Last used</th><th scope="col">Action</th></tr></thead>
                        <tbody>{st.passkeys.map((p) => (
                          <tr key={p.id}><td>{p.name}</td><td className={x.mono}>{when(p.createdAt)}</td><td className={x.mono}>{when(p.lastUsedAt)}</td>
                            <td><ActionButton url="/api/control/security/remove-passkey" body={{ id: p.id }} label={`Remove ${p.name}`} done="Passkey removed." flashKey="passkey-add" variant="secondary" /></td></tr>
                        ))}</tbody>
                      </table>
                    </TableRegion>
                  ) : <p className={x.note}>No passkeys yet.</p>}
                  <AddPasskey />
                  <h3 className={x.h3}>Recovery codes</h3>
                  <RegenerateCodes />
                  {st.requiredIn.length === 0 ? (
                    <p><ActionButton url="/api/control/security/disable-mfa" label="Turn off multi-factor sign-in" done="Multi-factor sign-in is off." flashKey="mfa-off" variant="danger" confirmText="Turn off multi-factor sign-in and remove your passkeys?" /></p>
                  ) : <p className={x.note}>Multi-factor sign-in cannot be turned off: it is required for you in {st.requiredIn.map((r) => r.name).join(", ")}.</p>}
                </div>
              )}
            </>
          )}
        </section>

        <section className={x.section} aria-labelledby="email">
          <div className={x.sectionHead}><h2 id="email">E-mail address</h2></div>
          <div className={x.card}>
          <p className={x.row}><MemberStatus state={st.emailVerified ? "active" : "pending"} label={st.emailVerified ? "Verified" : "Not verified"} /><span data-testid="email-status"><span className={x.mono}>{st.email}</span>: {st.emailVerified ? "verified." : "not verified yet. Password-reset links are only sent to a verified address."}</span></p>
          {!st.emailVerified ? <ActionButton url="/api/control/security/send-verification-email" label="Send a verification link" done="A verification link is on its way (it works once, for 30 minutes)." flashKey="verify-send" variant="secondary" /> : null}
          </div>
        </section>

        <section className={x.section} aria-labelledby="sessions">
          <div className={x.sectionHead}><h2 id="sessions">Where you are signed in <span className={x.count}>({sessions.length})</span></h2></div>
          <TableRegion label="Sessions">
            <table className={s.table}>
              <thead><tr><th scope="col">Device</th><th scope="col">Signed in</th><th scope="col">Last active</th><th scope="col">Second factor</th><th scope="col">Action</th></tr></thead>
              <tbody>{sessions.map((ss) => (
                <tr key={ss.id} data-testid={ss.current ? "session-current" : "session-other"}>
                  <td>{ss.device}{ss.current ? " (this session)" : ""}</td><td className={x.mono}>{when(ss.createdAt)}</td><td className={x.mono}>{when(ss.lastActiveAt)}</td><td>{ss.mfa ? "Yes" : "No"}</td>
                  <td>{ss.current ? <SignOutButton /> : <ActionButton url="/api/control/security/revoke-session" body={{ id: ss.id }} label="Revoke" done="Session revoked." flashKey="sessions" variant="secondary" />}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableRegion>
          {/* Always shown: it also carries the confirmation of a revoke after the reload (the revoked row is gone). */}
          <div className={x.after}><ActionButton url="/api/control/security/revoke-other-sessions" label="Sign out all other sessions" done="Every other session is signed out." flashKey="sessions" variant="secondary" /></div>
        </section>

        {!mustEnrol && !mustVerify ? <p><a className={x.linkButton} href="/control">Continue to Clearline Control</a></p> : null}
      </main>
    </>
  );
}
