import type { Metadata } from "next";
import { can, ROLE_LABELS, isAppRole } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { orNotFound } from "@/server/control-page";
import { MEMBER_ROLES, setupView, STEP_LABELS, TEMPLATE_FILE_TYPES, WIZARD_STEPS, type SetupView } from "@/server/onboarding/wizard";
import type { SetupStep } from "@/server/db/onboarding-schema";
import s from "@/components/control/control.module.css";
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
    return (<><h1 className={s.title}>Setup</h1><Empty>Only an Admin of this organisation runs its setup.</Empty></>);
  }
  if (!process.env.DATABASE_PROVISIONING_URL && process.env.CLEARLINE_DB_FROM_NEON !== "1") {
    return (<><h1 className={s.title}>Setup</h1><Empty>Setup is not available on this deployment: your operator sets up the organisation with the administration command.</Empty></>);
  }
  const v = await orNotFound(setupView(ctx));
  const asked = one((await searchParams).step);
  const step: SetupStep = (WIZARD_STEPS as readonly string[]).includes(asked ?? "") ? asked as SetupStep : WIZARD_STEPS.find((x) => !v.steps[x]) ?? "finish";
  const doneCount = WIZARD_STEPS.filter((x) => x !== "finish" && v.steps[x]).length;
  const i = WIZARD_STEPS.indexOf(step);
  const next = WIZARD_STEPS[i + 1];
  return (
    <>
      <h1 className={s.title}>Setup</h1>
      <p className={s.lede}>Set up {v.orgName}: its entities, ledger, bank accounts, matching tolerance, provider, mapping templates and people. {v.finished ? "" : `${doneCount} of ${WIZARD_STEPS.length - 1} steps done.`}</p>
      {v.finished ? <p className={s.panel} role="status" data-testid="setup-finished"><Chip tone="ok">Setup finished</Chip> on {when(v.steps.finish)}. This page is now read-only: later changes go through your operator, or the Settings page for matching policy.</p> : null}

      <nav aria-label="Setup steps" className={s.section}>
        <ol className={s.row} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {WIZARD_STEPS.map((x, n) => (
            <li key={x}>
              <a href={`/control/merchant/setup?step=${x}`} aria-current={x === step ? "step" : undefined} data-testid={`step-link-${x}`}
                style={{ fontWeight: x === step ? 700 : 400, display: "inline-block", minHeight: 28, padding: "4px 2px" }}>
                {n + 1}. {STEP_LABELS[x]}{v.steps[x] ? " (done)" : ""}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section className={s.section} aria-labelledby="step-h" data-testid={`step-${step}`}>
        <h2 className={s.h2} id="step-h">Step {i + 1}: {STEP_LABELS[step]}</h2>
        <Step step={step} v={v} />
        {!v.finished && step !== "finish" ? (
          <div className={s.row}>
            {v.steps[step] ? <p className={s.small}><Chip tone="ok">Done</Chip> on {when(v.steps[step])}</p>
              : <ActionButton flashKey={`setup:step:${step}`} url={`${API}/step`} body={{ step }} label={`Mark "${STEP_LABELS[step]}" done`} success={`Saved: ${STEP_LABELS[step]} is done.`} variant="secondary" />}
            {next ? <a href={`/control/merchant/setup?step=${next}`}>Next: {STEP_LABELS[next]}</a> : null}
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
        <p className={s.small}>Each legal entity has one functional currency (SGD, USD or AED) and one business day (its time zone). Neither changes once it holds data. Each entity starts with the approved default matching policy.</p>
        <Table caption="Entities" head={["Entity", "Legal name", "Currency", "Time zone", "UTC offset"]} rows={v.entities.map((e) => [e.id, e.name, e.currency, e.timezone, `${e.utcOffsetMinutes} min`])} empty="No entity yet." testid="entity-row" />
        {open ? <div className={s.panel}><JsonForm flashKey="setup:entity" url={`${API}/entity`} submit="Add entity" success="Saved: the entity and its default policy were created."
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
        <p className={s.small}>Which accounting system each entity&rsquo;s journal files are prepared for. This is a choice only: nothing connects to Xero or QuickBooks here.</p>
        {v.entities.length === 0 ? <Empty>Add an entity first.</Empty> : v.entities.map((e) => (
          <div className={s.panel} key={e.id} data-testid="ledger-row">
            <p><strong>{e.id}</strong> · {e.name}: <span data-testid={`ledger-${e.id}`}>{LEDGER_LABEL[e.ledger] ?? e.ledger}</span></p>
            {open ? <JsonForm flashKey={`setup:ledger:${e.id}`} url={`${API}/ledger`} extra={{ entityId: e.id }} submit={`Save ledger for ${e.id}`} success={`Saved: the ledger for ${e.id}.`} variant="secondary"
              fields={[{ name: "ledger", label: `Ledger for ${e.id}`, type: "select", required: true, defaultValue: e.ledger, options: LEDGERS }]} /> : null}
          </div>
        ))}
      </>
    );
    case "bank_accounts": return (
      <>
        <p className={s.small}>The accounts your statements come from. Only the last four characters of the account number are stored, never the full number. An account&rsquo;s currency may differ from its entity&rsquo;s.</p>
        <Table caption="Bank accounts" head={["Entity", "Name", "Currency", "Number", "Bank", "Status"]} rows={v.bankAccounts.map((a) => [a.entityId, a.name, a.currency, `•••• ${a.last4}`, a.bankName, a.status])} empty="No bank account yet." testid="bank-account-row" />
        {open && v.entities.length ? <div className={s.panel}><JsonForm flashKey="setup:bank" url={`${API}/bank-account`} submit="Add bank account" success="Saved: the bank account was added."
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
        <p className={s.small}>When an amount differs from the invoice by no more than the tolerance, the difference is typed and shown for review; an amount alone never closes a match. The approved default per entity is the larger of 0.5% or SGD 5 / USD 5 / AED 20. Imported bank statements never count as bank-authenticated.</p>
        <Table caption="Matching tolerance per entity" head={["Entity", "Tolerance", "Write-off threshold rule", "Policy"]}
          rows={v.entities.map((e) => [e.id, e.policy ? `${e.policy.toleranceCombine === "larger" ? "Larger" : "Smaller"} of ${(e.policy.toleranceBps / 100).toFixed(2)}% or ${money(e.policy.toleranceAbsMinor, e.currency)}` : "—",
            "Same fixed amount", e.policy ? (e.policy.isDefault ? `Default (revision ${e.policy.revision})` : `Changed in Settings (revision ${e.policy.revision})`) : "—"])} empty="Add an entity first." testid="tolerance-row" />
        <p className={s.small}>Keep the default here. To change an entity&rsquo;s tolerance, an Admin uses the <a href="/control/merchant/settings">Settings page</a> (same validation, audited, one revision at a time).</p>
      </>
    );
    case "provider": return (
      <>
        <p className={s.small}>The payment provider whose exports and settlement reports you reconcile. A linked provider sees aggregates only, until you grant more in Settings.</p>
        {v.providerName ? <p data-testid="provider-linked">Linked to <strong>{v.providerName}</strong>.</p> : <p data-testid="provider-none">No provider is linked.</p>}
        {open && !v.providerName ? <div className={s.panel}><JsonForm flashKey="setup:provider" url={`${API}/provider`} submit="Link provider" success="Saved: the provider is linked (aggregates only)." variant="secondary"
          fields={[{ name: "providerSlug", label: "Provider code", required: true, maxLength: 63, hint: "The code your provider gave you, e.g. northwind-pay." }]} /></div> : null}
      </>
    );
    case "mapping_templates": return (
      <>
        <p className={s.small}>Optional. Paste the header row of a file you will upload; Clearline suggests which column holds each field and saves it as a template only if every required field is found. You still confirm the mapping on every upload. Otherwise, map each file type on its first upload.</p>
        <Table caption="Mapping templates" head={["Name", "File type", "Version"]} rows={v.templates.map((x) => [x.name, FILE_TYPE_LABEL[x.fileType] ?? x.fileType, String(x.version)])} empty="No mapping template yet." testid="template-row" />
        {open ? <div className={s.panel}><JsonForm flashKey="setup:template" url={`${API}/mapping-template`} submit="Save template" success="Saved: the mapping template." variant="secondary"
          fields={[
            { name: "fileType", label: "File type", type: "select", required: true, options: TEMPLATE_FILE_TYPES.map((x) => ({ value: x, label: FILE_TYPE_LABEL[x] })) },
            { name: "name", label: "Template name", required: true, maxLength: 120 },
            { name: "headerLine", label: "Header row", type: "textarea", required: true, maxLength: 4000, hint: "Column names only (comma, semicolon or tab separated). Never paste data rows." },
          ]} /></div> : null}
      </>
    );
    case "members": return (
      <>
        <p className={s.small}>Invite your team. Each person gets a one-time link (valid three days): by email when this deployment sends email, otherwise shown to you once to copy. Least privilege: an Admin manages members but holds no financial authority; only an Approver approves, and never their own request.</p>
        <Table caption="Members" head={["Name", "Email", "Role"]} rows={v.members.map((m) => [m.name, m.email, m.revoked ? "Revoked" : isAppRole(m.role) ? ROLE_LABELS[m.role] : m.role])} empty="No member." testid="member-row" />
        <h3 className={s.label}>Pending invitations</h3>
        {v.invitations.length === 0 ? <Empty>No pending invitation.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Pending invitations table" tabIndex={0}>
            <table className={s.table}>
              <caption>Pending invitations</caption>
              <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Expires</th><th scope="col">Action</th></tr></thead>
              <tbody>
                {v.invitations.map((x) => (
                  <tr key={x.id} data-testid="invitation-row">
                    <td>{x.email}</td><td>{isAppRole(x.role) ? ROLE_LABELS[x.role] : x.role}</td><td>{x.expired ? "Expired" : when(x.expiresAt)}</td>
                    <td>{open ? <ActionButton flashKey={`setup:revoke:${x.id}`} url={`${API}/revoke-invitation`} body={{ invitationId: x.id }} label={`Revoke invitation for ${x.email}`} success="Saved: the invitation was revoked." variant="secondary" /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open ? <div className={s.panel}><JsonForm flashKey="setup:invite" url={`${API}/invite`} submit="Send invitation" success="Sent: the invitation email is on its way."
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
          <ul>
            {WIZARD_STEPS.filter((x) => x !== "finish").map((x) => (
              <li key={x}>{STEP_LABELS[x]}: {v.steps[x] ? "done" : required.includes(x) ? "not done (required)" : "not done (optional)"}</li>
            ))}
          </ul>
          {v.finished ? null : <ActionButton flashKey="setup:finish" url={`${API}/step`} body={{ step: "finish" }} label="Finish setup" success="Setup finished." />}
          {v.finished ? null : <p className={s.small}>Finishing makes this page read-only. Entities, ledger and tolerance must be done first.</p>}
        </>
      );
    }
  }
}

function Table({ caption, head, rows, empty, testid }: { caption: string; head: string[]; rows: string[][]; empty: string; testid: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className={s.tableWrap} role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className={s.table}>
        <caption>{caption}</caption>
        <thead><tr>{head.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, n) => <tr key={n} data-testid={testid}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const dynamic = "force-dynamic";
