// "In your books": what Clearline will post to the accounting system for this invoice (or why it
// won't), the approve button, and what has already been posted, with the accounting system's IDs.

import Link from "next/link";
import { activeProvider, loadAccounting } from "@/lib/accounting/service";
import { planPosting, postedFor } from "@/lib/accounting/rules";
import { PROVIDER_LABEL, type LineKind, type PlanStatus, type PostingLine } from "@/lib/accounting/types";
import { CONFIRMATIONS } from "@/lib/requests/check";
import { formatUsdc } from "@/lib/requests/lifecycle";
import { shortHash } from "@/lib/requests/present";
import type { RequestsData } from "@/lib/requests/types";
import { friendlyTime } from "@/lib/requests/ui";
import { ApprovePosting } from "./ApprovePosting";

const KIND: Record<LineKind, string> = { payment: "Payment", fee_writeoff: "Fee write-off", overpayment: "Overpayment", note: "Note on invoice" };
const STATUS: Record<PlanStatus, { label: string; tone: string }> = {
  not_linked: { label: "Not from the books", tone: "waiting" },
  waiting: { label: "Nothing to post yet", tone: "waiting" },
  needs_decision: { label: "Decide first", tone: "attention" },
  ready: { label: "Ready to post", tone: "progress" },
  posted: { label: "Posted", tone: "paid" },
  never: { label: "Never posted", tone: "blocked" },
  blocked: { label: "Post by hand", tone: "attention" },
};

function Lines({ lines }: { lines: (PostingLine & { externalId?: string; externalType?: string })[] }) {
  return (
    <table className="table" style={{ width: "100%", fontSize: 13 }} data-testid="posting-lines">
      <thead><tr><th style={{ textAlign: "left" }}>Line</th><th style={{ textAlign: "right" }}>USD</th><th style={{ textAlign: "left" }}>Account</th><th style={{ textAlign: "left" }}>Detail</th></tr></thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>{KIND[l.kind]}</td>
            <td style={{ textAlign: "right" }} className="amount">{l.kind === "note" ? "—" : formatUsdc(l.amount)}</td>
            <td className="mono">{l.accountCode ?? "—"}</td>
            <td className="muted">
              {l.txHash ? <>{formatUsdc(l.tokenAmount ?? l.amount)} {l.token} on {l.network} · tx <span className="mono">{shortHash(l.txHash)}</span> · {l.usdRate} USD each ({l.usdRateSource?.split(" (")[0]}) · {l.date}</> : l.description}
              {l.externalId && <div className="faint" style={{ fontSize: 12 }}>{l.externalType} <span className="mono">{l.externalId.slice(0, 13)}</span></div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export async function BooksPanel({ data, requestId }: { data: RequestsData; requestId: string }) {
  const acct = await loadAccounting();
  const plan = planPosting(data, acct, requestId, { threshold: CONFIRMATIONS });
  if (plan.status === "not_linked") return null;
  const link = acct.links[requestId];
  const provider = activeProvider(acct);
  const where = provider === "demo" ? "the demo books" : PROVIDER_LABEL[provider];
  const posted = postedFor(acct, requestId);
  const lastPosted = acct.audit.filter((e) => e.requestId === requestId && e.kind === "posted").at(-1);
  const st = STATUS[plan.status];
  return (
    <section className={`panel tone-box-${st.tone}`} style={{ borderLeftWidth: 4 }} data-testid="books-panel" aria-label="In your books">
      <div className="panel-h">
        <h2>In your books <span className="faint" style={{ fontWeight: 400 }}>· {link.invoiceNumber} in {where}</span></h2>
        <span className="badge" data-testid="books-status">{st.label}</span>
      </div>
      <div className="panel-b">
        {plan.reasons.map((r, i) => <div key={i} className={i === 0 ? undefined : "muted"}>{r}</div>)}
        {plan.lines.length > 0 && (
          <>
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{plan.status === "ready" ? "What will post when you approve:" : "What will post once decided:"}</div>
            <Lines lines={plan.lines} />
          </>
        )}
        {plan.status === "ready" && (
          <ApprovePosting requestId={requestId} planKey={plan.idempotencyKey} label={`Approve and post to ${provider === "demo" ? "the books" : PROVIDER_LABEL[provider]}`} />
        )}
        {posted.length > 0 && (
          <>
            <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              Already posted{lastPosted ? ` · approved by ${lastPosted.by}, ${friendlyTime(lastPosted.at)}` : ""}:
            </div>
            <Lines lines={posted} />
          </>
        )}
        <div className="faint" style={{ fontSize: 12 }}>
          Clearline only reads the blockchain. It writes to {where} only when a person approves, and keeps every posting and every refused approval in the <Link href="/books">audit log</Link>.
        </div>
      </div>
    </section>
  );
}
