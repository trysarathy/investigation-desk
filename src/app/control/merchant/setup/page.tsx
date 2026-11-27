import type { Metadata } from "next";
import { can, ROLE_LABELS, isAppRole } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { orNotFound } from "@/server/control-page";
import { MEMBER_ROLES, setupView, STEP_LABELS, TEMPLATE_FILE_TYPES, WIZARD_STEPS, type SetupView } from "@/server/onboarding/wizard";
import type { SetupStep } from "@/server/db/onboarding-schema";
import type { ReactNode } from "react";
import s from "@/components/control/control.module.css";
import x from "@/components/control/screens.module.css";
import { MemberStatus } from "@/components/control/member-status";
import { InvitationsTable } from "@/components/merchant/admin-tables";
import { IconCheck } from "@/components/ui/icons";
import { Chip, Empty, one } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";
import { ActionButton, JsonForm, type FieldDef } from "@/components/onboarding/forms";

export const metadata: Metadata = { title: "Setup" };

const API = "/api/control/merchant/setup";
const CURRENCIES = [{ value: "SGD", label: "SGD" }, { value: "USD", label: "USD" }, { value: "AED", label: "AED" }];
const LEDGERS = [{ value: "none", label: "None (files only)" }, { value: "xero", label: "Xero" }, { value: "quickbooks", label: "QuickBooks Online" }];
const LEDGER_LABEL: Record<string, string> = { none: "None (files only)", xero: "Xero", quickbooks: "QuickBooks Online" };
const FILE_TYPE_LABEL: Record<string, string> = { orders_invoices: "Orders and invoices", bank_statement: "Bank statement (CSV or XLSX)", ledger_invoices: "Ledger invoices", provider_export: "Provider export", settlement_report: "Settlement report", settlement_payments: "Settlement payments" };
const money = (minor: string, cur: string) => `${cur} ${(Number(minor) / 100).toFixed(2)}`;

/**
 * v1 phase 1.1: the merchant's setup wizard, for its Admin. One step at a time (?step=…); every write goes through the
 * provisioning role and is audited. After "Finish setup" the page is read-only.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx } = await merchantMember();
  if (!can(ctx.role, "manage_members")) {
    return (<><div className={x.head}><div className={x.headText}><h1 className={s.title}>Setup</h1></div></div><Empty>Only an Admin of this organisation runs its setup.</Empty></>);
  }
  if (!process.env.DATABASE_PROVISIONING_URL && process.env.CLEARLINE_DB_FROM_NEON !== "1") {
    return (<><div className={x.head}><div className={x.headText}><h1 className={s.title}>Setup</h1></div></div><Empty>Setup is not available on this deployment: your operator sets up the organisation with the administration command.</Empty></>);
  }
  const v = await orNotFound(setupView(ctx));
  const asked = one((await searchParams).step);
  const step: SetupStep = (WIZARD_STEPS as readonly string[]).includes(asked ?? "") ? asked as SetupStep : WIZARD_STEPS.find((k) => !v.steps[k]) ?? "finish";
  const doneCount = WIZARD_STEPS.filter((k) => k !== "finish" && v.steps[k]).length;
  const i = WIZARD_STEPS.indexOf(step);
  const next = WIZARD_STEPS[i + 1];
  const total = WIZARD_STEPS.length - 1;
  return (
    <>
      <div className={x.head}>
        <div className={x.headText}>
          <h1 className={s.title}>Setup</h1>
          <p>Set up {v.orgName}: its entities, ledger, bank accounts, matching tolerance, provider, mapping templates and people. {v.finished ? "" : `${doneCount} of ${total} steps done.`}</p>
        </div>
      </div>
      {v.finished ? <p className={`${x.callout} ${x.calloutOk}`} role="status" data-testid="setup-finished"><IconCheck /><span><Chip tone="ok">Setup finished</Chip> on <span className={x.mono}>{when(v.steps.finish)}</span>. This page is now read-only: later changes go through your operator, or the Settings page for matching policy.</span></p>
        : <div className={x.progress} aria-hidden="true"><span className={x.progressBar} style={{ width: `${Math.round((doneCount / total) * 100)}%` }} /></div>}

      <nav aria-label="Setup steps" className={x.section}>
        <ol className={x.steps}>
          {WIZARD_STEPS.map((k, n) => (
            <li key={k}>
              <a href={`/control/merchant/setup?step=${k}`} aria-current={k === step ? "step" : undefined} data-testid={`step-link-${k}`} className={`${x.step} ${v.steps[k] ? x.stepDone : ""}`}>
                <span className={x.stepNum} aria-hidden="true">{v.steps[k] ? <IconCheck size={12} /> : n + 1}</span>
                <span><span className={x.srOnly}>{n + 1}. </span>{STEP_LABELS[k]}{v.steps[k] ? <span className={x.srOnly}> (done)</span> : ""}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section className={x.section} aria-labelledby="step-h" data-testid={`step-${step}`}>
        <div className={x.sectionHead}><h2 id="step-h">Step {i + 1}: {STEP_LABELS[step]}</h2></div>
        <Step step={step} v={v} />
        {!v.finished && step !== "finish" ? (
          <div className={x.row}>
            {v.steps[step] ? <p className={x.note}><Chip tone="ok">Done</Chip> on <span className={x.mono}>{when(v.steps[step])}</span></p>
              : <ActionButton flashKey={`setup:step:${step}`} url={`${API}/step`} body={{ step }} label={`Mark "${STEP_LABELS[step]}" done`} success={`Saved: ${STEP_LABELS[step]} is done.`} variant="secondary" />}
            {next ? <a className={x.linkButton} href={`/control/merchant/setup?step=${next}`}>Next: {STEP_LABELS[next]}</a> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function Step({ step, v }: { step: SetupStep; v: SetupView }) {
  const open = !v.finished;
  const entityOptions = v.entities.map((e) => ({ value: e.id, label: `${e.id} · ${e.name} (${e.currency})` }));
  switch (step) {
    case "entities": return (
      <>
        <p className={x.note}>Each legal entity has one functional currency (SGD, USD or AED) and one business day (its time zone). Neither changes once it holds data. Each entity starts with the approved default matching policy.</p>
        <Table caption="Entities" head={["Entity", "Legal name", "Currency", "Time zone", "UTC offset"]} rows={v.entities.map((e) => [e.id, e.name, e.currency, e.timezone, `${e.utcOffsetMinutes} min`])} empty="No entity yet." testid="entity-row" mono={[0, 2, 4]} />
        {open ? <div className={`${x.card} ${x.formCard}`}><JsonForm flashKey="setup:entity" url={`${API}/entity`} submit="Add entity" success="Saved: the entity and its default policy were created."
          fields={[
            { name: "entityId", label: "Entity code", required: true, maxLength: 64, hint: "Letters, digits, dashes or underscores, e.g. SG-OPS. It never changes." },
            { name: "name", label: "Legal name", required: true, maxLength: 200 },
            { name: "currency", label: "Functional currency", type: "select", required: true, options: CURRENCIES },
            { name: "timezone", label: "Time zone", required: true, defaultValue: "Asia/Singapore", hint: "An IANA time zone; the entity's business day follows its UTC offset." },
            { name: "utcOffset", label: "Fixed UTC offset", maxLength: 10, hint: "e.g. +08:00. Leave empty to use the time zone's current offset." },
          ]} /></div> : null}
      </>
    );
    case "ledger": return (
      <>
        <p className={x.note}>Which accounting system each entity&rsquo;s journal files are prepared for. This is a choice only: nothing connects to Xero or QuickBooks here.</p>
        {v.entities.length === 0 ? <Empty>Add an entity first.</Empty> : v.entities.map((e) => (
          <div className={`${x.card} ${x.formCard}`} key={e.id} data-testid="ledger-row">
            <p><strong className={x.mono}>{e.id}</strong> · {e.name}: <span data-testid={`ledger-${e.id}`}>{LEDGER_LABEL[e.ledger] ?? e.ledger}</span></p>
            {open ? <JsonForm flashKey={`setup:ledger:${e.id}`} url={`${API}/ledger`} extra={{ entityId: e.id }} submit={`Save ledger for ${e.id}`} success={`Saved: the ledger for ${e.id}.`} variant="secondary"
              fields={[{ name: "ledger", label: `Ledger for ${e.id}`, type: "select", required: true, defaultValue: e.ledger, options: LEDGERS }]} /> : null}
          </div>
        ))}
      </>
    );
    case "bank_accounts": return (
      <>
        <p className={x.note}>The accounts your statements come from. Only the last four characters of the account number are stored, never the full number. An account&rsquo;s currency may differ from its entity&rsquo;s.</p>
        <Table caption="Bank accounts" head={["Entity", "Name", "Currency", "Number", "Bank", "Status"]} rows={v.bankAccounts.map((a) => [a.entityId, a.name, a.currency, `•••• ${a.last4}`, a.bankName, a.status])} empty="No bank account yet." testid="bank-account-row" mono={[0, 2, 3]} />
        {open && v.entities.length ? <div className={`${x.card} ${x.formCard}`}><JsonForm flashKey="setup:bank" url={`${API}/bank-account`} submit="Add bank account" success="Saved: the bank account was added."
          fields={[
            { name: "entityId", label: "Entity", type: "select", required: true, options: entityOptions },
            { name: "name", label: "Account name", required: true, maxLength: 120, hint: "How your team calls it, e.g. Operating SGD." },
            { name: "currency", label: "Account currency", type: "select", required: true, options: CURRENCIES },
            { name: "last4", label: "Last four characters of the account number", required: true, maxLength: 12, autoComplete: "off" },
            { name: "bankName", label: "Bank", required: true, maxLength: 120 },
            { name: "bic", label: "BIC", maxLength: 11 },
          ]} /></div> : null}
      </>
    );
    case "tolerance": return (
      <>
        <p className={x.note}>When an amount differs from the invoice by no more than the tolerance, the difference is typed and shown for review; an amount alone never closes a match. The approved default per entity is the larger of 0.5% or SGD 5 / USD 5 / AED 20. Imported bank statements never count as bank-authenticated.</p>
        <Table caption="Matching tolerance per entity" head={["Entity", "Tolerance", "Write-off threshold rule", "Policy"]}
          rows={v.entities.map((e) => [e.id, e.policy ? `${e.policy.toleranceCombine === "larger" ? "Larger" : "Smaller"} of ${(e.policy.toleranceBps / 100).toFixed(2)}% or ${money(e.policy.toleranceAbsMinor, e.currency)}` : "—",
            "Same fixed amount", e.policy ? (e.policy.isDefault ? `Default (revision ${e.policy.revision})` : `Changed in Settings (revision ${e.policy.revision})`) : "—"])} empty="Add an entity first." testid="tolerance-row" mono={[0]} />
        <p className={x.note}>Keep the default here. To change an entity&rsquo;s tolerance, an Admin uses the <a href="/control/merchant/settings">Settings page</a> (same validation, audited, one revision at a time).</p>
      </>
    );
    case "provider": return (
      <>
        <p className={x.note}>The payment provider whose exports and settlement reports you reconcile. A linked provider sees aggregates only, until you grant more in Settings.</p>
        {v.providerName ? <p data-testid="provider-linked">Linked to <strong>{v.providerName}</strong>.</p> : <p data-testid="provider-none">No provider is linked.</p>}
        {open && !v.providerName ? <div className={`${x.card} ${x.formCard}`}><JsonForm flashKey="setup:provider" url={`${API}/provider`} submit="Link provider" success="Saved: the provider is linked (aggregates only)." variant="secondary"
          fields={[{ name: "providerSlug", label: "Provider code", required: true, maxLength: 63, hint: "The code your provider gave you, e.g. northwind-pay." }]} /></div> : null}
      </>
    );
    case "mapping_templates": return (
      <>
        <p className={x.note}>Optional. Paste the header row of a file you will upload; Clearline suggests which column holds each field and saves it as a template only if every required field is found. You still confirm the mapping on every upload. Otherwise, map each file type on its first upload.</p>
        <Table caption="Mapping templates" head={["Name", "File type", "Version"]} rows={v.templates.map((t) => [t.name, FILE_TYPE_LABEL[t.fileType] ?? t.fileType, String(t.version)])} empty="No mapping template yet." testid="template-row" />
        {open ? <div className={`${x.card} ${x.formCard}`}><JsonForm flashKey="setup:template" url={`${API}/mapping-template`} submit="Save template" success="Saved: the mapping template." variant="secondary"
          fields={[
            { name: "fileType", label: "File type", type: "select", required: true, options: TEMPLATE_FILE_TYPES.map((f) => ({ value: f, label: FILE_TYPE_LABEL[f] })) },
            { name: "name", label: "Template name", required: true, maxLength: 120 },
            { name: "headerLine", label: "Header row", type: "textarea", required: true, maxLength: 4000, hint: "Column names only (comma, semicolon or tab separated). Never paste data rows." },
          ]} /></div> : null}
      </>
    );
    case "members": return (
      <>
        <p className={x.note}>Invite your team. Each person gets a one-time link (valid three days): by email when this deployment sends email, otherwise shown to you once to copy. Least privilege: an Admin manages members but holds no financial authority; only an Approver approves, and never their own request.</p>
        <Table caption="Members" head={["Name", "Email", "Role", "Status"]} mono={[1]} rows={v.members.map((m) => [m.name, m.email, m.revoked ? "Revoked" : isAppRole(m.role) ? ROLE_LABELS[m.role] : m.role, <MemberStatus key="st" state={m.revoked ? "deactivated" : "active"} />])} empty="No member." testid="member-row" />
        <h3 className={x.h3}>Pending invitations</h3>
        {v.invitations.length === 0 ? <Empty>No pending invitation.</Empty> : (
          <InvitationsTable api={API} flashPrefix="setup" success="Saved: the invitation was revoked." canRevoke={open}
            rows={v.invitations.map((i) => ({ id: i.id, email: i.email, role: isAppRole(i.role) ? ROLE_LABELS[i.role] : i.role, expired: i.expired, expires: when(i.expiresAt) }))} />
        )}
        {open ? <div className={`${x.card} ${x.formCard}`}><JsonForm flashKey="setup:invite" url={`${API}/invite`} submit="Send invitation" success="Sent: the invitation email is on its way."
          fields={[
            { name: "email", label: "Email", type: "email", required: true, maxLength: 254 },
            { name: "role", label: "Role", type: "select", required: true, options: MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })), defaultValue: "finance" },
          ] satisfies FieldDef[]} /></div> : null}
      </>
    );
    case "finish": {
      const required: SetupStep[] = ["entities", "ledger", "tolerance"];
      return (
        <>
          <ul className={x.checklist}>
            {WIZARD_STEPS.filter((k) => k !== "finish").map((k) => (
              <li key={k}><span className={`${x.stepNum} ${v.steps[k] ? x.stepDone : ""}`} aria-hidden="true">{v.steps[k] ? <IconCheck size={12} /> : null}</span>{STEP_LABELS[k]}: {v.steps[k] ? "done" : required.includes(k) ? "not done (required)" : "not done (optional)"}</li>
            ))}
          </ul>
          {v.finished ? null : <ActionButton flashKey="setup:finish" url={`${API}/step`} body={{ step: "finish" }} label="Finish setup" success="Setup finished." />}
          {v.finished ? null : <p className={x.note}>Finishing makes this page read-only. Entities, ledger and tolerance must be done first.</p>}
        </>
      );
    }
  }
}

function Table({ caption, head, rows, empty, testid, mono = [] }: { caption: string; head: string[]; rows: ReactNode[][]; empty: string; testid: string; mono?: number[] }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className={s.tableWrap} role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className={s.table}>
        <caption>{caption}</caption>
        <thead><tr>{head.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, n) => <tr key={n} data-testid={testid}>{r.map((c, k) => <td key={k} className={mono.includes(k) ? x.mono : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const dynamic = "force-dynamic";
