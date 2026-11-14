"use client";
import Link from "../Link";
import { useEffect, useState } from "react";
import { ENGINE_DISCLAIMER, SANDBOX_PROVIDERS } from "@/lib/clearline";
import { BACKUPS_PER_KIND, RESTORE_BACKUP_KEY, WORKSPACE_KEY, deleteBackup, errorText, listBackups, useWorkspace, writeBackup, type Backup } from "../workspace";
import { download } from "../download";
import { ActorSelect } from "../ActorSelect";
import { Btn, Chip, Dl, Notice, PageHead, Panel, Status, fmtTime, ui } from "../ui";

export default function Settings() {
  const { ws, storage, reset, dispatch } = useWorkspace();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const total = backups.reduce((t, b) => t + b.size, 0);
  useEffect(() => setBackups(listBackups()), []);
  const restore = (b: Backup) => {
    let raw: string | null = null;
    let current: string | null = null;
    try { raw = window.localStorage.getItem(b.key); current = window.localStorage.getItem(WORKSPACE_KEY); } catch { /* blocked */ }
    if (raw === null) { setMsg({ text: "That backup could not be read from browser storage. Nothing was changed.", error: true }); return; }
    // The current saved workspace is backed up first; if that fails, nothing is restored.
    if (current !== null && !writeBackup(RESTORE_BACKUP_KEY, current)) {
      setMsg({ text: "The current workspace could not be backed up first (browser storage is full or blocked), so nothing was restored.", error: true });
      return;
    }
    try { window.localStorage.setItem(WORKSPACE_KEY, raw); } catch {
      setMsg({ text: "The backup could not be restored (browser storage is full or blocked). Nothing was changed.", error: true });
      return;
    }
    window.location.assign("/clearline/settings#backups");
  };
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
            <Btn kind="primary" onClick={() => { const r = reset("sample"); setMsg(r.ok ? { text: `Workspace reset to the sample with five scenarios.${r.backupKey ? " The previous workspace is kept as a backup below." : ""}` } : { text: r.reason, error: true }); setBackups(listBackups()); }}>Reset to sample</Btn>
            <Btn onClick={() => { const r = reset("empty"); setMsg(r.ok ? { text: `Workspace emptied (organisation, users and routes kept).${r.backupKey ? " The previous workspace is kept as a backup below." : ""}` } : { text: r.reason, error: true }); setBackups(listBackups()); }}>Start empty workspace</Btn>
          </div>
        </div>
      </Panel>
      <Panel title="Backups in this browser" id="backups">
        <div className={ui.panelBody}>
          {backups.length === 0 ? <p style={{ margin: 0 }} className={ui.hint}>No backups. A backup is kept here when you reset the workspace, replace an unreadable saved workspace, reset after a console error, restore a backup, or when this version updates your saved workspace.</p> : (
            <>
            <p className={ui.hint} style={{ marginTop: 0 }} data-testid="backup-total">{backups.length} backup{backups.length === 1 ? "" : "s"}, {kb(total)} in this browser&apos;s storage. The newest {BACKUPS_PER_KIND} of each kind are kept; an older one is removed only after a newer one was saved.</p>
            <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="backup-list">
              {backups.map((b) => (
                <li key={b.key} style={{ marginBottom: 8 }}>
                  {b.kind === "unreadable" ? "Unreadable saved workspace" : b.kind === "boundary" ? "Saved workspace removed after a console error" : b.kind === "before-migration" ? "Saved workspace as it was before this version updated it" : b.kind === "before-reset" ? "Workspace saved before a reset" : "Workspace saved before a restore"}
                  {b.savedAt ? `, ${b.savedAt}` : ""} <span className={ui.hint}>(<span data-testid="backup-size">{kb(b.size)}</span> · <span className="mono">{b.key}</span>)</span>
                  <span className={ui.actions} style={{ marginTop: 4 }}>
                    <Btn size="small" onClick={() => { try { const raw = window.localStorage.getItem(b.key); if (raw !== null) download(`${b.key}.json`, raw, "application/json"); } catch { setMsg({ text: "Browser storage is blocked; the backup cannot be read.", error: true }); } }}>Download<span className={ui.srOnly}> {b.key}</span></Btn>
                    <Btn size="small" onClick={() => restore(b)}>Restore<span className={ui.srOnly}> {b.key}</span> (backs up the current workspace first)</Btn>
                    {confirming === b.key ? (
                      <>
                        <Btn size="small" onClick={() => { const ok = deleteBackup(b.key); setConfirming(null); setBackups(listBackups()); setMsg(ok ? { text: `Backup ${b.key} deleted.` } : { text: "The backup could not be deleted (browser storage is blocked).", error: true }); }}>Confirm delete<span className={ui.srOnly}> {b.key}</span></Btn>
                        <Btn size="small" kind="ghost" onClick={() => setConfirming(null)}>Keep it</Btn>
                      </>
                    ) : <Btn size="small" onClick={() => setConfirming(b.key)}>Delete<span className={ui.srOnly}> {b.key}</span></Btn>}
                  </span>
                </li>
              ))}
            </ul>
            </>
          )}
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
            <li>Funding: a projection linking a payment to an advance, not a shared ledger. The specialist Funding Desk workflow is at <Link href="/mentor-demo">/mentor-demo</Link>.</li>
            <li>Storage: your browser only. Nothing is sent to a server; reset clears it.</li>
          </ul>
          <p className={ui.hint}>Do not enter real customer names, bank details, credentials or wallet keys.</p>
        </div>
      </Panel>
    </>
  );
}
