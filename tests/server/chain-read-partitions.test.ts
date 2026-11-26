/** v1 #169: the chain-read-partitions command keeps 24 months ahead by default; the value is bounded. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHAIN_READ_PARTITION_MONTHS_AHEAD, monthsAheadArg } from "@/server/chain-read-partitions";

describe("chain-read-partitions --months-ahead", () => {
  it("defaults to 24 months ahead", () => {
    expect(CHAIN_READ_PARTITION_MONTHS_AHEAD).toBe(24);
    expect(monthsAheadArg([])).toBe(24);
  });
  it("takes a whole number from 0 to 120 and refuses anything else", () => {
    expect(monthsAheadArg(["--months-ahead", "0"])).toBe(0);
    expect(monthsAheadArg(["--months-ahead", "120"])).toBe(120);
    for (const v of ["-1", "121", "1.5", "x", undefined]) expect(() => monthsAheadArg(v === undefined ? ["--months-ahead"] : ["--months-ahead", v])).toThrow(/whole number from 0 to 120/);
  });
  it("migration 0047 widens the initial window to 24 months ahead, with the owner-only function", () => {
    const m = readFileSync("drizzle/0047_chain_reads_partitions_24_months.sql", "utf8");
    expect(m).toMatch(/chain_reads_ensure_partitions\(.*make_interval\(months => 24\)/);
  });
});
