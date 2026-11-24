/**
 * v1 phase 0: stored difference rows across reconciliation runs. Pure helpers, no I/O.
 *
 * Every row names the run and rule-set version that produced it. When a run re-decides a payment, the payment's
 * earlier rows that the new decision no longer names are marked superseded (when, by which run): they are kept for the
 * evidence and audit views, and never counted again. Rows are content-addressed (`<engine id>@<content hash>`), so an
 * identical rerun writes nothing; a content id whose row an earlier run superseded (A, then B, then A again) gets a
 * fresh row `<content id>~<run>` rather than reviving the superseded one.
 */

/** Separates a fresh row's run tag from its content id. Content ids never contain it. */
export const RUN_TAG = "~";

/**
 * The id each difference of this run is stored under: its content id, unless that row (and every earlier fresh row of
 * the same content) is superseded, in which case a fresh id tagged with this run. A current fresh row is reused.
 *
 * @param contentIds  key → content id, for every difference the run decided
 * @param existing    ids already stored for these payments, with whether each is superseded
 */
export function differenceIdsFor(contentIds: ReadonlyMap<string, string>, existing: ReadonlyMap<string, boolean>, runId: string): Map<string, string> {
  const byContent = new Map<string, { id: string; superseded: boolean }[]>();
  for (const [id, superseded] of existing) {
    const base = id.split(RUN_TAG)[0];
    const a = byContent.get(base);
    if (a) a.push({ id, superseded }); else byContent.set(base, [{ id, superseded }]);
  }
  const fresh = (base: string) => `${base}${RUN_TAG}${runId.replace(/-/g, "").slice(0, 12)}`;
  const out = new Map<string, string>();
  for (const [key, base] of contentIds) {
    const rows = byContent.get(base) ?? [];
    const current = rows.find((r) => !r.superseded);
    out.set(key, current ? current.id : rows.length ? fresh(base) : base);
  }
  return out;
}

export interface StoredDifferenceRow { supersededAt: Date | string | null }

/** Current rows (counted, shown by default) and superseded rows (evidence and audit views only). */
export function splitDifferences<T extends StoredDifferenceRow>(rows: readonly T[]): { current: T[]; superseded: T[] } {
  return { current: rows.filter((r) => r.supersededAt === null), superseded: rows.filter((r) => r.supersededAt !== null) };
}
