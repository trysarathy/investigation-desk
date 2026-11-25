import { Pool } from "pg";

/**
 * TEST-ONLY reader of the local e-mail outbox (the `email_outbox` table, drizzle/0051 and 0068). The web app's role can
 * only insert there, never read, so tests read it as the schema OWNER, here. Never imported by application code.
 */
export interface OutboxMessage { id: number; to: string; subject: string; text: string; kind: string | null }

export async function readOutbox(ownerUrl: string, to?: string): Promise<OutboxMessage[]> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const r = await pool.query(`select id, to_address, subject, text_body, kind from email_outbox ${to ? "where to_address = $1" : ""} order by id`, to ? [to] : []);
    return r.rows.map((x) => ({ id: Number(x.id), to: x.to_address, subject: x.subject, text: x.text_body, kind: x.kind }));
  } finally { await pool.end(); }
}

/** The one-time token in the newest invitation email to `to`. */
export async function lastInvitation(ownerUrl: string, to: string): Promise<{ message: OutboxMessage; token: string }> {
  const m = (await readOutbox(ownerUrl, to)).filter((x) => x.kind === "invitation").at(-1);
  if (!m) throw new Error(`no invitation email to ${to}`);
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(m.text)?.[1];
  if (!token) throw new Error("no token in the invitation email");
  return { message: m, token };
}
