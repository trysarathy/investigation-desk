import "server-only";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "./client";

/**
 * v1 phase 3 (volume): many rows in one statement through `unnest` of one array per column, instead of a VALUES list
 * of rows × columns parameters. The rows, values and conflict handling are exactly what the equivalent drizzle insert
 * writes: each value goes through the column's own driver mapping (JSON for jsonb, decimal strings for money) and is
 * cast to the column's type; triggers, constraints and row-level security apply per row as before. Only the shape of
 * the statement changes (a handful of parameters, one parse), which is what made 100,000-row runs slow.
 *
 * Rows that leave a column undefined take its database default, as with drizzle: rows are grouped by the columns they
 * give, and each group goes in its own statements.
 */
export interface BulkOptions {
  /** ON CONFLICT (target) DO NOTHING, or DO UPDATE SET <set> [WHERE <where>] — SQL in terms of the table and `excluded`. */
  onConflict?: { target: string[]; doNothing: true } | { target: string[]; set: SQL; where?: SQL };
  /** Column names to return (snake_case). */
  returning?: string[];
  chunk?: number;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

type Col = { name: string; getSQLType(): string; mapToDriverValue(v: unknown): unknown };

export async function bulkInsert<T extends PgTable>(tx: Tx, table: T, rows: T["$inferInsert"][], opts: BulkOptions = {}): Promise<Record<string, unknown>[]> {
  if (!rows.length) return [];
  const cols = Object.entries(getTableColumns(table)) as [string, Col][];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows as Record<string, unknown>[]) {
    const sig = cols.map(([key]) => (r[key] === undefined ? "0" : "1")).join("");
    const g = groups.get(sig);
    if (g) g.push(r); else groups.set(sig, [r]);
  }
  const out: Record<string, unknown>[] = [];
  for (const group of groups.values()) out.push(...await insertGroup(tx, table, cols.filter(([key]) => group[0][key] !== undefined), group, opts));
  return out;
}

async function insertGroup(tx: Tx, table: PgTable, used: [string, Col][], rows: Record<string, unknown>[], opts: BulkOptions): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const size = opts.chunk ?? 5_000;
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    const arrays = used.map(([key, c]) => part.map((r) => {
      const v = r[key];
      if (v === null) return null;
      const d = c.mapToDriverValue(v);
      return d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : typeof d === "string" ? d : typeof d === "object" ? JSON.stringify(d) : String(d);
    }));
    const names = used.map(([, c]) => q(c.name));
    const select = used.map(([, c], j) => `u.c${j}::${c.getSQLType()}`).join(", ");
    const unnest = sql.join(arrays.map((a) => sql`${sql.param(a)}::text[]`), sql`, `);
    let conflict = sql``;
    if (opts.onConflict) {
      const target = sql.raw(opts.onConflict.target.map(q).join(", "));
      conflict = "doNothing" in opts.onConflict ? sql` on conflict (${target}) do nothing`
        : sql` on conflict (${target}) do update set ${opts.onConflict.set}${opts.onConflict.where ? sql` where ${opts.onConflict.where}` : sql``}`;
    }
    const returning = opts.returning?.length ? sql.raw(` returning ${opts.returning.map(q).join(", ")}`) : sql``;
    const stmt = sql`insert into ${sql.raw(q(getTableName(table)))} (${sql.raw(names.join(", "))}) select ${sql.raw(select)} from unnest(${unnest}) as u(${sql.raw(used.map((_, j) => `c${j}`).join(", "))})${conflict}${returning}`;
    const r = await tx.execute(stmt);
    out.push(...(r.rows as Record<string, unknown>[]));
  }
  return out;
}

/** `excluded.<col>` for each column, as an ON CONFLICT … SET list. */
export const setExcluded = (columns: string[]): SQL => sql.raw(columns.map((c) => `${q(c)} = excluded.${q(c)}`).join(", "));

/**
 * `<column> = any(<ids>)` with the ids as ONE array parameter: the same rows as drizzle's `inArray(column, ids)`, which
 * sends one parameter per id (70,000 parameters for a month of one entity, slow to build and to parse).
 */
export const anyOf = (column: unknown, ids: readonly string[]): SQL => sql`${column} = any(${sql.param([...ids])}::text[])`;
