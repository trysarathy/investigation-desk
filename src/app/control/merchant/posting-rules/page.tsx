import type { Metadata } from "next";
import { headers } from "next/headers";
import { currentSession } from "@/server/auth";
import { STEP_UP_SECONDS } from "@/server/auth-constants";
import { can } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { postingRulesStatus } from "@/server/posting-rules";
import s from "@/components/control/control.module.css";
import { ActionButton, StepUp } from "@/components/control/security-forms";
import { Chip } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Posting rules sign-off" };

const STATUS: Record<string, { label: string; tone: "amber" | "info" | "plain" }> = {
  built_pending_sign_off: { label: "Built: proposed today, pending sign-off", tone: "amber" },
  drafted_not_built: { label: "Drafted: not built, nothing proposed", tone: "info" },
  listed_by_reference: { label: "Listed by reference (earlier receipts product)", tone: "plain" },
};
const GROUPS: [string, string][] = [["document_a", "Document A: merchant reconciliation"], ["fx", "Other-currency balances (FX)"], ["token_priced", "Token-priced invoices"], ["receipts", "USDC invoice receipts (docs/POSTING_RULES.md §4)"]];

export default async function PostingRulesPage() {
  const { ctx } = await merchantMember();
  const st = await postingRulesStatus(ctx);
  const sess = await currentSession(await headers());
  const cat = st.catalogue;
  const maySign = can(ctx.role, "sign_posting_rules") && ctx.entityScope === null;
  const fresh = !!sess?.mfaEnrolled && !!sess.mfaVerifiedAt && Date.now() - sess.mfaVerifiedAt.getTime() <= STEP_UP_SECONDS * 1000;
  return (
    <>
      <h1 className={s.title}>Posting rules sign-off</h1>
      <p className={s.lede}>Every journal pattern Clearline proposes or has drafted, with worked examples computed by the engine itself on fictional figures. An Admin signs one exact version; until the current version is signed, every journal stays a draft and nothing can be sent to a ledger.</p>
      <div className={s.warnBox} role="note"><strong>Signing approves no journal and posts nothing.</strong> Each journal still needs its own approval, and this build sends nothing to any ledger. A change to any rule or example is a new version that needs a new signature.</div>

      <section className={s.section} aria-labelledby="sig">
        <h2 className={s.h2} id="sig">Version {cat.version}</h2>
        <p className={s.small}>SHA-256 <span className={s.mono} data-testid="rules-sha256">{cat.sha256}</span> · {cat.patterns.length} patterns</p>
        {st.signed && st.standing ? (
          <p data-testid="rules-signed"><Chip tone="ok">Signed</Chip> by {st.standing.signedBy} at {st.standing.signedAt.slice(0, 16).replace("T", " ")} UTC (signature <span className={s.mono}>{st.standing.id}</span>).</p>
        ) : (
          <p data-testid="rules-not-signed"><Chip tone="amber">Not signed</Chip> {st.standing ? `The standing signature is for an older version (${st.standing.version}); this version needs a new signature.` : "No version has been signed."} Journals stay drafts.</p>
        )}
        {maySign ? (
          !fresh ? (
            <div className={s.panel}>
              <p className={s.small}>Confirm your authenticator code first (a password is not enough); the signature must follow within 10 minutes.</p>
              <StepUp mfaEnrolled={!!sess?.mfaEnrolled} hasPasskey={false} />
            </div>
          ) : st.signed ? (
            st.standing ? <ActionButton url="/api/control/merchant/posting-rules/revoke" body={{ signatureId: st.standing.id, reason: "Withdrawn by an Admin on the sign-off page" }} label="Withdraw this signature" done="Signature withdrawn: journals are drafts again." flashKey="rules-revoke" variant="danger" confirmText="Withdraw the signature? Journals become drafts again." /> : null
          ) : (
            <ActionButton url="/api/control/merchant/posting-rules/sign" body={{ version: cat.version, sha256: cat.sha256 }} label={`Sign version ${cat.version}`} done={`Signed version ${cat.version}.`} flashKey="rules-sign"
              confirmText={`Sign posting rules ${cat.version} as ${ctx.name}? Your name, the time and this version are recorded and cannot be changed.`} />
          )
        ) : <p className={s.small}>An Admin with access to every entity signs the posting rules.</p>}
      </section>

      {GROUPS.map(([g, title]) => (
        <section className={s.section} key={g} aria-labelledby={`g-${g}`}>
          <h2 className={s.h2} id={`g-${g}`}>{title}</h2>
          {cat.patterns.filter((p) => p.group === g).map((p) => (
            <article className={s.panel} key={p.id} data-testid="rule-pattern">
              <h3 className={s.h3}><span className={s.mono}>{p.id}</span> · {p.title}</h3>
              <p className={s.row}><Chip tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Chip> <span className={s.small}>{p.reference}{p.engine ? ` · engine: ${p.engine}` : ""}</span></p>
              <p className={s.small}>When: {p.when} Debit: {p.debit}. Credit: {p.credit}.</p>
              {p.examples.map((e, i) => (
                <div className={s.tableWrap} key={i} role="region" aria-label={`Worked example ${e.title}`} tabIndex={0}>
                  <table className={s.table}>
                    <caption>{e.title} ({e.currency}{e.entryDate ? `, ${e.entryDate}` : ""}) · computed by {e.source}</caption>
                    <thead><tr><th scope="col">Account</th><th scope="col" className={s.num}>Debit</th><th scope="col" className={s.num}>Credit</th></tr></thead>
                    <tbody>
                      {e.lines.length === 0 ? <tr><td colSpan={3}>No entry: {e.noEntry}. {e.memo}</td></tr> : e.lines.map((l, k) => (
                        <tr key={k}><td>{l.accountName}{l.onApproval ? <span className={s.small}> (on approval: {l.onApproval})</span> : null}</td><td className={s.num}>{l.side === "debit" ? l.amount : ""}</td><td className={s.num}>{l.side === "credit" ? l.amount : ""}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </article>
          ))}
        </section>
      ))}

      {st.history.length ? (
        <section className={s.section} aria-labelledby="hist">
          <h2 className={s.h2} id="hist">Signatures</h2>
          <ul className={s.small}>{st.history.map((h) => <li key={h.id}>{h.version} signed by {h.signedBy} at {h.signedAt.slice(0, 16).replace("T", " ")} UTC{h.revokedAt ? `; withdrawn ${h.revokedAt.slice(0, 16).replace("T", " ")} UTC (${h.revokedReason ?? ""})` : ""}</li>)}</ul>
        </section>
      ) : null}
    </>
  );
}
