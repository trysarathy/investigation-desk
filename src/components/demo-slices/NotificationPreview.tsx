// S1b (DEMO ONLY): the same result as an email and a Slack-style message. A preview: this renders
// text on the page and nothing else. No email, no Slack, no webhook, no network call of any kind.

import type { NotificationPreview as Preview } from "@/lib/demo-slices/release";

export const PREVIEW_LABEL = "Preview — nothing is sent";

export function NotificationPreview({ preview }: { preview: Preview }) {
  return (
    <div className="notify-grid" data-testid="notify-preview">
      <figure className="panel notify" aria-label="Email preview">
        <figcaption className="panel-h"><h3 style={{ margin: 0, fontSize: 14 }}>Email</h3><span className="demo-badge">{PREVIEW_LABEL}</span></figcaption>
        <div className="panel-b">
          <div className="muted" style={{ fontSize: 12 }}>From: Clearline (demo) · To: ops (sample)</div>
          <div style={{ fontWeight: 600 }} data-testid="notify-subject">{preview.subject}</div>
          {preview.body.map((l, i) => <p key={i} style={{ margin: 0, fontSize: 14 }} className={i ? "muted" : undefined}>{l}</p>)}
        </div>
      </figure>
      <figure className="panel notify" aria-label="Slack-style message preview">
        <figcaption className="panel-h"><h3 style={{ margin: 0, fontSize: 14 }}>Slack-style message</h3><span className="demo-badge">{PREVIEW_LABEL}</span></figcaption>
        <div className="panel-b">
          <div className="muted" style={{ fontSize: 12 }}><strong>Clearline (demo)</strong> in #ops-sample</div>
          {preview.slack.split("\n").map((l, i) => <p key={i} style={{ margin: 0, fontSize: 14, fontWeight: i ? 400 : 600 }}>{l}</p>)}
        </div>
      </figure>
    </div>
  );
}

/** Why there is no preview for a step: quiet by default. */
export function QuietNote() {
  return <p className="muted" style={{ margin: 0, fontSize: 13 }} data-testid="notify-quiet">Quiet: no message for this step. Messages go out only when a payment is paid and final, or has a problem; never on every block.</p>;
}
