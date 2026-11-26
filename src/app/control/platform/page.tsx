import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentPrincipal } from "@/server/auth";
import { AccessDenied } from "@/server/tenant";
import { platformOrgs, type PlatformOrg } from "@/server/onboarding/platform";
import { SignOutButton } from "@/components/control/forms";
import { JsonForm } from "@/components/onboarding/forms";
import s from "@/components/control/control.module.css";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Platform console" };

/**
 * v1 phase 1.1: the PLATFORM CONSOLE. Exists only with CLEARLINE_PLATFORM_CONSOLE=1, and only for a platform
 * operator (granted with the admin CLI); anyone else gets the not-found page. Creates an empty live organisation and
 * invites its first admin; shows ids, names and counts only.
 */
export default async function PlatformPage() {
  const p = await currentPrincipal(await headers());
  if (!p) redirect("/control/sign-in");
  let orgs: PlatformOrg[];
  try { orgs = await platformOrgs(p); } catch (e) { if (e instanceof AccessDenied) notFound(); throw e; }
  const providers = orgs.filter((o) => o.kind === "provider");
  return (
    <main className={s.main} id="main">
      <p className={s.small} data-testid="signed-in-as">Signed in as <strong>{p.name}</strong> ({p.email}) · Platform operator · <SignOutButton /></p>
      <h1 className={s.title}>Platform console</h1>
      <p className={s.lede}>Create a merchant or provider organisation and invite its first admin. The organisation starts empty (&ldquo;Your data&rdquo;); its admin completes setup. You see no organisation&rsquo;s data.</p>

      <section className={s.section} aria-labelledby="create-h">
        <h2 className={s.h2} id="create-h">New organisation</h2>
        <div className={s.panel}>
          <JsonForm flashKey="platform:create" url="/api/control/platform/organizations" submit="Create and send invitation"
            success="Created. The invitation email is on its way to the first admin."
            fields={[
              { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "merchant", label: "Merchant" }, { value: "provider", label: "Payment provider" }] },
              { name: "name", label: "Organisation name", required: true, maxLength: 200 },
              { name: "slug", label: "Code (slug)", required: true, maxLength: 63, hint: "2–63 lower-case letters, digits or dashes, e.g. acme-sg. It never changes." },
              { name: "timezone", label: "Time zone", required: true, defaultValue: "Asia/Singapore", hint: "An IANA time zone, e.g. Asia/Singapore, Asia/Dubai, UTC." },
              { name: "providerSlug", label: "Served by provider (merchants only)", type: "select", options: [{ value: "", label: "No provider" }, ...providers.map((x) => ({ value: x.slug, label: `${x.name} (${x.slug})` }))] },
              { name: "adminEmail", label: "First admin's email", type: "email", required: true, maxLength: 254 },
            ]} />
        </div>
      </section>

      <section className={s.section} aria-labelledby="orgs-h">
        <h2 className={s.h2} id="orgs-h">Live organisations ({orgs.length})</h2>
        <div className={s.tableWrap} role="region" aria-label="Organisations table" tabIndex={0}>
          <table className={s.table}>
            <caption>Live organisations, newest first</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Code</th><th scope="col">Kind</th><th scope="col">Created</th><th scope="col" className={s.num}>Admins</th><th scope="col" className={s.num}>Pending invitations</th><th scope="col">Setup</th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} data-testid="platform-org-row">
                  <td>{o.name}</td><td className={s.mono}>{o.slug}</td><td>{o.kind === "provider" ? "Provider" : "Merchant"}</td><td>{when(o.createdAt)}</td>
                  <td className={s.num}>{o.admins}</td><td className={s.num}>{o.pendingInvitations}</td>
                  <td>{o.kind === "provider" ? "—" : o.setupFinished ? "Finished" : "Not finished"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {orgs.some((o) => o.admins === 0) ? (
        <section className={s.section} aria-labelledby="reinvite-h">
          <h2 className={s.h2} id="reinvite-h">Invite a first admin again</h2>
          <p className={s.small}>For an organisation with no admin yet (e.g. the invitation expired). The earlier pending invitation stops working.</p>
          <div className={s.panel}>
            <JsonForm flashKey="platform:reinvite" url="/api/control/platform/organizations/reinvite" submit="Send a new invitation" variant="secondary"
              success="A new invitation email is on its way."
              fields={[
                { name: "orgId", label: "Organisation", type: "select", required: true, options: orgs.filter((o) => o.admins === 0).map((o) => ({ value: o.id, label: `${o.name} (${o.slug})` })) },
                { name: "adminEmail", label: "New first admin's email", type: "email", required: true, maxLength: 254 },
              ]} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
