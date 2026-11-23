import type { Metadata } from "next";
import { can } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { listNotifications } from "@/server/notifications";
import s from "@/components/control/control.module.css";
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
      <h1 className={s.title}>Notifications</h1>
      <p className={s.lede}>What needs you, for your role: finished or failed runs, new exceptions your role owns, approvals waiting, bank statements waiting for a second person, and rule changes. <span data-testid="unread-count">{v.unread} unread.</span></p>
      {unread.length ? <MarkNotificationsRead ids={unread} /> : null}
      {v.notifications.length === 0 ? <Empty>No notifications for your role yet.</Empty> : (
        <ul aria-label="Notifications" style={{ listStyle: "none", padding: 0 }}>
          {v.notifications.map((n) => (
            <li key={n.id} id={n.subjectType === "rule_change_notice" ? `notice-${n.subjectId}` : undefined} className={s.panel} data-testid="notification">
              <p className={s.row}><Chip tone={n.kind === "run_failed" ? "warn" : n.read ? undefined : "info"}>{KIND[n.kind] ?? n.kind}</Chip>{n.read ? null : <strong>New</strong>} <span className={s.small}>{when(n.createdAt)}</span></p>
              <p>{n.href ? <a href={n.href}>{n.title}</a> : n.title}</p>
              {n.notice ? (n.notice.acknowledged ? <p className={s.small}>Acknowledged by {n.notice.acknowledged.by} on {when(n.notice.acknowledged.at)}.</p>
                : approver ? <AcknowledgeNotice noticeId={n.subjectId} orderId={n.notice.orderId} /> : <p className={s.small}>Waiting for an Approver to acknowledge.</p>) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
