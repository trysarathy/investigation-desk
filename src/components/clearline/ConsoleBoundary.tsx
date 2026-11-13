"use client";
/**
 * Error boundary around the whole console, including WorkspaceProvider and AppShell (review m5:
 * app/clearline/error.tsx renders inside the layout, so it cannot catch errors thrown by the layout).
 * It depends on no console context. It never resets anything by itself; a reset is the person's
 * choice, keeps a backup of the saved copy, and says exactly what it did.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import s from "./ui.module.css";

// Storage keys only; the boundary uses no workspace context, so it still works when the provider is what failed.
import { BACKUP_KEY, WORKSPACE_KEY as KEY } from "./workspace";

type State = { error: Error | null; resetNote: string | null };

export class ConsoleBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, resetNote: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Clearline console failed to render", error.message, info.componentStack?.split("\n")[1]?.trim());
  }

  private resetSaved = () => {
    let note: string;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw !== null) window.localStorage.setItem(BACKUP_KEY, raw);
      window.localStorage.removeItem(KEY);
      note = raw === null
        ? "There was no saved workspace in this browser. Reloading with the sample workspace."
        : "Your saved workspace was moved to a backup in this browser and the sample workspace will be used. Reloading…";
    } catch {
      note = "Browser storage is blocked, so nothing was saved or reset. Reloading with the sample workspace.";
    }
    this.setState({ resetNote: note });
    window.setTimeout(() => window.location.assign("/clearline"), 1200);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className={s.main} id="cl-main" style={{ margin: "0 auto", maxWidth: 760 }}>
        <p className={s.marker} style={{ display: "inline-block" }}>TEST MODE · FICTIONAL DATA</p>
        <section className={s.panel} role="alert" aria-labelledby="cl-fatal-h" style={{ marginTop: 16 }}>
          <div className={s.panelHead}><h1 id="cl-fatal-h" style={{ fontSize: 18, margin: 0 }}>The console could not be shown</h1></div>
          <div className={s.panelBody}>
            <p style={{ marginTop: 0 }}>Something failed while starting the console. Nothing has been changed or reset.</p>
            <p>You can try again. If it keeps failing, reset the saved workspace: <strong>the copy saved in this browser is moved to a backup</strong> (not deleted) and the console starts from the five fictional sample scenarios. No real data exists here.</p>
            {this.state.resetNote && <p className={s.status} role="status">{this.state.resetNote}</p>}
            <div className={s.actions}>
              <button type="button" className={`${s.btn} ${s.primary}`} onClick={() => this.setState({ error: null })}>Try again</button>
              <button type="button" className={s.btn} disabled={Boolean(this.state.resetNote)} onClick={this.resetSaved}>Reset saved workspace (keeps a backup)</button>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
