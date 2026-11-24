/**
 * Read-only queries against the demo database for the demo browser suite (the case numbers, the upload outcomes, the
 * seed's calendar), as the demo cluster's superuser saved in .demo/state.json. Local and fictional; nothing here
 * writes. Demo · fictional data.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { STATE_FILE } from "./env";

const DB = process.env.CLEARLINE_DEMO_DB_NAME ?? "clearline_demo";

export async function demoQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const s = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { pg: { superUrl: string } };
  const u = new URL(s.pg.superUrl); u.pathname = `/${DB}`;
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  try {
    await c.query("set default_transaction_read_only = on");
    return (await c.query(text, params)).rows as T[];
  } finally { await c.end(); }
}

/** Decisions (or "decision rule" keys) of one entity's payments, as tests/control/demo.test.ts counts them. */
export async function decisionsOf(entity: string, withRule = false): Promise<Record<string, number>> {
  const key = withRule ? "m.decision || ' ' || m.rule_id" : "m.decision";
  const rows = await demoQuery<{ k: string; n: number }>(`select ${key} k, count(*)::int n from match_records m join invoices i on i.org_id = m.org_id and i.order_id = m.order_id join organizations o on o.id = m.org_id where o.data_mode = 'demo' and i.entity_id = $1 group by 1 order by 1`, [entity]);
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}
