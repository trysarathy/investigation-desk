"use client";

import { useId, useState } from "react";
import { Result, Submit, send, serverMessage, useMutation } from "@/components/control/forms";
import s from "@/components/control/control.module.css";

/**
 * v1 phase 2.3: the Ledger page's forms. Same contract as the other merchant forms: the server checks session,
 * organisation, exact Origin, Idempotency-Key and role; nothing is shown as done before the server says so.
 * Connect / Reconnect sends the browser to the ledger's own sign-in page (or the local stand-in).
 */
const API = "/api/control/merchant/ledger";
const NAME: Record<string, string> = { xero: "Xero", qbo: "QuickBooks Online" };

export function ConnectButton({ provider, reconnect }: { provider: "xero" | "qbo"; reconnect?: boolean }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  return (
    <form autoComplete="off" onSubmit={async (ev) => {
      ev.preventDefault();
      setState({ busy: true });
      try {
        const r = await send("POST", `${API}/connect`, { provider });
        if (!r.ok || typeof r.data?.authorizeUrl !== "string") { setState({ busy: false, error: serverMessage(r.status, r.data) }); return; }
        window.location.assign(r.data.authorizeUrl);
      } catch { setState({ busy: false, error: "The server could not be reached. Nothing was connected." }); }
    }}>
      <Submit busy={state.busy} variant={reconnect ? undefined : "secondary"}>{reconnect ? `Reconnect ${NAME[provider]}` : `Connect ${NAME[provider]}`}</Submit>
      {state.busy ? <p className={s.small} role="status">Opening the {NAME[provider]} sign-in page…</p> : null}
      {state.error ? <p role="alert" className={`${s.result} ${s.resultError}`}>Refused: {state.error}</p> : null}
    </form>
  );
}

export function ChooseTenantForm({ connectionId, choices }: { connectionId: string; choices: { tenantId: string; tenantName: string }[] }) {
  const x = useMutation(`ledger-tenant:${connectionId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const tenantId = String(new FormData(ev.currentTarget).get("tenantId") ?? "");
      void x.run("POST", `${API}/tenant`, { connectionId, tenantId }, () => "Connected: the chosen organisation is now this connection's ledger.");
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-t`}>Organisation to connect (it cannot be changed later without disconnecting)</label>
        <select className={s.input} id={`${id}-t`} name="tenantId" required>
          {choices.map((c) => <option key={c.tenantId} value={c.tenantId}>{c.tenantName || c.tenantId}</option>)}
        </select>
      </div>
      <div><Submit busy={x.busy}>Use this organisation</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function DisconnectButton({ connectionId, provider }: { connectionId: string; provider: string }) {
  const x = useMutation(`ledger-disconnect:${connectionId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      if (!window.confirm(`Disconnect ${NAME[provider] ?? provider}? Clearline deletes its tokens; drafts already written stay in the ledger.`)) return;
      void x.run("POST", `${API}/disconnect`, { connectionId }, (d) => `Disconnected${d?.revoked ? " and revoked at the ledger" : ""}.`);
    }}>
      <Submit busy={x.busy} variant="danger">Disconnect</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function ReadInvoicesForm({ connectionId, entities }: { connectionId: string; entities: { id: string; name: string }[] }) {
  const x = useMutation(`ledger-read:${connectionId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const entityId = String(new FormData(ev.currentTarget).get("entityId") ?? "");
      void x.run("POST", `${API}/read`, { connectionId, entityId }, (d) =>
        `Read ${String(d?.invoices ?? "?")} invoices (${String(d?.issuedInvoices ?? "?")} issued) and counted ${String(d?.payments ?? "?")} payments. The invoices wait on the Uploads page for a person to confirm them; nothing reaches matching before that.`);
    }}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-e`}>Entity the invoices belong to</label>
        <select className={s.input} id={`${id}-e`} name="entityId" required>{entities.map((e) => <option key={e.id} value={e.id}>{e.id} · {e.name}</option>)}</select>
      </div>
      <div><Submit busy={x.busy} variant="secondary">Read invoices and payments</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function AccountMapForm({ connectionId, accounts, current }: { connectionId: string; accounts: { key: string; label: string }[]; current: Record<string, string> }) {
  const x = useMutation(`ledger-accounts:${connectionId}`);
  const id = useId();
  return (
    <form className={s.form} autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const map: Record<string, string> = {};
      for (const a of accounts) { const v = String(f.get(a.key) ?? "").trim(); if (v) map[a.key] = v; }
      void x.run("POST", `${API}/accounts`, { connectionId, accounts: map }, (d) => `Saved ${String(d?.mapped ?? 0)} account code(s).`);
    }}>
      {accounts.map((a) => (
        <div className={s.field} key={a.key}>
          <label className={s.label} htmlFor={`${id}-${a.key}`}>{a.label}: ledger account code</label>
          <input className={s.input} id={`${id}-${a.key}`} name={a.key} defaultValue={current[a.key] ?? ""} maxLength={30} pattern="[A-Za-z0-9._\-]{1,30}" />
        </div>
      ))}
      <div><Submit busy={x.busy} variant="secondary">Save account codes</Submit></div>
      <Result outcome={x.outcome} />
    </form>
  );
}

export function DraftJournalButton({ connectionId, proposalId }: { connectionId: string; proposalId: string }) {
  const x = useMutation(`ledger-draft:${proposalId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      void x.run("POST", `${API}/journal-draft`, { connectionId, proposalId }, (d) => `${d?.replayed ? "Already in the ledger" : "Written to the ledger"} as a DRAFT (ledger id ${String(d?.externalId ?? "?")}). Nothing is posted until someone posts it in the ledger.`);
    }}>
      <Submit busy={x.busy} variant="secondary">Write as a draft in the ledger</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}
