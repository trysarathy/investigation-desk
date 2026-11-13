"use client";
import Link from "../Link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CURRENCIES, QUOTE_LABEL, formatMinor, formatMoney, getIntent, parseAmount,
  type CurrencyCode, type SandboxOutcome,
} from "@/lib/clearline";
import { errorText, useWorkspace } from "../workspace";
import { ExecChip, RAIL } from "../labels";
import { SimulateEvent } from "../SimulateEvent";
import { Btn, Chip, Code, Empty, Field, Notice, PageHead, Panel, Status, fmtTime, ui } from "../ui";

type Msg = { text: string; error?: boolean } | null;
const OUTCOMES: [SandboxOutcome, string][] = [
  ["success", "Success — provider reports completion"],
  ["return", "Return — beneficiary rejected"],
  ["hold", "Hold — partner compliance review"],
  ["chain_delay", "Chain delay — Base Sepolia finality"],
];
const STEPS = ["Create intent", "Request quotes", "Choose route (maker)", "Checker approval", "Submit", "Provider event"];

function newKey() {
  return "idem_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function CreateForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { ws, dispatch } = useWorkspace();
  const [f, setF] = useState({
    internalReference: "INV-2026-201", amount: "12500.00", sourceCurrency: "SGD" as CurrencyCode, destinationCurrency: "PHP" as CurrencyCode,
    purpose: "Supplier invoice", beneficiaryName: "Supplier Alpha (fictional)", beneficiaryRef: "ben_test_alpha",
    destinationCountry: "PH", requestedExecutionDate: ws.asOf.slice(0, 10), idempotencyKey: "", sandboxOutcome: "success" as SandboxOutcome,
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => setF((x) => (x.idempotencyKey ? x : { ...x, idempotencyKey: newKey() })), []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrs({});
    const amt = parseAmount(f.amount, f.sourceCurrency);
    if (!amt.ok) { setErrs({ amount: amt.error.message }); setMsg({ text: "Fix the highlighted field.", error: true }); return; }
    const { amount: _a, ...rest } = f;
    void _a;
    const r = dispatch({ type: "create_intent", input: { ...rest, amountMinor: amt.value } });
    if (!r.ok) {
      setErrs({ [r.error.field ?? "form"]: r.error.message });
      setMsg({ text: `Intent not created — ${errorText(r)}`, error: true });
      return;
    }
    const id = r.value.createdIds[0];
    setMsg({ text: r.value.outcome === "idempotent_replay" ? `Idempotent replay: the existing intent ${id} was returned, nothing new was created.` : `Intent ${id} created.` });
    onCreated(id);
  };

  return (
    <form onSubmit={submit} noValidate className={ui.panelBody} aria-label="Create payment intent">
      <div className={ui.formGrid}>
        <Field label="Customer reference" error={errs.internalReference}><input name="internalReference" value={f.internalReference} onChange={set("internalReference")} required /></Field>
        <Field label="Amount" hint="Up to the currency's decimals, e.g. 12500.00" error={errs.amount ?? errs.amountMinor}><input name="amount" inputMode="decimal" value={f.amount} onChange={set("amount")} required /></Field>
        <Field label="Source currency" error={errs.sourceCurrency}><select name="sourceCurrency" value={f.sourceCurrency} onChange={set("sourceCurrency")}>{(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Destination currency" error={errs.destinationCurrency}><select name="destinationCurrency" value={f.destinationCurrency} onChange={set("destinationCurrency")}>{(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Beneficiary name (fictional)" error={errs.beneficiaryName}><input name="beneficiaryName" value={f.beneficiaryName} onChange={set("beneficiaryName")} /></Field>
        <Field label="Beneficiary reference" hint="Opaque test reference, never bank details" error={errs.beneficiaryRef}><input name="beneficiaryRef" value={f.beneficiaryRef} onChange={set("beneficiaryRef")} /></Field>
        <Field label="Destination country (ISO)" error={errs.destinationCountry}><input name="destinationCountry" value={f.destinationCountry} onChange={set("destinationCountry")} maxLength={2} /></Field>
        <Field label="Requested execution date" error={errs.requestedExecutionDate}><input name="requestedExecutionDate" type="date" value={f.requestedExecutionDate} onChange={set("requestedExecutionDate")} /></Field>
        <Field label="Purpose" error={errs.purpose}><input name="purpose" value={f.purpose} onChange={set("purpose")} /></Field>
        <Field label="Idempotency key" hint="Re-sending the same key returns the same intent" error={errs.idempotencyKey}><input name="idempotencyKey" className="mono" value={f.idempotencyKey} onChange={set("idempotencyKey")} /></Field>
        <Field label="Sandbox outcome" hint="Like a test card number: picks the simulated provider's behaviour"><select name="sandboxOutcome" value={f.sandboxOutcome} onChange={set("sandboxOutcome")}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      {errs.form && <p className={ui.err} role="alert">{errs.form}</p>}
      <div className={ui.actions} style={{ marginTop: 12 }}><Btn type="submit" kind="primary">Create test intent</Btn></div>
      <Status msg={msg} />
    </form>
  );
}

export default function Connect() {
  const { ws, dispatch, actors, actorName } = useWorkspace();
  const router = useRouter();
  const q = useSearchParams();
  const intentId = q?.get("intent") ?? "";
  const intent = intentId ? getIntent(ws, intentId) : undefined;
  const [msg, setMsg] = useState<Msg>(null);
  const [checker, setChecker] = useState("usr_daniel");
  const [rejectReason, setRejectReason] = useState("");

  const go = (id: string) => router.replace(`/clearline/connect?intent=${encodeURIComponent(id)}`);
  const act = (label: string, r: ReturnType<typeof dispatch>) => {
    setMsg(r.ok ? { text: `${label}: ${r.value.outcome.replace(/_/g, " ")}.` } : { text: `${label} not applied — ${errorText(r)}`, error: true });
    return r.ok;
  };

  const quotes = intent ? ws.quotes.filter((x) => x.intentId === intent.id) : [];
  const instr = intent?.instructionId ? ws.instructions.find((x) => x.id === intent.instructionId) : undefined;
  const step = !intent ? 0 : !quotes.length ? 1 : !instr ? 2 : instr.status === "pending_approval" ? 3 : instr.status === "approved" ? 4 : instr.status === "submitted" ? 5 : 2;
  const inFlight = ws.intents.filter((i) => ["created", "quoted", "approved", "submitted"].includes(i.status.execution));

  return (
    <>
      <PageHead eyebrow="Connect" title="Payment intents"
        lede="Create a fictional payment, compare indicative sandbox quotes, prepare and approve it with two different people, submit it, then simulate what the provider reports." />
      <Notice>No partner is contacted. Quotes are indicative and not executable; the provider is a sandbox adapter.</Notice>
      <ol className={ui.steps} aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} className={`${ui.step} ${i < step ? ui.stepDone : i === step ? ui.stepNow : ""}`} aria-current={i === step ? "step" : undefined}>{i + 1}. {s}{i < step ? " ✓" : ""}</li>)}
      </ol>
      <Status msg={msg} />

      {!intent ? (
        <Panel title="1. Create a payment intent" id="create">
          <CreateForm onCreated={(id) => go(id)} />
        </Panel>
      ) : (
        <Panel title={`Intent ${intent.internalReference}`} id="intent" actions={<><ExecChip v={intent.status.execution} /><Link href={`/clearline/payments/${intent.id}`}>Investigation view</Link><Link href="/clearline/connect">Start another</Link></>}>
          <div className={ui.panelBody}>
            <dl className={ui.dl}>
              <div><dt>Internal ID</dt><dd className="mono" data-testid="intent-id">{intent.id}</dd></div>
              <div><dt>Idempotency key</dt><dd className="mono" data-testid="idempotency-key">{intent.idempotencyKey}</dd></div>
              <div><dt>Amount</dt><dd className="num">{formatMoney({ amountMinor: intent.amountMinor, currency: intent.sourceCurrency })} → {intent.destinationCurrency}</dd></div>
              <div><dt>Beneficiary</dt><dd>{intent.beneficiaryName} · {intent.destinationCountry}</dd></div>
              <div><dt>Sandbox outcome</dt><dd>{intent.sandboxOutcome}</dd></div>
              <div><dt>Created by</dt><dd>{actorName(intent.createdBy)}</dd></div>
            </dl>
          </div>
        </Panel>
      )}

      {intent && step === 1 && (
        <Panel title="2. Request quotes" id="quote">
          <div className={ui.panelBody}><Btn kind="primary" onClick={() => act("Quotes requested", dispatch({ type: "request_quotes", intentId: intent.id }))}>Request quotes</Btn></div>
        </Panel>
      )}

      {intent && quotes.length > 0 && (
        <Panel title="Compare routes" id="routes" actions={<Chip tone="warn">{QUOTE_LABEL}</Chip>}>
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Route comparison">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Provider</th><th>Rail</th><th className={ui.r}>Indicative rate</th><th className={ui.r}>Fees</th><th className={ui.r}>Est. recipient</th><th>ETA</th><th>Eligibility</th><th>Freshness</th><th><span className={ui.srOnly}>Action</span></th></tr></thead>
              <tbody>
                {quotes.map((qt) => (
                  <tr key={qt.id}>
                    <td data-label="Provider">{qt.providerName}<span className={ui.sub}>{qt.source}</span></td>
                    <td data-label="Rail">{RAIL[qt.rail]}</td>
                    <td data-label="Indicative rate" className={`${ui.r} ${ui.num}`}>{qt.indicativeRate}</td>
                    <td data-label="Fees" className={`${ui.r} ${ui.num}`}>{formatMinor(qt.providerFeeMinor, qt.sourceCurrency)} + {formatMinor(qt.platformFeeMinor, qt.sourceCurrency)}</td>
                    <td data-label="Est. recipient" className={`${ui.r} ${ui.num}`}>{qt.eligible ? formatMinor(qt.estimatedRecipientMinor, qt.destinationCurrency) : "—"}</td>
                    <td data-label="ETA">{qt.etaLabel}</td>
                    <td data-label="Eligibility"><Chip tone={qt.eligible ? "ok" : "bad"}>{qt.eligible ? "Eligible" : "Not eligible"}</Chip><span className={ui.sub}>{qt.eligibilityReason}</span>{qt.prerequisites.length > 0 && <span className={ui.sub}>Needs: {qt.prerequisites.join(", ")}</span>}</td>
                    <td data-label="Freshness"><Chip tone={qt.freshness === "fresh" ? "ok" : "neutral"}>{qt.freshness === "fresh" ? "Fresh" : "Expired"}</Chip><span className={ui.sub}>Quoted {fmtTime(qt.quotedAt)}, expires {fmtTime(qt.expiresAt)}</span></td>
                    <td data-label="Action">
                      {intent.selectedQuoteId === qt.id ? <Chip tone="info">Selected</Chip> : step === 2 ? (
                        <Btn size="small" disabled={!qt.eligible} aria-label={`Choose ${qt.providerName}`}
                          onClick={() => act(`Route ${qt.providerName} chosen`, dispatch({ type: "choose_route", intentId: intent.id, quoteId: qt.id }))}>Choose route</Btn>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {step === 2 && <p className={ui.panelBody + " " + ui.hint} style={{ margin: 0 }}>Choosing a route prepares the instruction. You are the maker; a different person must approve it.</p>}
        </Panel>
      )}

      {instr && step === 3 && (
        <Panel title="4. Checker approval" id="approve">
          <div className={ui.panelBody}>
            <p style={{ marginTop: 0 }}>Prepared by <strong>{actorName(instr.makerId)}</strong> (maker). The checker must be a different person.</p>
            <div className={ui.actions} style={{ alignItems: "flex-end" }}>
              <Field label="Checker" hint="Simulated role — sandbox only">
                <select id="checker" value={checker} onChange={(e) => setChecker(e.target.value)}>
                  {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Btn kind="primary" onClick={() => act("Checker approval", dispatch({ type: "approve_instruction", instructionId: instr.id }, { actorId: checker }))}>Approve as checker</Btn>
            </div>
            <div className={ui.actions} style={{ alignItems: "flex-end", marginTop: 12 }}>
              <Field label="Rejection reason"><input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></Field>
              <Btn disabled={!rejectReason.trim()} onClick={() => act("Rejection", dispatch({ type: "reject_instruction", instructionId: instr.id, reason: rejectReason }, { actorId: checker }))}>Reject</Btn>
            </div>
          </div>
        </Panel>
      )}

      {instr && step === 4 && (
        <Panel title="5. Submit to provider" id="submit">
          <div className={ui.panelBody}>
            <p style={{ marginTop: 0 }}>Approved by {actorName(instr.checkerId)}. Submitting sends the instruction to the sandbox adapter, which returns a provider payment id.</p>
            <Btn kind="primary" onClick={() => act("Submission", dispatch({ type: "submit_instruction", instructionId: instr.id }))}>Submit instruction</Btn>
          </div>
        </Panel>
      )}

      {intent && step === 5 && (
        <Panel title="6. Simulate the provider's next event" id="event">
          <SimulateEvent intentId={intent.id} idPrefix="connect" onDone={() => router.push(`/clearline/payments/${intent.id}`)} />
        </Panel>
      )}

      <Panel title="Intents in progress" id="inflight">
        {inFlight.length === 0 ? <Empty>No intents waiting on a step.</Empty> : (
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Intents in progress">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Intent</th><th>Execution</th><th className={ui.r}>Amount</th><th>Idempotency key</th><th><span className={ui.srOnly}>Action</span></th></tr></thead>
              <tbody>{inFlight.map((i) => (
                <tr key={i.id}>
                  <td data-label="Intent">{i.internalReference}<span className={ui.sub + " mono"}>{i.id}</span></td>
                  <td data-label="Execution"><ExecChip v={i.status.execution} /></td>
                  <td data-label="Amount" className={`${ui.r} ${ui.num}`}>{formatMoney({ amountMinor: i.amountMinor, currency: i.sourceCurrency })}</td>
                  <td data-label="Idempotency key"><Code>{i.idempotencyKey}</Code></td>
                  <td data-label="Action"><Link href={`/clearline/connect?intent=${i.id}`}>Continue</Link></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
