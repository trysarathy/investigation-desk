import { describe, expect, it } from "vitest";
import { compareDecimal } from "@/lib/decimal";
import { investigate } from "@/lib/engine/run";
import { looksAlike } from "@/lib/engine/context";
import { SAMPLE_CASES, SAMPLE_SETTINGS, findCase, withChainDown } from "@/lib/fixtures";
import { normaliseInput } from "@/lib/normalise";
import { fillReply, REPLY_TEMPLATES } from "@/lib/templates";
import type { Code, Facts, ProviderEvent } from "@/lib/types";

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
    ["CS-1048", "D07", "High"],
    ["CS-1049", "D08", "High"],
    ["CS-1050", "D09", "High"],
    ["CS-1051", "D10", "Medium"],
    ["CS-1052", "D11", "Medium"],
    ["CS-1041", "D12", "High"],
    ["CS-1053", "D13", "High"],
    ["CS-1054", "D14", "High"],
    ["CS-1056", "D16", "High"],
    ["CS-1058", "D13", "Medium"],
    ["CS-1059", "D12", "Medium"],
    ["CS-1060", "D99", null],
  ];

  it.each(expected)("%s returns %s", (id, code, confidence) => {
    const v = run(latest(id));
    expect(v.state).toBe("verdict");
    expect(v.code).toBe(code);
    expect(v.confidence).toBe(confidence);
  });

  it("covers every code", () => {
    const codes = new Set(expected.map((e) => e[1]));
    for (const c of ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10", "D11", "D12", "D13", "D14", "D16", "D99"]) {
      expect(codes.has(c as Code)).toBe(true);
    }
    // D07b is never a verdict on its own fixture; it appears as a finding (see "c." below).
    expect(run(latest("CS-1048")).findings.map((f) => f.code)).toEqual(["D07b"]);
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
    expect(run(latest("CS-1055")).checks).toHaveLength(16);
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

  it("a look-alike address without an earlier dust transfer is D07 High with no finding", () => {
    const f = latest("CS-1048");
    const v = run({ ...f, senderHistory: [] });
    expect(v.code).toBe("D07");
    expect(v.confidence).toBe("High");
    expect(v.findings).toEqual([]);
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

  it("has no draft for D99", () => {
    expect(fillReply("D99", {})).toBeNull();
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

// ---- 22 Oct spec changes ----

const withTransfer = (f: Facts, patch: Partial<NonNullable<Facts["tx"]>["transfers"][number]>): Facts => ({
  ...f,
  tx: { ...f.tx!, transfers: f.tx!.transfers.map((t, i, all) => (i === all.length - 1 ? { ...t, ...patch } : t)) },
});

describe("a. D02 only matches a deposit that would otherwise be credited", () => {
  const unconfirmed = (f: Facts): Facts => ({ ...f, currentBlock: f.tx!.blockNumber + 3 });

  it("matches a creditable deposit with too few confirmations", () => {
    expect(run(latest("CS-1042")).code).toBe("D02");
  });

  it.each([
    ["fake token", "CS-1046", "D06"],
    ["below minimum", "CS-1049", "D08"],
    ["wrong address", "CS-1047", "D07"],
    ["unsupported token", "CS-1045", "D05"],
  ])("a %s with few confirmations is never D02", (_, id, code) => {
    const v = run(unconfirmed(latest(id)));
    expect(v.code).toBe(code);
    expect(v.checks.find((c) => c.code === "D02")!.matched).toBe(false);
  });

  it("an issuer freeze with few confirmations is D09, not D02", () => {
    expect(run(unconfirmed(latest("CS-1050"))).code).toBe("D09");
  });
});

describe("b. D05 skips USDT and USDC so D06 can fire", () => {
  it("a fake USDT to a company address is D06, and D05 records why it stood aside", () => {
    const v = run(latest("CS-1046"));
    expect(v.code).toBe("D06");
    expect(v.checks.find((c) => c.code === "D05")!.reason).toMatch(/USDT or USDC/);
  });

  it("D05 does not match a USDC transfer even when the contract is off the allowlist", () => {
    const v = run(withTransfer(latest("CS-1045"), { tokenSymbol: "USDC" }));
    expect(v.checks.find((c) => c.code === "D05")!.matched).toBe(false);
    expect(v.code).not.toBe("D05");
  });

  it("D05 still matches other unsupported tokens", () => {
    expect(run(latest("CS-1045")).code).toBe("D05");
  });
});

describe("c. D07b never outranks D07", () => {
  it("look-alike pattern keeps D07 High and attaches D07b as a Medium finding", () => {
    const v = run(latest("CS-1048"));
    expect(v.code).toBe("D07");
    expect(v.confidence).toBe("High");
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toMatchObject({ code: "D07b", confidence: "Medium", matched: true });
    expect(v.findings[0].evidenceIds).toContain("ev.history");
  });

  it("the D07 rule matches whether or not the look-alike pattern is present", () => {
    const f = latest("CS-1048");
    expect(run(f).checks.find((c) => c.code === "D07")!.matched).toBe(true);
    expect(run({ ...f, senderHistory: [] }).checks.find((c) => c.code === "D07")!.matched).toBe(true);
  });

  it("findings never include the verdict itself", () => {
    for (const c of SAMPLE_CASES) {
      const v = run(latest(c.id));
      expect(v.findings.some((f) => f.code === v.code)).toBe(false);
    }
  });
});

describe("d. REJECTED ledger rows are D16", () => {
  it("a confirmed valid deposit with a REJECTED row is D16 High, not D99", () => {
    const v = run(latest("CS-1056"));
    expect(v.code).toBe("D16");
    expect(v.confidence).toBe("High");
  });

  it("shows the reason code as evidence", () => {
    const ledger = run(latest("CS-1056")).evidence.find((e) => e.id === "ev.ledger")!;
    expect(ledger.detail).toContain("R-207");
  });

  it("uses the neutral D14 reply", () => {
    expect(fillReply("D16", {})!.text).toBe(fillReply("D14", {})!.text);
  });

  it("does not apply before the deposit is confirmed", () => {
    const f = latest("CS-1056");
    const v = run({ ...f, currentBlock: f.tx!.blockNumber + 3 });
    expect(v.checks.find((c) => c.code === "D16")!.matched).toBe(false);
  });
});

describe("e. ledger verdicts are High only on an exact match", () => {
  it("exact chain + hash + transfer index + contract gives High", () => {
    const v = run(latest("CS-1053"));
    expect(v.code).toBe("D13");
    expect(v.confidence).toBe("High");
  });

  it("a row whose transfer_index points at another transfer does not count for this one", () => {
    const f = latest("CS-1053");
    const ledger = f.ledger.map((r) => (r.depositId === "DEP-55120" ? { ...r, transferIndex: 0 } : r));
    const v = run({ ...f, ledger });
    expect(v.code).toBe("D12");
    expect(v.confidence).toBe("High");
  });

  it("a row for a different token contract does not match", () => {
    const f = latest("CS-1041");
    const ledger = [...f.ledger, { row: 99, depositId: "DEP-X", txHash: f.tx!.hash, chain: "tron" as const, token: "USDC" as const,
      toAddress: f.tx!.transfers[0].to, amount: "250.00", status: "CREDITED" as const, customerId: "C-10422" }];
    expect(run({ ...f, ledger }).code).toBe("D12");
  });

  it("no transfer_index with one company transfer in the tx is still exact", () => {
    const f = latest("CS-1053");
    const ledger = f.ledger.map((r) => (r.depositId === "DEP-55120" ? { ...r, transferIndex: undefined } : r));
    expect(run({ ...f, ledger }).confidence).toBe("High");
  });

  it("no transfer_index with several company transfers caps D13 at Medium", () => {
    const v = run(latest("CS-1058"));
    expect(v.code).toBe("D13");
    expect(v.confidence).toBe("Medium");
  });

  it("adding the transfer_index restores High", () => {
    const f = latest("CS-1058");
    const ledger = f.ledger.map((r) => (r.depositId === "DEP-55161" ? { ...r, transferIndex: 1 } : r));
    expect(run({ ...f, ledger }).confidence).toBe("High");
  });

  it("an address-and-amount-only match caps D12 at Medium", () => {
    const v = run(latest("CS-1059"));
    expect(v.code).toBe("D12");
    expect(v.confidence).toBe("Medium");
  });

  it.each(["HELD", "REJECTED"] as const)("an address-and-amount-only %s row caps at Medium", (status) => {
    const f = latest("CS-1059");
    const ledger = f.ledger.map((r) => (r.depositId === "DEP-55170" ? { ...r, status } : r));
    const v = run({ ...f, ledger });
    expect(v.code).toBe(status === "HELD" ? "D14" : "D16");
    expect(v.confidence).toBe("Medium");
  });
});

describe("f. no reply promises a future credit", () => {
  it("no template contains 'will be credited'", () => {
    for (const [code, t] of Object.entries(REPLY_TEMPLATES)) {
      expect(t, code).not.toMatch(/will be credited/i);
    }
  });

  it("no filled sample reply contains 'will be credited', including company policy text", () => {
    for (const c of SAMPLE_CASES) {
      for (const f of c.snapshots) {
        const v = run(f);
        const r = fillReply(v.code, v.fill);
        if (r) expect(r.text, c.id).not.toMatch(/will be credited/i);
      }
    }
  });

  it("D02 uses the 22 Oct wording", () => {
    const v = run(latest("CS-1042"));
    expect(fillReply(v.code, v.fill)!.text).toBe(
      "Your transfer is on the Tron network and has 8 of 20 confirmations. Once it reaches 20 confirmations it becomes eligible for crediting, usually within about a minute. We'll confirm when it has been credited.");
  });

  it("D10 uses the 22 Oct wording", () => {
    const v = run(latest("CS-1051"));
    expect(fillReply(v.code, v.fill)).toEqual({
      text: "Your transaction is still waiting to be processed by the Ethereum network. Once the network confirms it, our usual deposit checks apply. If it's still pending after 30 minutes, please let us know.",
      open: [],
    });
  });

  it("D01 names the chains checked", () => {
    const v = run(latest("CS-1055"));
    const r = fillReply(v.code, v.fill)!;
    expect(r.open).toEqual([]);
    expect(r.text).toContain("on Tron, Ethereum, BNB Chain, Polygon, Base, Arbitrum and Optimism.");
  });

  it("D05 fills token and chain, leaves the date to the analyst", () => {
    const v = run(latest("CS-1045"));
    const r = fillReply(v.code, v.fill)!;
    expect(r.text).toContain("We received DAI on Ethereum");
    expect(r.open).toEqual(["date"]);
  });

  it("D11 has its template", () => {
    const v = run(latest("CS-1052"));
    expect(fillReply(v.code, v.fill)!.text).toMatch(/^The ID you sent is a withdrawal reference/);
  });

  it("D13 fills amount, token and credit time, leaves where_in_app to the analyst", () => {
    const v = run(latest("CS-1053"));
    const r = fillReply(v.code, v.fill)!;
    expect(r.text).toContain("Your deposit of 1200.00 USDT was credited on 2026-10-21 11:41 SGT.");
    expect(r.open).toEqual(["where_in_app"]);
  });

  it("every code with a verdict fixture except D99 has a template", () => {
    for (const code of ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D07b", "D08", "D09", "D10", "D11", "D12", "D13", "D14", "D16"] as Code[]) {
      expect(REPLY_TEMPLATES[code], code).toBeDefined();
    }
  });
});

describe("g. the model holds provider payout events", () => {
  const events: ProviderEvent[] = [
    { provider: "SamplePay", reference: "PO-881", kind: "payout_created", providerStatus: "CREATED", amount: "1000.00", currency: "SGD", at: "2026-10-21T10:00:00+08:00", fetchedAt: "2026-10-21T15:20:00+08:00", rawBody: "{}" },
    { provider: "SamplePay", reference: "PO-881", kind: "status_update", providerStatus: "COMPLETED", at: "2026-10-21T10:05:00+08:00", fetchedAt: "2026-10-21T15:20:00+08:00", rawBody: "{}" },
    { provider: "SamplePay", reference: "PO-881", kind: "returned", providerStatus: "RETURNED", returnReason: "AC04 closed account", at: "2026-10-22T09:00:00+08:00", fetchedAt: "2026-10-22T09:05:00+08:00", rawBody: "{}" },
  ];

  it("stores payout events, provider statuses and returns as evidence with a provider source", () => {
    const v = run({ ...latest("CS-1041"), providerEvents: events });
    const rows = v.evidence.filter((e) => e.source.kind === "provider");
    expect(rows).toHaveLength(3);
    expect(rows[1].value).toContain("COMPLETED");
    expect(rows[2].value).toContain("AC04 closed account");
    expect(rows[2].status).toBe("fail");
  });

  it("no rule reads them yet: the deposit verdict is unchanged", () => {
    const f = latest("CS-1041");
    const a = run(f);
    const b = run({ ...f, workflow: "payout", providerEvents: events });
    expect(b.code).toBe(a.code);
    expect(b.confidence).toBe(a.confidence);
    expect(b.checks).toEqual(a.checks);
  });
});
