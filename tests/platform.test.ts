import { beforeAll, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audit,
  auditRows,
  database,
  getDocument,
  putDocument,
  atomic,
} from "../src/lib/platform/store";
beforeAll(() => {
  process.env.DESK_DATA_DIR = mkdtempSync(join(tmpdir(), "desk-test-"));
});
it("isolates document IDs between workspaces", () => {
  putDocument("case", "same", { secret: "a" }, "tenant-a");
  putDocument("case", "same", { secret: "b" }, "tenant-b");
  expect(getDocument("case", "same", "tenant-a")).toEqual({ secret: "a" });
  expect(getDocument("case", "same", "tenant-c")).toBeUndefined();
});
it("rolls back failed mutations", () => {
  expect(() =>
    atomic(() => {
      putDocument("case", "rollback", {});
      throw Error("fail");
    }),
  ).toThrow();
  expect(getDocument("case", "rollback")).toBeUndefined();
});
it("chains audit events and forbids updates and deletion", () => {
  audit("lookup", "x", "reviewer");
  audit("correction", "x", "reviewer");
  const rows = auditRows() as { hash: string; previous_hash: string }[];
  expect(rows[0].previous_hash).toBe(rows[1].hash);
  expect(() => database().exec("DELETE FROM audit")).toThrow("Append-only");
  expect(() => database().exec("UPDATE audit SET actor='forged'")).toThrow(
    "Append-only",
  );
});
