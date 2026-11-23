import { describe, expect, it } from "vitest";
import { generateWorld, monthPreset, renderFiles, smallPreset, smallWorld, SMALL_PRESET_PARAMS, zipEntries } from "@/lib/clearline/synthetic";
import { sha256 } from "./helpers";

const digests = async (seed: number) => Object.fromEntries((await renderFiles(smallWorld({ seed }))).map((f) => [f.name, sha256(f.bytes)]));

describe("synthetic generator: determinism", () => {
  it("same seed gives identical bytes for every file (small preset)", async () => {
    const a = await digests(40);
    const b = await digests(40);
    expect(Object.keys(a).length).toBeGreaterThanOrEqual(18);
    expect(b).toEqual(a);
  });

  it("a different seed gives different bytes for every file", async () => {
    const a = await digests(40);
    const b = await digests(41);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const name of Object.keys(a)) expect(b[name], name).not.toBe(a[name]);
  });

  it("xlsx output does not depend on the wall clock: zip entries carry the world's fixed date, and bytes match across seconds", async () => {
    const first = await smallPreset();
    await new Promise((r) => setTimeout(r, 2_100)); // DOS times have 2-second resolution
    const second = await smallPreset();
    for (const f of first.files.filter((x) => x.name.endsWith(".xlsx"))) {
      const again = second.files.find((x) => x.name === f.name)!;
      expect(sha256(again.bytes), f.name).toBe(sha256(f.bytes));
      const d = first.world.asOf.slice(0, 10);
      const dosDate = ((Number(d.slice(0, 4)) - 1980) << 9) | (Number(d.slice(5, 7)) << 5) | Number(d.slice(8, 10));
      for (const e of zipEntries(f.bytes)) expect([e.name, e.time, e.date]).toEqual([e.name, 0, dosDate]);
    }
  }, 30_000);

  it("the world itself is deterministic and seed-sensitive", () => {
    const j = (s: number) => JSON.stringify(generateWorld(SMALL_PRESET_PARAMS({ seed: s })), (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
    expect(j(7)).toBe(j(7));
    expect(j(7)).not.toBe(j(8));
  });

  it("month preset: identical digests on a second build", async () => {
    const a = (await monthPreset()).files.map((f) => [f.name, sha256(f.bytes)]);
    const b = (await monthPreset()).files.map((f) => [f.name, sha256(f.bytes)]);
    expect(b).toEqual(a);
  }, 60_000);
});
