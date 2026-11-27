import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentPrincipal } from "@/server/auth";
import { AccessDenied } from "@/server/tenant";
import { platformOrgs, type PlatformOrg } from "@/server/onboarding/platform";
import { SignOutButton } from "@/components/control/forms";
import { JsonForm } from "@/components/onboarding/forms";
import s from "@/components/control/control.module.css";
import x from "@/components/control/screens.module.css";
import { ProductMark } from "@/components/control/member-status";
import { OrgsTable } from "@/components/merchant/admin-tables";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
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
  const unfinished = orgs.filter((o) => o.kind !== "provider" && !o.setupFinished).length;
  return (
    <>
      <header className={x.bar}>
        <div className={x.barInner}>
          <div className={x.barLeft}>
            <ProductMark className={x.mark} />
            <p className={x.product}><span>Clearline Control<span className={x.barSub}>Platform console</span></span></p>
          </div>
          <div className={x.barRight}>
            <ThemeToggle />
            <p data-testid="signed-in-as">Signed in as <strong>{p.name}</strong> (<span className={x.mono}>{p.email}</span>) · Platform operator · <SignOutButton /></p>
          </div>
        </div>
      </header>
      <main className={x.page} id="main">
        <div className={x.head}>
          <div className={x.headText}>
            <h1 className={s.title}>Platform console</h1>
            <p>Create a merchant or provider organisation and invite its first admin. The organisation starts empty (&ldquo;Your data&rdquo;); its admin completes setup. You see no organisation&rsquo;s data.</p>
          </div>
        </div>

        <div className={x.grid2}>
          <section className={x.section} aria-labelledby="create-h">
            <div className={x.sectionHead}><h2 id="create-h">New organisation</h2></div>
            <div className={x.card}>
              <p className={x.note}>When this deployment sends no email, the first admin&rsquo;s one-time invitation link is shown to you once, right after you submit: copy it and send it to them yourself. It works once and expires after 72 hours.</p>
              <JsonForm flashKey="platform:create" url="/api/control/platform/organizations" submit="Create and send invitation"
                success="Created. The invitation email is on its way to the first admin."
                fields={[
                  { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "merchant", label: "Merchant" }, { value: "provider", label: "Payment provider" }] },
                  { name: "name", label: "Organisation name", required: true, maxLength: 200 },
                  { name: "slug", label: "Code (slug)", required: true, maxLength: 63, hint: "2–63 lower-case letters, digits or dashes, e.g. acme-sg. It never changes." },
                  { name: "timezone", label: "Time zone", required: true, defaultValue: "Asia/Singapore", hint: "An IANA time zone, e.g. Asia/Singapore, Asia/Dubai, UTC." },
                  { name: "providerSlug", label: "Served by provider (merchants only)", type: "select", options: [{ value: "", label: "No provider" }, ...providers.map((o) => ({ value: o.slug, label: `${o.name} (${o.slug})` }))] },
                  { name: "adminEmail", label: "First admin's email", type: "email", required: true, maxLength: 254 },
                ]} />
            </div>
          </section>

          {orgs.some((o) => o.admins === 0) ? (
            <section className={x.section} aria-labelledby="reinvite-h">
              <div className={x.sectionHead}><h2 id="reinvite-h">Invite a first admin again</h2></div>
              <div className={x.card}>
                <p className={x.note}>For an organisation with no admin yet (e.g. the invitation expired). The earlier pending invitation stops working.</p>
                <JsonForm flashKey="platform:reinvite" url="/api/control/platform/organizations/reinvite" submit="Send a new invitation" variant="secondary"
                  success="A new invitation email is on its way."
                  fields={[
                    { name: "orgId", label: "Organisation", type: "select", required: true, options: orgs.filter((o) => o.admins === 0).map((o) => ({ value: o.id, label: `${o.name} (${o.slug})` })) },
                    { name: "adminEmail", label: "New first admin's email", type: "email", required: true, maxLength: 254 },
                  ]} />
              </div>
            </section>
          ) : null}
        </div>

        <section className={x.section} aria-labelledby="orgs-h">
          <div className={x.sectionHead}>
            <h2 id="orgs-h">Live organisations <span className={x.count}>({orgs.length})</span></h2>
            <p>{unfinished} merchant{unfinished === 1 ? "" : "s"} with setup not finished.</p>
          </div>
          <OrgsTable rows={orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, kind: o.kind === "provider" ? "Provider" : "Merchant", created: when(o.createdAt), admins: o.admins, pending: o.pendingInvitations, setup: o.kind === "provider" ? "—" : o.setupFinished ? "Finished" : "Not finished" }))} />
        </section>
      </main>
    </>
  );
}
