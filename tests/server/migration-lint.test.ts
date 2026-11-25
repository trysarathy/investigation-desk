/** v1 phase 6: the expand/contract migration lint (scripts/deploy/check-migrations.mjs). Fictional SQL only. */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error plain .mjs script without types
import { destructive, judge, stripSql, waivers } from "../../scripts/deploy/check-migrations.mjs";

type D = { rule: string; kind: string; id: string; table?: string; to?: string };
const ids = (sql: string) => (destructive(sql) as D[]).map((d) => `${d.rule}:${d.kind}:${d.table ? `${d.table}.` : ""}${d.id}${d.to ? `>${d.to}` : ""}`);

describe("what counts as schema-breaking", () => {
  it("finds drops, renames and type changes, with or without IF EXISTS, schema prefixes and quotes", () => {
    expect(ids(`DROP TABLE IF EXISTS public.old_things CASCADE;`)).toEqual(["drop:table:old_things"]);
    expect(ids(`drop table a, "b";`)).toEqual(["drop:table:a", "drop:table:b"]);
    expect(ids(`ALTER TABLE ONLY public.uploads DROP COLUMN IF EXISTS legacy_flag, ADD COLUMN x int;`)).toEqual(["drop:column:uploads.legacy_flag"]);
    expect(ids(`alter table "uploads" rename column file_name to original_name;`)).toEqual(["rename:column:uploads.file_name>original_name"]);
    expect(ids(`ALTER TABLE uploads RENAME TO stored_uploads;`)).toEqual(["rename:table:uploads>stored_uploads"]);
    expect(ids(`ALTER TABLE uploads ALTER COLUMN row_count TYPE bigint;`)).toEqual(["type:column:uploads.row_count"]);
    expect(ids(`ALTER TABLE uploads ALTER COLUMN row_count SET DATA TYPE bigint;`)).toEqual(["type:column:uploads.row_count"]);
    expect(ids(`DROP FUNCTION IF EXISTS prov_old(uuid, text);`)).toEqual(["drop:function:prov_old"]);
  });
  it("leaves additive statements, comments and constraint/policy/index drops alone", () => {
    expect(ids(`-- DROP TABLE commented_out;\n/* ALTER TABLE x DROP COLUMN y; */\nALTER TABLE uploads ADD COLUMN note text; CREATE INDEX i ON uploads (note);`)).toEqual([]);
    expect(ids(`DROP POLICY p ON uploads; DROP INDEX IF EXISTS i; ALTER TABLE uploads DROP CONSTRAINT c;`)).toEqual([]);
    expect(stripSql("a -- b\nc /* d */ e")).toBe("a c e");
  });
});

describe("the rule", () => {
  const nowhere = () => [];
  it("a drop of something neither the deployed nor the new code names passes", () => {
    expect(judge([{ file: "drizzle/0099_x.sql", sql: "ALTER TABLE uploads DROP COLUMN legacy_flag;" }], nowhere).failures).toEqual([]);
  });
  it("a drop in the same release as the code that stopped using it fails (the deployed code still names it)", () => {
    const r = judge([{ file: "drizzle/0099_x.sql", sql: "ALTER TABLE uploads DROP COLUMN legacy_flag;" }], (id: string) => (id === "legacy_flag" ? ["base"] : []));
    expect(r.failures).toEqual(["drizzle/0099_x.sql: DROP column uploads.legacy_flag: still named by the code at base; stop using it in one release and drop it in a later one"]);
  });
  it("renames and type changes always fail; a written waiver passes and is reported", () => {
    expect(judge([{ file: "f.sql", sql: "ALTER TABLE t RENAME COLUMN a TO b;" }], nowhere).failures[0]).toMatch(/RENAME column t.a -> b: old and new code cannot both run/);
    const w = judge([{ file: "f.sql", sql: "-- migration-lint: allow rename a -- table is empty and unused (fictional)\nALTER TABLE t RENAME COLUMN a TO b;" }], nowhere);
    expect(w.failures).toEqual([]);
    expect(w.waived).toEqual(["f.sql: RENAME column t.a -> b (waived: table is empty and unused (fictional))"]);
    expect(waivers("-- migration-lint: allow drop x\n")).toEqual([]); // a waiver needs a reason
  });
  it("every migration in the repository parses (the lint never crashes on real files)", () => {
    const dir = path.resolve(__dirname, "../../drizzle");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(40);
    for (const f of files) expect(() => destructive(readFileSync(path.join(dir, f), "utf8"))).not.toThrow();
  });
});
