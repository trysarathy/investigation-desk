"use client";
/**
 * Error boundary around the whole console, including WorkspaceProvider and AppShell (review m5:
 * app/clearline/error.tsx renders inside the layout, so it cannot catch errors thrown by the layout).
 * It depends on no console context. It never resets anything by itself; a reset is the person's
 * choice, keeps a backup in its own slot (never over an earlier backup), and says exactly what it did.
 * A failed backup never removes the saved copy (review rc3 m3).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import s from "./ui.module.css";

// Storage helpers only; the boundary uses no workspace context, so it still works when the provider is what failed.
import { BOUNDARY_BACKUP_KEY, WORKSPACE_KEY as KEY, writeBackup } from "./workspace";
import { download } from "./download";

type Outcome =
  | { kind: "reloading"; text: string }
  | { kind: "backup_failed"; raw: string }
  | { kind: "blocked" };
type State = { error: Error | null; outcome: Outcome | null };

export class ConsoleBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, outcome: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Clearline console failed to render", error.message, info.componentStack?.split("\n")[1]?.trim());
  }

  private reload = (text: string) => {
    this.setState({ outcome: { kind: "reloading", text } });
    window.setTimeout(() => window.location.assign("/clearline"), 1200);
  };

  private resetSaved = () => {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch {
      // Storage cannot be read at all: there is no saved copy to move, and nothing was changed.
      this.setState({ outcome: { kind: "blocked" } });
      return;
    }
    if (raw === null) { this.reload("There was no saved workspace in this browser. Reloading with the sample workspace…"); return; }
    const key = writeBackup(BOUNDARY_BACKUP_KEY, raw);
    if (!key) { this.setState({ outcome: { kind: "backup_failed", raw } }); return; }
    try { window.localStorage.removeItem(KEY); } catch { /* the backup exists; the reload shows what is left */ }
    this.reload(`Your saved workspace was moved to a backup in this browser (${key}). You can download or restore it in Settings. Reloading with the sample workspace…`);
  };

  private removeWithoutBackup = () => {
    try { window.localStorage.removeItem(KEY); } catch { this.setState({ outcome: { kind: "blocked" } }); return; }
    this.reload("Your saved workspace was removed without a backup. Reloading with the sample workspace…");
  };

  render() {
    if (!this.state.error) return this.props.children;
    const o = this.state.outcome;
    return (
      <main className={s.main} id="cl-main" style={{ margin: "0 auto", maxWidth: 760 }}>
        <p className={s.marker} style={{ display: "inline-block" }}>TEST MODE · FICTIONAL DATA</p>
        <section className={s.panel} role="alert" aria-labelledby="cl-fatal-h" style={{ marginTop: 16 }} data-testid="console-boundary">
          <div className={s.panelHead}><h1 id="cl-fatal-h" style={{ fontSize: 18, margin: 0 }}>The console could not be shown</h1></div>
          <div className={s.panelBody}>
            <p style={{ marginTop: 0 }}>Something failed while starting the console. Nothing has been changed or reset.</p>
            <p>You can try again. If it keeps failing, reset the saved workspace: <strong>the copy saved in this browser is moved to a backup</strong> (not deleted) and the console starts from the five fictional sample scenarios. No real data exists here.</p>
            {o?.kind === "reloading" && <p className={s.status} role="status">{o.text}</p>}
            {o?.kind === "blocked" && (
              <p className={`${s.status} ${s.statusErr}`} role="status">
                Browser storage is blocked in this browser, so there is no saved workspace to reset and nothing was changed.
                Reload the page to start again from the sample workspace.
              </p>
            )}
            {o?.kind === "backup_failed" && (
              <div data-testid="boundary-backup-failed">
                <p className={`${s.status} ${s.statusErr}`} role="status">
                  A backup could not be written (browser storage is probably full), so nothing was removed. Download the saved
                  copy first if you want to keep it, then remove it without a backup.
                </p>
                <div className={s.actions}>
                  <button type="button" className={s.btn} onClick={() => download("clearline-workspace-saved.json", o.raw, "application/json")}>Download the saved copy</button>
                  <button type="button" className={s.btn} onClick={this.removeWithoutBackup}>Remove it without a backup</button>
                </div>
              </div>
            )}
            <div className={s.actions} style={{ marginTop: 8 }}>
              <button type="button" className={`${s.btn} ${s.primary}`} onClick={() => this.setState({ error: null, outcome: null })}>Try again</button>
              <button type="button" className={s.btn} disabled={o?.kind === "reloading" || o?.kind === "backup_failed"} onClick={this.resetSaved}>Reset saved workspace (keeps a backup)</button>
              {o?.kind === "blocked" && <button type="button" className={s.btn} onClick={() => window.location.assign("/clearline")}>Reload</button>}
            </div>
          </div>
        </section>
      </main>
    );
  }
}
