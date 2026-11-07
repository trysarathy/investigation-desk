import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  chmod,
  symlink,
  stat,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FundingStore } from "../../src/lib/funding/store";
import { emptyFunding } from "../../src/lib/funding/model";
import { importCsv } from "../../src/lib/funding/imports";
import {
  readPrivateFile,
  writePrivateAtomic,
  assertDeploymentLocation,
} from "../../src/lib/funding/private";
import { buildEvidence } from "../../src/lib/funding/evidence";
const actor = { kind: "local_admin" as const, id: "synthetic-test" },
  input = { actor, action: "checks_viewed", details: { case: "synthetic" } };
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "funding-audit-")),
    file = path.join(dir, "funding.json");
  return { dir, file, store: new FundingStore(file) };
}
describe("atomic private audit envelope", () => {
  it("migrates validated raw data and returns a durable anchor", async () => {
    const { file, store } = await setup();
    await writeFile(file, JSON.stringify(emptyFunding()), { mode: 0o600 });
    const anchor = (await store.inspectAudit()).anchor;
    await store.recordAudit(input);
    expect((await store.inspectAudit(anchor)).entries).toHaveLength(2);
    expect((await store.load()).revision).toBe(0);
    expect(JSON.parse(await readFile(file, "utf8")).format).toBe(
      "clearline-funding/v2",
    );
  });
  it("persists a genesis before returning an anchor for a new store", async () => {
    const { file, store } = await setup();
    const a = (await store.inspectAudit()).anchor;
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await new FundingStore(file).inspectAudit(a)).anchor).toEqual(a);
  });
  it("rejects edits, deletions, reordered entries and data tampering", async () => {
    const { file, store } = await setup();
    await store.recordAudit(input);
    await store.recordAudit(input);
    const original = JSON.parse(await readFile(file, "utf8"));
    for (const mutate of [
      (x: typeof original) => {
        x.audit[1].details.case = "changed";
      },
      (x: typeof original) => {
        x.audit.splice(1, 1);
      },
      (x: typeof original) => {
        x.audit.reverse();
      },
      (x: typeof original) => {
        x.data.revision = 50;
      },
    ]) {
      const altered = structuredClone(original);
      mutate(altered);
      await writeFile(file, JSON.stringify(altered));
      await expect(store.load()).rejects.toThrow(/Restore/);
    }
    await writeFile(file, JSON.stringify(original));
    expect((await store.load()).revision).toBe(0);
  });
  it("uses a trusted head to detect valid-prefix truncation while allowing extension", async () => {
    const { file, store } = await setup();
    await store.recordAudit(input);
    const prefix = await readFile(file, "utf8"),
      old = (await store.inspectAudit()).anchor;
    await store.recordAudit(input);
    const latest = (await store.inspectAudit(old)).anchor;
    await writeFile(file, prefix);
    await expect(store.inspectAudit(latest)).rejects.toThrow(/anchor/);
  });
  it("serializes audits and mutations without changing business revisions for views", async () => {
    const { file, store } = await setup();
    await store.inspectAudit();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        new FundingStore(file).recordAudit({ ...input, details: { i } }),
      ),
    );
    expect((await store.load()).revision).toBe(0);
    await Promise.all([
      store.update((d) => [d, undefined]),
      store.recordAudit(input),
    ]);
    expect((await store.load()).revision).toBe(1);
    expect((await store.inspectAudit()).entries).toHaveLength(13);
  });
  it("does not overwrite records when an audited mutation is invalid", async () => {
    const { file, store } = await setup();
    await store.recordAudit(input);
    const before = await readFile(file, "utf8");
    await expect(
      store.update((d) => {
        d.customers.push({} as never);
        return [d, undefined];
      }),
    ).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(before);
    await store.recordAudit(input);
  });
  it("rejects an export snapshot if business revision changed", async () => {
    const { store } = await setup();
    await store.update((d) => [d, undefined]);
    await expect(
      store.recordAudit({ ...input, action: "export_prepared" }, 0),
    ).rejects.toThrow(/Records changed/);
    expect(
      (await store.inspectAudit()).entries.some(
        (e) => e.action === "export_prepared",
      ),
    ).toBe(false);
  });
  it("keeps evidence deterministic across audit-only activity", async () => {
    const { store } = await setup();
    await store.update(async (d) => {
      for (const k of ["customers", "advances", "cash"] as const)
        d = importCsv(
          d,
          k,
          await readFile(`fixtures/funding/${k}.csv`, "utf8"),
          undefined,
          k,
          "2026-11-09T10:00:00Z",
        );
      return [d, undefined];
    });
    const first = buildEvidence(
      await store.load(),
      "advance-1",
      "2026-11-09T10:00:00Z",
    );
    await store.recordAudit(input);
    const second = buildEvidence(
      await store.load(),
      "advance-1",
      "2026-11-09T10:00:00Z",
    );
    expect(first.archive.equals(second.archive)).toBe(true);
  });
  it("enforces private replacement files and refuses unsafe paths", async () => {
    const { dir, file } = await setup();
    await writePrivateAtomic(file, "private");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await writePrivateAtomic(file, "replacement");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const link = path.join(dir, "link");
    await symlink(file, link);
    await expect(readPrivateFile(link)).rejects.toThrow(/private/);
    await expect(writePrivateAtomic(link, "bad")).rejects.toThrow(/private/);
    await chmod(file, 0o644);
    await expect(readPrivateFile(file)).rejects.toThrow(/private/);
    await chmod(file, 0o600);
    await chmod(dir, 0o755);
    await expect(readPrivateFile(file)).rejects.toThrow(/directory/);
    expect(() =>
      assertDeploymentLocation(path.join(process.cwd(), "public", "private")),
    ).toThrow(/outside/);
  });
  it("does not change data or audit if the private writer cannot replace a directory", async () => {
    const { file, store } = await setup();
    await mkdir(file);
    await expect(store.recordAudit(input)).rejects.toThrow(/Restore/);
    expect((await stat(file)).isDirectory()).toBe(true);
  });
  it("audits an atomic view before a concurrent writer changes the revision", async () => {
    const { store } = await setup();
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const viewing = store.observe(async (data) => {
      const revision = data.revision;
      start();
      await gate;
      return {
        result: revision,
        audit: { ...input, details: { viewed_revision: revision } },
      };
    });
    await started;
    const writing = store.update((data) => [data, undefined]);
    release();
    expect(await viewing).toBe(0);
    await writing;
    const history = await store.inspectAudit();
    expect(history.data.revision).toBe(1);
    expect(history.entries.some((entry) =>
      entry.action === "checks_viewed" &&
      entry.details.viewed_revision === 0
    )).toBe(true);
  });
  it("rejects a read callback that changes business records", async () => {
    const { store } = await setup();
    const before = await store.load();
    await expect(store.observe((data) => {
      data.revision = 99;
      return { result: null, audit: input };
    })).rejects.toThrow(/review cannot modify/);
    expect(await store.load()).toEqual(before);
  });
});
