import { describe, expect, it } from "vitest";
import { compareDecimal } from "@/lib/decimal";
import { investigate } from "@/lib/engine/run";
import { looksAlike } from "@/lib/engine/context";
import { SAMPLE_CASES, SAMPLE_SETTINGS, findCase, withChainDown } from "@/lib/fixtures";
import { normaliseInput } from "@/lib/normalise";
import { fillReply } from "@/lib/templates";
import type { Code, Facts } from "@/lib/types";

const latest = (id: string): Facts => {
  const c = findCase(id)!;
  return c.snapshots[c.snapshots.length - 1];
};
const run = (f: Facts) => investigate(f, SAMPLE_SETTINGS);

describe("one fixture case per catalogue code", () => {
  const expected: [string, Code, "High" | "Medium" | null][] = [
    ["CS-1055", "D01", "High"],
    ["CS-1042", "D02", "High"],
    ["CS-1043", "D03", "High"],
    ["CS-1044", "D04", "High"],
    ["CS-1045", "D05", "High"],
    ["CS-1046", "D06", "High"],
    ["CS-1047", "D07", "High"],
    ["CS-1048", "D07b", "Medium"],
    ["CS-1049", "D08", "High"],
    ["CS-1050", "D09", "High"],
    ["CS-1051", "D10", "Medium"],
    ["CS-1052", "D11", "Medium"],
    ["CS-1041", "D12", "High"],
    ["CS-1053", "D13", "High"],
    ["CS-1054", "D14", "High"],
    ["CS-1056", "D99", null],
  ];

  it.each(expected)("%s returns %s", (id, code, confidence) => {
    const v = run(latest(id));
    expect(v.state).toBe("verdict");
    expect(v.code).toBe(code);
    expect(v.confidence).toBe(confidence);
  });

  it("covers every code", () => {
    const codes = new Set(expected.map((e) => e[1]));
    for (const c of ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D07b", "D08", "D09", "D10", "D11", "D12", "D13", "D14", "D99"]) {
      expect(codes.has(c as Code)).toBe(true);
    }
  });
});

describe("verdict integrity", () => {
  it.each(SAMPLE_CASES.map((c) => c.id))("%s cites only evidence that exists, and records versions", (id) => {
    const v = run(latest(id));
    const ids = new Set(v.evidence.map((e) => e.id));
    for (const e of v.evidenceIds) expect(ids.has(e)).toBe(true);
    expect(v.ruleVersion).toMatch(/^rules-/);
    expect(v.settingsVersion).toBe(SAMPLE_SETTINGS.version);
  });

  it("runs every rule, not just up to the winner", () => {
    expect(run(latest("CS-1055")).checks).toHaveLength(15);
  });

  it("is deterministic", () => {
    expect(run(latest("CS-1041"))).toEqual(run(latest("CS-1041")));
  });
});

describe("contradiction", () => {
  it("D02 becomes D12 after re-check", () => {
    const c = findCase("CS-1057")!;
    expect(run(c.snapshots[0]).code).toBe("D02");
    expect(run(c.snapshots[1]).code).toBe("D12");
  });
});

describe("chain API down", () => {
  it("pauses instead of guessing when the tx's chain is unreachable", () => {
    const v = run(withChainDown(latest("CS-1041"), "tron"));
    expect(v.state).toBe("paused");
    expect(v.pausedChains).toEqual(["tron"]);
  });

  it("never reports D01 when any chain lookup failed", () => {
    const v = run(withChainDown(latest("CS-1055"), "bsc"));
    expect(v.state).toBe("paused");
  });

  it("still decides cases on other chains", () => {
    expect(run(withChainDown(latest("CS-1047"), "tron")).code).toBe("D07");
  });
});

describe("prompt injection", () => {
  it("a ledger note saying 'ignore instructions' does not change the verdict", () => {
    const f = latest("CS-1054");
    expect(f.ledger.some((r) => r.note?.toLowerCase().includes("ignore"))).toBe(true);
    const clean: Facts = { ...f, ledger: f.ledger.map((r) => ({ ...r, note: undefined })) };
    const a = run(f);
    const b = run(clean);
    expect(a.code).toBe("D14");
    expect(a).toEqual(b);
    expect(JSON.stringify(a.evidence)).not.toMatch(/ignore/i);
  });
});

describe("rule guards", () => {
  it("never tells a fake-token sender it will be credited, even while unconfirmed", () => {
    const f = latest("CS-1046");
    const unconfirmed: Facts = { ...f, currentBlock: f.tx!.blockNumber + 3 };
    expect(run(unconfirmed).code).toBe("D06");
  });

  it("below-minimum while unconfirmed is D08, not D02", () => {
    const f = latest("CS-1049");
    expect(run({ ...f, currentBlock: f.tx!.blockNumber + 3 }).code).toBe("D08");
  });

  it("a look-alike address without an earlier dust transfer stays D07 High", () => {
    const f = latest("CS-1048");
    const v = run({ ...f, senderHistory: [] });
    expect(v.code).toBe("D07");
    expect(v.confidence).toBe("High");
  });

  it("does not run D06 without a confirmed official contract", () => {
    const v = run(latest("CS-1044"));
    const d06 = v.checks.find((c) => c.code === "D06")!;
    expect(d06.matched).toBe(false);
    expect(d06.reason).toMatch(/No confirmed official/);
  });

  it("D04 next step depends on the keys-held setting", async () => {
    const { nextStep } = await import("@/lib/catalogue");
    expect(nextStep("D04", SAMPLE_SETTINGS)).toMatch(/Unrecoverable/);
    expect(nextStep("D04", { ...SAMPLE_SETTINGS, keysHeldOnOtherChains: true })).toMatch(/Ops decides/);
  });
});

describe("reply templates", () => {
  it("fills D02 from evidence only", () => {
    const v = run(latest("CS-1042"));
    const r = fillReply(v.code, v.fill)!;
    expect(r.open).toEqual([]);
    expect(r.text).toContain("8 of 20 confirmations");
  });

  it("leaves {date} for the analyst on D12", () => {
    const v = run(latest("CS-1041"));
    expect(fillReply(v.code, v.fill)!.open).toEqual(["date"]);
  });

  it("neutral hold reply never mentions sanctions or AML", () => {
    for (const code of ["D09", "D14"] as const) {
      const r = fillReply(code, {})!;
      expect(r.text).not.toMatch(/sanction|aml|suspic|fraud/i);
    }
  });

  it("has no draft where the spec has no approved template", () => {
    expect(fillReply("D99", {})).toBeNull();
    expect(fillReply("D13", {})).toBeNull();
  });
});

describe("input normalisation", () => {
  it.each([
    ["a".repeat(64), "hash"],
    ["0x" + "B".repeat(64), "hash"],
    ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "tron_address"],
    ["0xdAC17F958D2ee523a2206206994597C13D831ec7", "evm_address"],
    ["c-10422", "customer_ref"],
    ["WD-88231904", "unrecognised"],
  ])("%s is %s", (raw, kind) => {
    expect(normaliseInput(raw).kind).toBe(kind);
  });
});

describe("decimals", () => {
  it.each([
    ["0.50", "1", -1],
    ["1", "1.000", 0],
    ["10.01", "10.1", -1],
    ["250.00", "10", 1],
    ["007", "7", 0],
  ])("compare(%s, %s) = %i", (a, b, r) => {
    expect(compareDecimal(a, b)).toBe(r);
  });

  it("rejects floats in exponent form", () => {
    expect(() => compareDecimal("1e3", "1")).toThrow();
  });
});

describe("look-alike match", () => {
  it("matches first 4 and last 4 only when addresses differ", () => {
    expect(looksAlike("TAbcdXXXXXXXXwxyz", "TAbcdYYYYYYYYwxyz")).toBe(true);
    expect(looksAlike("TAbcdXXXXXXXXwxyz", "TAbcdXXXXXXXXwxyz")).toBe(false);
    expect(looksAlike("0xABCD1111eeee", "0xabcd2222EEEE")).toBe(true);
  });
});
