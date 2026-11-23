/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { can, ROLE_LABELS } from "@/server/authz";
import { merchantSettings } from "@/server/provider";
import { merchantMember } from "@/server/merchant-page";
import { uploadsOverview } from "@/server/upload-ui";
import { RetentionForm } from "@/components/merchant/upload-review-forms";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { GrantForm, PolicyForm } from "@/components/merchant/forms";
import { Chip, Empty, fiat } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Settings" };

export default async function MerchantSettingsPage() {
  const { ctx } = await merchantMember();
  const v = await merchantSettings(ctx);
  const up = await uploadsOverview(ctx);
  const isAdmin = can(ctx.role, "manage_policy");
  const prop = v.proposal?.policyDefaults ?? null;
  return (
    <>
      <h1 className={s.title}>Settings</h1>
      <p className={s.lede}>Matching policy per entity and what your provider may see. Only your organisation&rsquo;s Admin changes them; you are {ROLE_LABELS[ctx.role]}.</p>

      <section className={s.section} aria-labelledby="policy">
        <h2 className={s.h2} id="policy">Matching policy</h2>
        {v.proposal ? (
          <div className={s.panel} data-testid="provider-proposal">
            <p><strong>{v.proposal.providerName} proposes</strong> (revision {v.proposal.revision}): {prop ? `${prop.toleranceBps} bps of the invoice, capped at ${(Number(prop.toleranceAbsMinor) / 100).toFixed(2)}; write-offs up to ${(Number(prop.writeoffThresholdMinor) / 100).toFixed(2)}; imported bank lines ${prop.allowImportedBankLinesAsVerified ? "may" : "may not"} verify settlement.` : "no policy defaults yet."} {v.proposal.mappedColumns ? `Export column mapping: ${v.proposal.mappedColumns} columns.` : ""}</p>
            <p className={s.small}>A proposal only. Your Admin decides; nothing changes until they save a policy below.</p>
          </div>
        ) : <p className={s.small}>Your provider has not proposed defaults.</p>}
        {v.policies.length === 0 ? <Empty>No entities yet.</Empty> : (
          <div className={m.cols2}>{v.policies.map((p) => (
            <article className={s.panel} key={p.entityId} aria-labelledby={`pol-${p.entityId}`}>
              <h3 className={s.h3} id={`pol-${p.entityId}`}>{p.name} <span className={s.mono}>{p.entityId}</span></h3>
              <p className={s.small}>Revision {p.revision}, {when(p.updatedAt)}. Band = the {p.toleranceCombine === "smaller" ? "smaller" : "larger"} of {p.toleranceBps} bps and {fiat(p.toleranceAbsMinor, p.currency)}; write-offs up to {fiat(p.writeoffThresholdMinor, p.currency)}; imported bank lines {p.allowImportedBankLinesAsVerified ? <Chip tone="warn">may verify settlement</Chip> : "never verify settlement alone"}.</p>
              {isAdmin ? <PolicyForm entityId={p.entityId} revision={p.revision} current={p} /> : null}
            </article>
          ))}</div>
        )}
      </section>

      <section className={s.section} aria-labelledby="retention">
        <h2 className={s.h2} id="retention">Uploads and retention</h2>
        <div className={s.panel}>
          <p data-testid="retention-days">Uploaded files, and the data derived only from them, are deleted after <strong>{up.retentionDays} days</strong>. Each upload shows its delete-after date on the <a href="/control/merchant/uploads">Uploads</a> page.</p>
          {can(ctx.role, "manage_retention") ? <RetentionForm days={up.retentionDays} /> : <p className={s.small}>Your Admin decides this.</p>}
        </div>
      </section>

      <section className={s.section} aria-labelledby="access">
        <h2 className={s.h2} id="access">Provider access</h2>
        {!v.hasProvider ? <p>This organisation is not served by a provider.</p> : (
          <div className={s.panel}>
            <p data-testid="grant-scope">{v.grantScope === "full" ? <><Chip tone="info">Full access</Chip> Your provider can read this merchant&rsquo;s payments, exceptions and evidence (read-only).</> : <><Chip>Aggregates only</Chip> Your provider sees totals (payments, auto-match rate, exceptions, last ingestion), never your records.</>}</p>
            {can(ctx.role, "manage_members") ? <GrantForm scope={v.grantScope} /> : <p className={s.small}>Your Admin decides this.</p>}
          </div>
        )}
      </section>
    </>
  );
}
