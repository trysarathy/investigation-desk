/**
 * v1 phase 0: which id a run stores each difference under, and the current/superseded split readers use
 * (src/lib/clearline/merchant/difference-rows.ts). Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { RUN_TAG, differenceIdsFor, splitDifferences } from "@/lib/clearline/merchant/difference-rows";

const RUN = "0f1e2d3c-4b5a-4968-8776-655443322110";
const tag = `${RUN_TAG}0f1e2d3c4b5a`;

describe("differenceIdsFor", () => {
  it("a new difference is stored under its content id", () => {
    expect([...differenceIdsFor(new Map([["BK-1|D1", "BK-1.D1@aaaaaaaaaa"]]), new Map(), RUN)]).toEqual([["BK-1|D1", "BK-1.D1@aaaaaaaaaa"]]);
  });
  it("an identical rerun reuses the current row (nothing new is written)", () => {
    const ids = differenceIdsFor(new Map([["BK-1|D1", "BK-1.D1@aaaaaaaaaa"]]), new Map([["BK-1.D1@aaaaaaaaaa", false]]), RUN);
    expect(ids.get("BK-1|D1")).toBe("BK-1.D1@aaaaaaaaaa");
  });
  it("content an earlier run superseded comes back as a fresh row tagged with this run, never by reviving the old one", () => {
    const ids = differenceIdsFor(new Map([["BK-1|D1", "BK-1.D1@aaaaaaaaaa"]]), new Map([["BK-1.D1@aaaaaaaaaa", true]]), RUN);
    expect(ids.get("BK-1|D1")).toBe(`BK-1.D1@aaaaaaaaaa${tag}`);
  });
  it("a current fresh row of that content is reused by the next identical run", () => {
    const fresh = "BK-1.D1@aaaaaaaaaa~111111111111";
    const ids = differenceIdsFor(new Map([["BK-1|D1", "BK-1.D1@aaaaaaaaaa"]]), new Map([["BK-1.D1@aaaaaaaaaa", true], [fresh, false]]), RUN);
    expect(ids.get("BK-1|D1")).toBe(fresh);
  });
  it("every row of that content superseded: one more fresh row", () => {
    const ids = differenceIdsFor(new Map([["BK-1|D1", "BK-1.D1@aaaaaaaaaa"]]), new Map([["BK-1.D1@aaaaaaaaaa", true], ["BK-1.D1@aaaaaaaaaa~111111111111", true]]), RUN);
    expect(ids.get("BK-1|D1")).toBe(`BK-1.D1@aaaaaaaaaa${tag}`);
  });
  it("other payments' rows do not affect the id", () => {
    const ids = differenceIdsFor(new Map([["BK-1|D1", "BK-1.D1@aaaaaaaaaa"]]), new Map([["BK-2.D1@bbbbbbbbbb", true]]), RUN);
    expect(ids.get("BK-1|D1")).toBe("BK-1.D1@aaaaaaaaaa");
  });
});

describe("splitDifferences", () => {
  it("current rows (counted) and superseded rows (evidence only), each once", () => {
    const rows = [{ id: "a", supersededAt: null }, { id: "b", supersededAt: new Date("2026-11-24T00:00:00Z") }, { id: "c", supersededAt: "2026-11-24T00:00:00Z" }, { id: "d", supersededAt: null }];
    const s = splitDifferences(rows);
    expect(s.current.map((r) => r.id)).toEqual(["a", "d"]);
    expect(s.superseded.map((r) => r.id)).toEqual(["b", "c"]);
    expect(s.current.length + s.superseded.length).toBe(rows.length);
  });
});
