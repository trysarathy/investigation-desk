import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { contrast } from "@/lib/clearline/merchant/theme";
import { can, ROLE_LABELS } from "@/server/authz";
import { merchantSettings } from "@/server/provider";
import { merchantMember } from "@/server/merchant-page";
import { uploadsOverview } from "@/server/upload-ui";
import { RetentionForm } from "@/components/merchant/upload-review-forms";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import x from "@/components/control/screens.module.css";
import { GrantForm, PolicyForm } from "@/components/merchant/forms";
import { Chip, Empty, fiat, whenIn } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Settings" };

export default async function MerchantSettingsPage() {
  const { ctx, shell } = await merchantMember();
  const th = shell.theme;
  const v = await merchantSettings(ctx);
  const up = await uploadsOverview(ctx);
  const isAdmin = can(ctx.role, "manage_policy");
  const prop = v.proposal?.policyDefaults ?? null;
  return (
    <>
      <div className={x.head}>
        <div className={x.headText}>
          <h1 className={s.title}>Settings</h1>
          <p>Matching policy per entity and what your provider may see. Only your organisation&rsquo;s Admin changes them; you are {ROLE_LABELS[ctx.role]}.</p>
        </div>
      </div>

      <section className={x.section} aria-labelledby="policy">
        <div className={x.sectionHead}>
          <h2 id="policy">Matching policy</h2>
          <p>An amount inside the band is shown as a typed difference for review; an amount alone never closes a match.</p>
        </div>
        {v.proposal ? (
          <div className={x.card} data-testid="provider-proposal">
            <p><strong>{v.proposal.providerName} proposes</strong> (revision {v.proposal.revision}): {prop ? `${prop.toleranceBps} bps of the invoice, capped at ${(Number(prop.toleranceAbsMinor) / 100).toFixed(2)}; write-offs up to ${(Number(prop.writeoffThresholdMinor) / 100).toFixed(2)}; imported bank lines ${prop.allowImportedBankLinesAsVerified ? "may" : "may not"} verify settlement.` : "no policy defaults yet."} {v.proposal.mappedColumns ? `Export column mapping: ${v.proposal.mappedColumns} columns.` : ""}</p>
            <p className={x.note}>A proposal only. Your Admin decides; nothing changes until they save a policy below.</p>
          </div>
        ) : <p className={x.note}>Your provider has not proposed defaults.</p>}
        {v.policies.length === 0 ? <Empty>No entities yet.</Empty> : (
          <div className={x.grid2}>{v.policies.map((p) => (
            <article className={x.card} key={p.entityId} aria-labelledby={`pol-${p.entityId}`}>
              <div className={x.cardHead}>
                <h3 id={`pol-${p.entityId}`}>{p.name} <span className={x.mono}>{p.entityId}</span></h3>
                {isAdmin ? null : <Chip>Read-only for {ROLE_LABELS[ctx.role]}</Chip>}
              </div>
              <dl className={x.kv}>
                <dt>Revision</dt><dd><span className={x.mono}>{p.revision}</span>, {whenIn(p.updatedAt, shell.entities.find((e) => e.id === p.entityId))}</dd>
                <dt>Tolerance</dt><dd>Band = the {p.toleranceCombine === "smaller" ? "smaller" : "larger"} of <span className={x.mono}>{p.toleranceBps} bps</span> and <span className={x.mono}>{fiat(p.toleranceAbsMinor, p.currency)}</span></dd>
                <dt>Write-offs</dt><dd>Up to <span className={x.mono}>{fiat(p.writeoffThresholdMinor, p.currency)}</span></dd>
                <dt>Imported bank lines</dt><dd>{p.allowImportedBankLinesAsVerified ? <Chip tone="warn">may verify settlement</Chip> : "never verify settlement alone"}</dd>
              </dl>
              {isAdmin ? <PolicyForm entityId={p.entityId} revision={p.revision} current={p} /> : null}
            </article>
          ))}</div>
        )}
      </section>

      <section className={x.section} aria-labelledby="theme">
        <div className={x.sectionHead}><h2 id="theme">Your provider&rsquo;s theme</h2></div>
        <p className={x.note}>These screens carry {shell.providerName ?? "your provider"}&rsquo;s name, logo placeholder and colours; Clearline appears only in small print. The provider sets them; this is a preview.</p>
        <div className={m.themeCard} data-testid="theme-preview" style={{ "--brand": th.primary, "--on-brand": th.onPrimary, "--accent": th.accent } as CSSProperties}>
          <div className={`${m.themeBar} ${m.brandBar}`}>
            <span className={m.logo} role="img" aria-label={th.logoAlt}>{th.logoText}</span>
            <div><p className={m.brandName}>{th.name}</p><p className={m.brandSub}>Merchant reconciliation · {ctx.orgName}</p></div>
          </div>
          <ul className={m.swatches}>
            <li><span className={m.swatch} style={{ background: th.primary }} aria-hidden="true" />Primary <span className={x.mono}>{th.primary}</span></li>
            <li><span className={m.swatch} style={{ background: th.accent }} aria-hidden="true" />Accent <span className={x.mono}>{th.accent}</span></li>
            <li>Text on primary <span className={x.mono}>{th.onPrimary}</span>: contrast <span className={x.mono}>{contrast(th.primary, th.onPrimary).toFixed(2)}:1</span> (AA needs 4.5:1)</li>
          </ul>
          <p className={`${s.small} ${m.themeBar}`}><span className={m.demoChip}>{shell.label}</span><span className={m.powered}>powered by Clearline</span></p>
        </div>
      </section>

      <div className={x.grid2}>
        <section className={x.section} aria-labelledby="retention">
          <div className={x.sectionHead}><h2 id="retention">Uploads and retention</h2></div>
          <div className={x.card}>
            <p data-testid="retention-days">Uploaded files, and the data derived only from them, are deleted after <strong>{up.retentionDays} days</strong>. Each upload shows its delete-after date on the <Link href="/control/merchant/uploads">Uploads</Link> page.</p>
            {can(ctx.role, "manage_retention") ? <RetentionForm days={up.retentionDays} /> : <p className={x.note}>Your Admin decides this.</p>}
          </div>
        </section>

        <section className={x.section} aria-labelledby="access">
          <div className={x.sectionHead}><h2 id="access">Provider access</h2></div>
          {!v.hasProvider ? <p className={x.note}>This organisation is not served by a provider.</p> : (
            <div className={x.card}>
              <p data-testid="grant-scope">{v.grantScope === "full" ? <><Chip tone="info">Full access</Chip> Your provider can read this merchant&rsquo;s payments, exceptions and evidence (read-only).</> : <><Chip>Aggregates only</Chip> Your provider sees totals (payments, auto-match rate, exceptions, last ingestion), never your records.</>}</p>
              {can(ctx.role, "manage_members") ? <GrantForm scope={v.grantScope} /> : <p className={x.note}>Your Admin decides this.</p>}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
