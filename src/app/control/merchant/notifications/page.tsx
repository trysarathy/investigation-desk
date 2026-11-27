import type { Metadata } from "next";
import { can } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { listNotifications } from "@/server/notifications";
import s from "@/components/control/control.module.css";
import x from "@/components/control/screens.module.css";
import { AcknowledgeNotice, MarkNotificationsRead } from "@/components/merchant/forms";
import { Chip, Empty } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Notifications" };

const KIND: Record<string, string> = {
  run_finished: "Run finished", run_failed: "Run failed", exception_assigned: "Exception", approval_waiting: "Approval waiting",
  bank_statement_waiting: "Statement to confirm", rule_change: "Rule change",
};

/** The signed-in member's notifications: those for their role in this organisation, newest first. */
export default async function NotificationsPage() {
  const { ctx } = await merchantMember();
  const v = await listNotifications(ctx);
  const unread = v.notifications.filter((n) => !n.read).map((n) => n.id);
  const approver = can(ctx.role, "decide_approval");
  return (
    <>
      <div className={x.head}>
        <div className={x.headText}>
          <h1 className={s.title}>Notifications</h1>
          <p>What needs you, for your role: finished or failed runs, new exceptions your role owns, approvals waiting, bank statements waiting for a second person, and rule changes. <span data-testid="unread-count">{v.unread} unread.</span></p>
        </div>
        {unread.length ? <div className={x.headTools}><MarkNotificationsRead ids={unread} /></div> : null}
      </div>
      {v.notifications.length === 0 ? <Empty>No notifications for your role yet.</Empty> : (
        <ul aria-label="Notifications" className={x.feed}>
          {v.notifications.map((n) => (
            <li key={n.id} id={n.subjectType === "rule_change_notice" ? `notice-${n.subjectId}` : undefined} className={x.feedItem} data-testid="notification">
              <span className={`${x.dot} ${n.read ? "" : x.dotNew}`} aria-hidden="true" />
              <div className={x.feedBody}>
                <p className={x.feedMeta}><Chip tone={n.kind === "run_failed" ? "warn" : n.read ? undefined : "info"}>{KIND[n.kind] ?? n.kind}</Chip>{n.read ? null : <strong className={x.newWord}>New</strong>} <span className={x.mono}>{when(n.createdAt)}</span></p>
                <p className={x.feedTitle}>{n.href ? <a href={n.href}>{n.title}</a> : n.title}</p>
                {n.notice ? (n.notice.acknowledged ? <p className={x.note}>Acknowledged by {n.notice.acknowledged.by} on <span className={x.mono}>{when(n.notice.acknowledged.at)}</span>.</p>
                  : approver ? <AcknowledgeNotice noticeId={n.subjectId} orderId={n.notice.orderId} /> : <p className={x.note}>Waiting for an Approver to acknowledge.</p>) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
