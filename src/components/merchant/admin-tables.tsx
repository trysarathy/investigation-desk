"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { MemberStatus } from "@/components/control/member-status";
import { DeactivateMember, RevokeSessions } from "@/components/merchant/forms";
import { ActionButton } from "@/components/onboarding/forms";
import x from "@/components/control/screens.module.css";

/**
 * v1 design-fluid: the Admin, Access review and Platform console tables as <DataTable> (client sort and filter over the
 * rows the server already rendered; nothing is fetched here). Every value arrives as plain text from the server page,
 * which still decides what each person may see and do; the action buttons are the same forms as before.
 */

export interface MemberRow {
  userId: string; name: string; email: string; you: boolean; roleLabel: string; active: boolean; scope: string; mfa: string;
  lastSignIn: string; lastSignInSort: string; sessions: number; canDeactivate: boolean;
}

const MEMBER_COLUMNS: Column<MemberRow>[] = [
  { id: "name", header: "Name", rowHeader: true, hideable: false, sortValue: (r) => r.name, filterValue: (r) => `${r.name} ${r.email}`, cell: (r) => <>{r.name}{r.you ? " (you)" : ""}</> },
  { id: "email", header: "Email", sortValue: (r) => r.email, cell: (r) => <span className={x.mono}>{r.email}</span> },
  { id: "role", header: "Role", sortValue: (r) => r.roleLabel, cell: (r) => r.roleLabel },
  { id: "status", header: "Status", sortValue: (r) => (r.active ? "Active" : "Deactivated"), cell: (r) => <MemberStatus state={r.active ? "active" : "deactivated"} /> },
  { id: "scope", header: "Entities", sortValue: (r) => r.scope, cell: (r) => r.scope },
  { id: "mfa", header: "Second factor", sortValue: (r) => r.mfa, cell: (r) => r.mfa },
  { id: "last", header: "Last sign-in", sortValue: (r) => r.lastSignInSort, filterValue: (r) => r.lastSignIn, cell: (r) => <span className={x.mono}>{r.lastSignIn}</span> },
  { id: "sessions", header: "Active sessions", numeric: true, sortValue: (r) => r.sessions, cell: (r) => r.sessions },
  {
    id: "action", header: "Action", hideable: false, filterValue: () => "",
    cell: (r) => (r.you || !r.active ? <span aria-label="No action">—</span> : (
      <span className={x.actions}>
        {r.canDeactivate ? <DeactivateMember userId={r.userId} name={r.name} /> : null}
        {r.sessions > 0 ? <RevokeSessions userId={r.userId} name={r.name} /> : null}
      </span>
    )),
  },
];

export function MembersTable({ rows }: { rows: MemberRow[] }) {
  return (
    <DataTable rows={rows} columns={MEMBER_COLUMNS} rowKey={(r) => r.userId} caption="Members, roles, status, second factor and last sign-in"
      filterLabel="Filter members" virtualizeAbove={Infinity} rowTestId={() => "member-row"} initialSort={{ id: "name", dir: "asc" }} />
  );
}

export interface InvitationRow { id: string; email: string; role: string; expired: boolean; expires: string }

export function InvitationsTable({ rows, api, flashPrefix, success, canRevoke = true }: { rows: InvitationRow[]; api: string; flashPrefix: string; success: string; canRevoke?: boolean }) {
  const columns: Column<InvitationRow>[] = [
    { id: "email", header: "Email", rowHeader: true, hideable: false, sortValue: (r) => r.email, cell: (r) => <span className={x.mono}>{r.email}</span> },
    { id: "role", header: "Role", sortValue: (r) => r.role, cell: (r) => r.role },
    { id: "status", header: "Status", sortValue: (r) => (r.expired ? 1 : 0), filterValue: (r) => (r.expired ? "Expired" : "Pending invitation"), cell: (r) => <MemberStatus state={r.expired ? "expired" : "pending"} /> },
    { id: "expires", header: "Expires", sortValue: (r) => r.expires, cell: (r) => <span className={x.mono}>{r.expired ? "Expired" : r.expires}</span> },
    {
      id: "action", header: "Action", hideable: false, filterValue: () => "",
      cell: (r) => (canRevoke ? <ActionButton flashKey={`${flashPrefix}:revoke:${r.id}`} url={`${api}/revoke-invitation`} body={{ invitationId: r.id }} label={`Revoke invitation for ${r.email}`} success={success} variant="secondary" /> : <span aria-label="No action">—</span>),
    },
  ];
  return (
    <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="Pending invitations (a link is shown only when it is created)"
      filterable={rows.length > 8} virtualizeAbove={Infinity} rowTestId={() => "invitation-row"} />
  );
}

export interface AuditRow { seq: number; at: string; action: string; subject: string; actor: string }

const AUDIT_COLUMNS: Column<AuditRow>[] = [
  { id: "seq", header: "#", headerText: "Sequence", numeric: true, hideable: false, sortValue: (r) => r.seq, cell: (r) => <span className={x.mono}>{r.seq}</span> },
  { id: "at", header: "When", sortValue: (r) => r.at, cell: (r) => <span className={x.mono}>{r.at}</span> },
  { id: "action", header: "Action", sortValue: (r) => r.action, cell: (r) => <span className={x.mono}>{r.action}</span> },
  { id: "subject", header: "Subject", sortValue: (r) => r.subject, cell: (r) => <span className={x.mono}>{r.subject}</span> },
  { id: "actor", header: "Actor", sortValue: (r) => r.actor, cell: (r) => <span className={x.mono}>{r.actor}</span> },
];

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return <DataTable rows={rows} columns={AUDIT_COLUMNS} rowKey={(r) => String(r.seq)} caption="Audit events" filterLabel="Filter audit events" virtualizeAbove={Infinity} rowTestId={() => "audit-row"} />;
}

export interface AccessRow {
  userId: string; name: string; email: string; roleLabel: string; revoked: string | null; scope: string; scopeLimited: boolean; mfa: string;
  granted: string; lastSignIn: string; invitedBy: string;
}

const ACCESS_COLUMNS: Column<AccessRow>[] = [
  {
    id: "member", header: "Member", rowHeader: true, hideable: false, sortValue: (r) => r.name, filterValue: (r) => `${r.name} ${r.email}`,
    cell: (r) => <><strong>{r.name}</strong><br /><span className={x.mono}>{r.email}</span></>,
  },
  { id: "role", header: "Role", sortValue: (r) => r.roleLabel, cell: (r) => r.roleLabel },
  {
    id: "status", header: "Status", sortValue: (r) => (r.revoked ? 1 : 0), filterValue: (r) => (r.revoked ? `Deactivated ${r.revoked}` : "Active"),
    cell: (r) => (r.revoked ? <MemberStatus state="deactivated" label={`Revoked ${r.revoked}`} /> : <MemberStatus state="active" />),
  },
  { id: "scope", header: "Entity scope", sortValue: (r) => r.scope, cell: (r) => <span data-testid="access-scope" className={r.scopeLimited ? x.mono : undefined}>{r.scope}</span> },
  { id: "mfa", header: "Second factor", sortValue: (r) => r.mfa, cell: (r) => <span data-testid="access-mfa">{r.mfa}</span> },
  { id: "granted", header: "Access granted", sortValue: (r) => r.granted, cell: (r) => <span className={x.mono}>{r.granted}</span> },
  { id: "last", header: "Last sign-in", sortValue: (r) => r.lastSignIn, cell: (r) => <span className={x.mono}>{r.lastSignIn}</span> },
  { id: "invited", header: "Invited by", sortValue: (r) => r.invitedBy, cell: (r) => r.invitedBy },
];

export function AccessTable({ rows }: { rows: AccessRow[] }) {
  return <DataTable rows={rows} columns={ACCESS_COLUMNS} rowKey={(r) => r.userId} caption="Members, roles, entity scope, second factor, access dates and inviter" filterLabel="Filter memberships" virtualizeAbove={Infinity} rowTestId={() => "access-row"} />;
}

export interface OrgRow { id: string; name: string; slug: string; kind: string; created: string; admins: number; pending: number; setup: string }

const ORG_COLUMNS: Column<OrgRow>[] = [
  { id: "name", header: "Name", rowHeader: true, hideable: false, sortValue: (r) => r.name, cell: (r) => r.name },
  { id: "slug", header: "Code", sortValue: (r) => r.slug, cell: (r) => <span className={x.mono}>{r.slug}</span> },
  { id: "kind", header: "Kind", sortValue: (r) => r.kind, cell: (r) => r.kind },
  { id: "created", header: "Created", sortValue: (r) => r.created, cell: (r) => <span className={x.mono}>{r.created}</span> },
  { id: "admins", header: "Admins", numeric: true, sortValue: (r) => r.admins, cell: (r) => r.admins },
  { id: "pending", header: "Pending invitations", numeric: true, sortValue: (r) => r.pending, cell: (r) => r.pending },
  { id: "setup", header: "Setup", sortValue: (r) => r.setup, cell: (r) => r.setup },
];

export function OrgsTable({ rows }: { rows: OrgRow[] }) {
  return <DataTable rows={rows} columns={ORG_COLUMNS} rowKey={(r) => r.id} caption="Live organisations, newest first" filterLabel="Filter organisations" virtualizeAbove={Infinity} rowTestId={() => "platform-org-row"} emptyText="No organisation yet." />;
}
