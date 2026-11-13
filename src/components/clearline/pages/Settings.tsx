"use client";
import Link from "../Link";
import { useState } from "react";
import { ENGINE_DISCLAIMER, SANDBOX_PROVIDERS } from "@/lib/clearline";
import { errorText, useWorkspace } from "../workspace";
import { ActorSelect } from "../ActorSelect";
import { Btn, Chip, Dl, Notice, PageHead, Panel, Status, fmtTime, ui } from "../ui";

export default function Settings() {
  const { ws, storage, reset, dispatch } = useWorkspace();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const advance = (label: string, ms: number) => {
    const r = dispatch({ type: "advance_clock", to: new Date(Date.parse(ws.asOf) + ms).toISOString() });
    setMsg(r.ok ? { text: `Clock advanced ${label}. Timeouts, quote expiry and overdue checks ran.` } : { text: errorText(r), error: true });
  };
  return (
    <>
      <PageHead eyebrow="Organization" title="Settings" lede="Sandbox workspace controls and where the data comes from." />
      <Status msg={msg} />
      <Panel title="Sandbox workspace" id="sandbox">
        <div className={ui.panelBody}>
          <Dl items={[
            ["Organisation", <>{ws.organization.name} <Chip tone="warn">Fictional</Chip></>],
            ["Mode", ws.mode],
            ["Simulated clock", <span key="c" className="num">{fmtTime(ws.asOf)}</span>],
            ["Browser storage", storage === "available" ? "Available — changes persist in this browser only" : "Unavailable — changes last until you reload"],
            ["Payments / exceptions / cases", `${ws.intents.length} / ${ws.exceptions.length} / ${ws.cases.length}`],
          ]} />
          <div className={ui.actions} style={{ marginTop: 14 }}>
            <Btn kind="primary" onClick={() => { reset("sample"); setMsg({ text: "Workspace reset to the sample with five scenarios." }); }}>Reset to sample</Btn>
            <Btn onClick={() => { reset("empty"); setMsg({ text: "Workspace emptied (organisation, users and routes kept)." }); }}>Start empty workspace</Btn>
          </div>
        </div>
      </Panel>
      <Panel title="Simulated clock" id="clock">
        <div className={ui.panelBody}>
          <p style={{ marginTop: 0 }}>Each action moves the clock forward one minute. Advance it to see provider timeouts, quote expiry, stale balances and overdue repayments.</p>
          <div className={ui.actions}>
            <Btn onClick={() => advance("by 1 hour", 3600_000)}>Advance 1 hour</Btn>
            <Btn onClick={() => advance("by 1 day", 86400_000)}>Advance 1 day</Btn>
            <Btn onClick={() => advance("by 7 days", 7 * 86400_000)}>Advance 7 days</Btn>
          </div>
        </div>
      </Panel>
      <Panel title="Simulated users" id="users">
        <div className={ui.panelBody}>
          <ActorSelect id="cl-actor-settings" label="Acting as" />
          <p className={ui.hint}>There is no login in this sandbox. Maker and checker must be different people; compliance decisions need the assigned reviewer.</p>
        </div>
      </Panel>
      <Panel title="Data sources" id="sources">
        <div className={ui.panelBody}>
          <Notice info>{ENGINE_DISCLAIMER}</Notice>
          <ul style={{ margin: 0 }}>
            <li>Providers: sandbox adapters only ({SANDBOX_PROVIDERS.map((p) => p.name).join(", ")}). No licensed partner is connected.</li>
            <li>Quotes: indicative sandbox quotes, never executable.</li>
            <li>Statements: fictional bank and provider settlement lines entered in this console.</li>
            <li>Chain: synthetic Base Sepolia testnet observations; an on-chain transfer never proves a bank credit.</li>
            <li>Funding: a projection linking a payment to an advance, not a shared ledger. Detailed prototype at <Link href="/mentor-demo">/mentor-demo</Link>.</li>
            <li>Storage: your browser only. Nothing is sent to a server; reset clears it.</li>
          </ul>
          <p className={ui.hint}>Do not enter real customer names, bank details, credentials or wallet keys.</p>
        </div>
      </Panel>
    </>
  );
}
