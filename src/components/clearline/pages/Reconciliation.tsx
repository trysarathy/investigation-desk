"use client";
import Link from "../Link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  CURRENCIES, RECONCILIATION_CODE_GROUP, RECONCILIATION_CODE_TEXT, formatMinor, formatMinorPlain, parseAmount,
  type AmountDifference, type CurrencyCode, type ReconciliationCodeGroup, type StatementLine, type StatementLineInput, type Workspace,
} from "@/lib/clearline";
import { errorText, useWorkspace } from "../workspace";
import { label } from "../human";
import { Btn, Chip, Code, Empty, Field, Notice, PageHead, Panel, Status, type Tone, ui } from "../ui";

/** Labels for the engine's code groups (RECONCILIATION_CODE_GROUP); codes stay visible on every row. */
/** Group order; the words are the engine's (HUMAN_LABELS.reconciliationCodeGroup). */
const GROUPS: { key: ReconciliationCodeGroup }[] = [
  { key: "exact" }, { key: "partial" }, { key: "unmatched" }, { key: "duplicate" }, { key: "ambiguous" },
  { key: "currency_mismatch" }, { key: "contradiction" }, { key: "return" }, { key: "informational" },
];
const inGroup = (l: StatementLine, key: string) => l.explanationCodes.some((c) => RECONCILIATION_CODE_GROUP[c] === key);

/** Tone per line status; the words are the engine's (HUMAN_LABELS.statementLineStatus). */
const LINE_TONE: Record<StatementLine["status"], Tone> = { unallocated: "warn", allocated: "ok", partially_allocated: "warn", exception: "bad" };

type Form = Omit<StatementLineInput, "amountMinor"> & { amount: string };

function presets(ws: Workspace): { label: string; form: Form }[] {
  const n = ws.statementLines.length + 1;
  const base: Form = { lineId: `BANK-L${String(n).padStart(4, "0")}`, source: "bank_statement", accountRef: "acct_sandbox_sgd_ops", direction: "credit", kind: "payment", amount: "1250.00", currency: "SGD", reference: "", counterparty: "Unknown remitter (fictional)", valueDate: ws.asOf.slice(0, 10) };
  const sent = [...ws.intents].reverse().find((i) => i.instructionId && ws.instructions.find((x) => x.id === i.instructionId)?.providerPaymentId && i.status.reconciliation !== "matched");
  const ins = sent ? ws.instructions.find((x) => x.id === sent.instructionId) : undefined;
  const last = ws.statementLines[ws.statementLines.length - 1];
  const out = [{ label: "Credit with no reference", form: base }];
  if (sent && ins?.providerPaymentId) {
    const amt = formatMinorPlain(ins.amountMinor, ins.currency);
    out.push({ label: `Debit for ${sent.internalReference} (by provider reference)`, form: { ...base, lineId: `BANK-L${String(n).padStart(4, "0")}`, direction: "debit", reference: ins.providerPaymentId, amount: amt, currency: ins.currency, counterparty: ins.providerId } });
    const short = formatMinorPlain(Math.max(1, Math.floor(ins.amountMinor * 0.9)), ins.currency);
    out.push({ label: `Short debit for ${sent.internalReference} (90% of the amount)`, form: { ...base, direction: "debit", reference: ins.providerPaymentId, amount: short, currency: ins.currency, counterparty: ins.providerId } });
    out.push({ label: `Same reference, wrong currency`, form: { ...base, direction: "debit", reference: ins.providerPaymentId, amount: amt, currency: ins.currency === "USD" ? "SGD" : "USD", counterparty: ins.providerId } });
  }
  if (last) {
    out.push({ label: `Possible duplicate of ${last.lineId}`, form: { ...last, lineId: `BANK-L${String(n).padStart(4, "0")}`, amount: formatMinorPlain(last.amountMinor, last.currency) } });
  }
  return out;
}

export default function Reconciliation() {
  const { ws, dispatch } = useWorkspace();
  const q = useSearchParams();
  const group = q?.get("group") ?? "";
  const status = q?.get("status") ?? "";
  const lines = ws.statementLines.filter((l) => (!group || inGroup(l, group)) && (!status || (status === "open" ? l.status !== "allocated" : l.status === status)));
  const ps = presets(ws);
  const [form, setForm] = useState<Form>(ps[0].form);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const ingest = (e: React.FormEvent) => {
    e.preventDefault();
    setErrs({});
    const amt = parseAmount(form.amount, form.currency as CurrencyCode);
    if (!amt.ok) { setErrs({ amount: amt.error.message }); setMsg({ text: `Line not ingested — fix the amount. ${amt.error.message}`, error: true }); return; }
    const { amount: _a, ...rest } = form;
    void _a;
    const r = dispatch({ type: "ingest_statement_line", line: { ...rest, amountMinor: amt.value } });
    if (!r.ok) {
      const f = r.error.field?.replace(/^line\./, "").replace(/^amountMinor$/, "amount");
      if (f) setErrs({ [f]: r.error.message });
      setMsg({ text: `Line not ingested — ${errorText(r)}`, error: true });
      return;
    }
    const created = r.value.workspace.statementLines.find((l) => r.value.createdIds.includes(l.id));
    setMsg({ text: `Line ingested: ${r.value.outcome.replace(/_/g, " ")}${created ? ` — ${created.explanationCodes.join(", ")}` : ""}.` });
  };

  return (
    <>
      <PageHead eyebrow="Operations" title="Reconciliation"
        lede="Statement lines are matched to payments and repayments only by a trusted reference. An equal amount alone never attributes a line; it stays an exception for a person." />
      <nav aria-label="Reconciliation filters" className={ui.actions} style={{ marginBottom: 12 }}>
        <Link href="/clearline/reconciliation" aria-current={!group && !status ? "true" : undefined} className={`${ui.btn} ${ui.small} ${!group && !status ? ui.toggleOn : ""}`}>All ({ws.statementLines.length})</Link>
        {GROUPS.map((g) => {
          const c = ws.statementLines.filter((l) => inGroup(l, g.key)).length;
          return <Link key={g.key} href={`/clearline/reconciliation?group=${g.key}`} aria-current={group === g.key ? "true" : undefined} className={`${ui.btn} ${ui.small} ${group === g.key ? ui.toggleOn : ""}`}>{label("reconciliationCodeGroup", g.key)} ({c})</Link>;
        })}
      </nav>
      <Panel title={`Statement lines (${lines.length})`} id="lines">
        {lines.length === 0 ? <Empty>No statement lines in this view. Ingest a sample line below.</Empty> : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Statement lines table">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Line</th><th>Source</th><th>Direction</th><th className={ui.r}>Amount</th><th>Reference</th><th>Value date</th><th>Status</th><th>Explanation</th><th>Allocated to</th></tr></thead>
              <tbody>{lines.map((l) => {
                const allocs = ws.allocations.filter((a) => a.statementLineId === l.id);
                // A provider settlement report is provider-reported evidence: recorded, never allocated (CHANGE 4, N1).
                const st: [string, Tone] = l.explanationCodes.includes("RC_PROVIDER_REPORT_ONLY") && l.status === "unallocated" ? ["Provider report (not allocated)", "neutral"] : [label("statementLineStatus", l.status), LINE_TONE[l.status]];
                return (
                  <tr key={l.id} id={l.id}>
                    <td data-label="Line" className="mono">{l.lineId}<span className={ui.sub}>{l.id}</span></td>
                    <td data-label="Source">{label("statementSource", l.source)}<span className={ui.sub}>{l.accountRef}</span></td>
                    <td data-label="Direction">{l.direction} · {l.kind}</td>
                    <td data-label="Amount" className={`${ui.r} ${ui.num}`}>{formatMinor(l.amountMinor, l.currency)}</td>
                    <td data-label="Reference" className="mono">{l.reference || <em>none</em>}<span className={ui.sub}>{l.counterparty}</span></td>
                    <td data-label="Value date" className={ui.num}>{l.valueDate}</td>
                    <td data-label="Status"><Chip tone={st[1]}>{st[0]}</Chip></td>
                    <td data-label="Explanation">{l.explanationCodes.map((c) => <span key={c} style={{ display: "block" }}><Code>{c}</Code> <span className={ui.sub} style={{ display: "inline" }}>{RECONCILIATION_CODE_TEXT[c]}</span></span>)}
                      {(() => { const d = (l as StatementLine & { amountDifference?: AmountDifference }).amountDifference; return d ? (
                        <span className={ui.sub} data-testid="line-amount-difference">Expected <span className="mono">{formatMinor(d.expectedMinor, d.currency)}</span> · reported <span className="mono">{formatMinor(d.reportedMinor, d.currency)}</span> · difference <strong className="mono">{formatMinor(d.differenceMinor, d.currency)}</strong>. {d.requiredNextAction}</span>
                      ) : null; })()}</td>
                    <td data-label="Allocated to">{allocs.length === 0 ? "—" : allocs.map((a) => a.target.kind === "payment"
                      ? <Link key={a.id} href={`/clearline/payments/${a.target.intentId}`} className="mono" style={{ display: "block" }}>{a.target.intentId}</Link>
                      : <Link key={a.id} href="/clearline/treasury/funding" className="mono" style={{ display: "block" }}>{a.target.obligationId}</Link>)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Ingest a sample statement line" id="ingest">
        <form className={ui.panelBody} onSubmit={ingest} aria-label="Ingest statement line" noValidate>
          <Notice info>Fictional statement data only. Pick a preset or edit the fields, then ingest; the engine decides the match and explains it.</Notice>
          <div className={ui.actions} style={{ marginBottom: 12 }}>
            {ps.map((p) => <Btn key={p.label} size="small" onClick={() => { setForm(p.form); setErrs({}); setMsg({ text: `Preset loaded: ${p.label}. Review the fields, then ingest.` }); }}>{p.label}</Btn>)}
          </div>
          <div className={ui.formGrid}>
            <Field label="Line id" error={errs.lineId}><input value={form.lineId} onChange={set("lineId")} /></Field>
            <Field label="Source"><select value={form.source} onChange={set("source")}><option value="bank_statement">Bank statement</option><option value="provider_settlement_report">Provider settlement report</option></select></Field>
            <Field label="Account" error={errs.accountRef}><input value={form.accountRef} onChange={set("accountRef")} /></Field>
            <Field label="Direction"><select value={form.direction} onChange={set("direction")}><option value="credit">Credit</option><option value="debit">Debit</option></select></Field>
            <Field label="Kind"><select value={form.kind} onChange={set("kind")}><option value="payment">Payment</option><option value="return">Return</option><option value="reversal">Reversal</option></select></Field>
            <Field label="Amount" error={errs.amount}><input value={form.amount} onChange={set("amount")} inputMode="decimal" /></Field>
            <Field label="Currency"><select value={form.currency} onChange={set("currency")}>{(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Reference as printed" error={errs.reference}><input value={form.reference} onChange={set("reference")} /></Field>
            <Field label="Counterparty" error={errs.counterparty}><input value={form.counterparty} onChange={set("counterparty")} /></Field>
            <Field label="Value date" error={errs.valueDate}><input type="date" value={form.valueDate} onChange={set("valueDate")} /></Field>
          </div>
          <div className={ui.actions} style={{ marginTop: 12 }}><Btn type="submit" kind="primary">Ingest statement line</Btn></div>
          <Status msg={msg} />
        </form>
      </Panel>
    </>
  );
}
