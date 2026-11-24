import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { NORTHWIND_EXPORT_MAPPING } from "@/lib/clearline/merchant/adapters";
import { contrast } from "@/lib/clearline/merchant/theme";
import { can } from "@/server/authz";
import { acceptInvitationCommand, onboardingView } from "@/server/provider";
import { providerMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { DefaultsForm, InviteForm, MappingEditor } from "@/components/merchant/forms";
import { Chip, Empty, one } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Onboarding" };

const DEFAULT_PROPOSAL = { toleranceBps: 50, toleranceAbsMinor: "500", writeoffThresholdMinor: "500", allowImportedBankLinesAsVerified: false };
const ROLE: Record<string, string> = { admin: "Admin", finance: "Finance", payment_ops: "Payment Operations", approver: "Approver", viewer: "Viewer" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, shell } = await providerMember();
  const sp = await searchParams;
  const v = await onboardingView(ctx);
  const sel = v.merchants.find((x) => x.merchantOrgId === one(sp.merchant)) ?? v.merchants[0];
  const mayManage = can(ctx.role, "provider_manage");
  const t = shell.theme;
  return (
    <>
      <h1 className={s.title}>Onboarding</h1>
      <p className={s.lede}>Set a merchant up: map its export columns, propose matching-policy defaults, invite its people. Configuration only: nothing here connects to a live system, and the merchant&rsquo;s own Admin sets its policy.</p>
      {!mayManage ? <p className={s.small} role="note">You are Provider Ops: you can read the onboarding; a Provider Admin changes it.</p> : null}
      {!sel ? <Empty>No merchants yet.</Empty> : (
        <>
          <form className={m.filters} method="get" action="/control/merchant/provider/onboarding" aria-label="Choose merchant">
            <div className={s.field}>
              <label className={s.label} htmlFor="ob-merchant">Merchant</label>
              <select className={s.select} id="ob-merchant" name="merchant" defaultValue={sel.merchantOrgId}>{v.merchants.map((x) => <option key={x.merchantOrgId} value={x.merchantOrgId}>{x.name}</option>)}</select>
            </div>
            <div><button type="submit" className={s.button}>Open</button></div>
          </form>
          <p className={s.small}>{sel.name}: onboarding revision {sel.revision}{sel.updatedAt ? `, last changed ${when(sel.updatedAt)}` : " (nothing saved yet)"}.</p>

          <div className={m.cols2}>
            <section className={s.panel} aria-labelledby="connect">
              <h2 className={s.h2} id="connect">Connect exports</h2>
              <p className={s.small}>{sel.columnMapping ? "The saved column mapping." : "Nothing saved yet: the editor starts from the column layout of your own export (a template)."} Stored as JSON; no file is fetched and nothing is connected.</p>
              {mayManage ? <MappingEditor merchantOrgId={sel.merchantOrgId} revision={sel.revision} initial={JSON.stringify(sel.columnMapping ?? NORTHWIND_EXPORT_MAPPING, null, 2)} />
                : <pre className={m.pre}>{sel.columnMapping ? JSON.stringify(sel.columnMapping, null, 2) : "No mapping saved."}</pre>}
            </section>
            <section className={s.panel} aria-labelledby="defaults">
              <h2 className={s.h2} id="defaults">Policy defaults (a proposal)</h2>
              <p className={s.small}>The merchant&rsquo;s Admin sees this proposal in their Settings and decides whether to adopt it. You never set a merchant&rsquo;s policy.</p>
              {sel.policyDefaults ? <p className={s.small}>Proposed: {sel.policyDefaults.toleranceBps} bps, cap {(Number(sel.policyDefaults.toleranceAbsMinor) / 100).toFixed(2)}, write-off threshold {(Number(sel.policyDefaults.writeoffThresholdMinor) / 100).toFixed(2)}, imported bank lines {sel.policyDefaults.allowImportedBankLinesAsVerified ? "may" : "may not"} verify settlement.</p> : <p className={s.small}>No proposal yet.</p>}
              {mayManage ? <DefaultsForm merchantOrgId={sel.merchantOrgId} revision={sel.revision} current={sel.policyDefaults ?? DEFAULT_PROPOSAL} /> : null}
            </section>
            <section className={s.panel} aria-labelledby="invite">
              <h2 className={s.h2} id="invite">Invite users</h2>
              <p className={s.small}>Records an invitation; no email is sent. An operator accepts it with the admin command shown below.</p>
              {mayManage ? <InviteForm merchantOrgId={sel.merchantOrgId} /> : null}
              {sel.invitations.length === 0 ? <p className={s.small}>No invitations yet.</p> : (
                <ul className={s.plainList}>{sel.invitations.map((i) => (
                  <li key={i.id} className={s.subsection} data-testid="invitation">
                    <p className={s.row}><strong>{i.email}</strong> · {ROLE[i.role] ?? i.role} <Chip tone={i.status === "accepted" ? "ok" : "amber"}>{i.status}</Chip></p>
                    {i.status === "pending" ? <p className={`${s.mono} ${m.hash}`} data-testid="invitation-command">{acceptInvitationCommand(i.id)}</p> : null}
                  </li>
                ))}</ul>
              )}
            </section>
            <section className={s.panel} aria-labelledby="theme">
              <h2 className={s.h2} id="theme">Theme preview</h2>
              <p className={s.small}>What {sel.name}&rsquo;s team sees: your name, logo placeholder and colours; Clearline appears only in small print.</p>
              <div className={m.themeCard} data-testid="theme-preview" style={{ "--brand": t.primary, "--on-brand": t.onPrimary, "--accent": t.accent } as CSSProperties}>
                <div className={`${m.themeBar} ${m.brandBar}`}>
                  <span className={m.logo} role="img" aria-label={t.logoAlt}>{t.logoText}</span>
                  <div><p className={m.brandName}>{t.name}</p><p className={m.brandSub}>Merchant reconciliation · {sel.name}</p></div>
                </div>
                <ul className={m.swatches}>
                  <li><span className={m.swatch} style={{ background: t.primary }} aria-hidden="true" />Primary {t.primary}</li>
                  <li><span className={m.swatch} style={{ background: t.accent }} aria-hidden="true" />Accent {t.accent}</li>
                  <li>Text on primary {t.onPrimary}: contrast {contrast(t.primary, t.onPrimary).toFixed(2)}:1 (AA needs 4.5:1)</li>
                </ul>
                <p className={`${s.small} ${m.themeBar}`}><span className={m.demoChip}>{shell.label}</span><span className={m.powered}>powered by Clearline</span></p>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
