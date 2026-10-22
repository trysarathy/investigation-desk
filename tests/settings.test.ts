import { expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSettings, companySettings } from "../src/lib/platform/settings";
import { SAMPLE_SETTINGS } from "../src/lib/fixtures";
beforeAll(
  () =>
    (process.env.DESK_DATA_DIR = mkdtempSync(join(tmpdir(), "settings-test-"))),
);
it("does not use sample policy for a live company", () => {
  expect(companySettings(false)).toBeUndefined();
  expect(companySettings(true)).toEqual(SAMPLE_SETTINGS);
});
it("versions valid policies and rejects missing facts", () => {
  const a = saveSettings(structuredClone(SAMPLE_SETTINGS), "admin");
  const b = saveSettings(structuredClone(SAMPLE_SETTINGS), "admin");
  expect(a.version).not.toBe(b.version);
  const bad = structuredClone(SAMPLE_SETTINGS);
  bad.confirmations.tron = NaN;
  expect(() => saveSettings(bad, "admin")).toThrow("positive");
});
