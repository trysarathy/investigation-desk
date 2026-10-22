import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepLegacyFiles } from "../src/lib/platform/retention";
it("expires local raw evidence and ledger snapshots while preserving recent data", async () => {
  const root = await mkdtemp(join(tmpdir(), "retention-"));
  await mkdir(join(root, "raw"));
  await writeFile(
    join(root, "raw", "aa.json"),
    JSON.stringify({ fetchedAt: "2020-01-01T00:00:00Z" }),
  );
  await writeFile(
    join(root, "raw", "bb.json"),
    JSON.stringify({ fetchedAt: "2026-10-22T00:00:00Z" }),
  );
  await writeFile(
    join(root, "workspace.json"),
    JSON.stringify({
      fileA: {
        upload: { uploadedAt: "2020-01-01T00:00:00Z" },
        rows: [{ private: "old" }],
      },
      history: [],
    }),
  );
  expect(await sweepLegacyFiles(root, Date.parse("2026-10-01"))).toEqual({
    deletedFiles: 1,
  });
  expect(await readdir(join(root, "raw"))).toEqual(["bb.json"]);
  expect(
    JSON.parse(await readFile(join(root, "workspace.json"), "utf8")).fileA,
  ).toBeUndefined();
});
