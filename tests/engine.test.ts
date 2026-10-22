import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareDecimal } from "@/lib/decimal";
import { investigate } from "@/lib/engine/run";
import { CATALOGUE_ORDER, nextStep } from "@/lib/catalogue";
import { looksAlike } from "@/lib/engine/context";
import {
  SAMPLE_CASES,
  SAMPLE_SETTINGS,
  findCase,
  withChainDown,
} from "@/lib/fixtures";
import { normaliseInput } from "@/lib/normalise";
import { canonicalAddress, tronToHex } from "@/lib/address";
import { fillReply, REPLY_TEMPLATES } from "@/lib/templates";
import type { Code, Facts, ProviderEvent } from "@/lib/types";

const latest = (id: string): Facts => {
  const c = findCase(id)!;
  return c.snapshots[c.snapshots.length - 1];
};
const run = (f: Facts) => investigate(f, SAMPLE_SETTINGS);
const MEMPOOL_ON = { ...SAMPLE_SETTINGS, mempoolChecksEnabled: true };

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
    ["CS-1051", "D99", null],
    ["CS-1052", "D11", "Medium"],
    ["CS-1041", "D12", "High"],
    ["CS-1053", "D13", "High"],
    ["CS-1054", "D14", "High"],
    ["CS-1056", "D16", "High"],
    ["CS-1058", "D13", "Medium"],
    ["CS-1059", "D12", "Medium"],
    ["CS-1060", "D99", null],
    ["CS-1061", "D17", "High"],
    ["CS-1062", "D18", "High"],
  ];

  it.each(expected)("%s returns %s", (id, code, confidence) => {
    const v = run(latest(id));
    expect(v.state).toBe("verdict");
    expect(v.code).toBe(code);
    expect(v.confidence).toBe(confidence);
  });

  it("covers every code", () => {
    const codes = new Set(expected.map((e) => e[1]));
    for (const c of [
      "D01",
      "D02",
      "D03",
      "D04",
      "D05",
      "D06",
      "D07",
      "D08",
      "D09",
      "D11",
      "D12",
      "D13",
      "D14",
      "D16",
      "D17",
      "D18",
      "D99",
    ]) {
      expect(codes.has(c as Code)).toBe(true);
    }
    // D10 is disabled by default (week 2 mempool finding); its fixture is covered with it enabled below.
    expect(investigate(latest("CS-1051"), MEMPOOL_ON).code).toBe("D10");
    // D07b is never a verdict on its own fixture; it appears as a finding (see "c." below).
    expect(run(latest("CS-1048")).findings.map((f) => f.code)).toEqual([
      "D07b",
    ]);
  });
});

describe("verdict integrity", () => {
  it.each(SAMPLE_CASES.map((c) => c.id))(
    "%s cites only evidence that exists, and records versions",
    (id) => {
      const v = run(latest(id));
      const ids = new Set(v.evidence.map((e) => e.id));
      for (const e of v.evidenceIds) expect(ids.has(e)).toBe(true);
      expect(v.ruleVersion).toMatch(/^rules-/);
      expect(v.settingsVersion).toBe(SAMPLE_SETTINGS.version);
    },
  );

  it("runs every rule, not just up to the winner", () => {
    expect(run(latest("CS-1055")).checks).toHaveLength(18);
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
    expect(f.ledger.some((r) => r.note?.toLowerCase().includes("ignore"))).toBe(
      true,
    );
    const clean: Facts = {
      ...f,
      ledger: f.ledger.map((r) => ({ ...r, note: undefined })),
    };
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
    expect(
      nextStep("D04", { ...SAMPLE_SETTINGS, keysHeldOnOtherChains: true }),
    ).toMatch(/Ops decides/);
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

const withTransfer = (
  f: Facts,
  patch: Partial<NonNullable<Facts["tx"]>["transfers"][number]>,
): Facts => ({
  ...f,
  tx: {
    ...f.tx!,
    transfers: f.tx!.transfers.map((t, i, all) =>
      i === all.length - 1 ? { ...t, ...patch } : t,
    ),
  },
});

describe("a. D02 only matches a deposit that would otherwise be credited", () => {
  const unconfirmed = (f: Facts): Facts => ({
    ...f,
    currentBlock: f.tx!.blockNumber + 3,
  });

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

describe("b. D05 stands aside only for impersonating USDT/USDC", () => {
  it("a fake USDT to a company address is D06, and D05 records why it stood aside", () => {
    const v = run(latest("CS-1046"));
    expect(v.code).toBe("D06");
    expect(v.checks.find((c) => c.code === "D05")!.reason).toMatch(
      /non-official contract/,
    );
  });

  it("genuine USDT on a chain where the company does not accept it is D05", () => {
    const f = latest("CS-1041");
    const v = investigate(f, {
      ...SAMPLE_SETTINGS,
      acceptedTokens: { ...SAMPLE_SETTINGS.acceptedTokens, tron: [] },
    });
    expect(v.code).toBe("D05");
    expect(v.checks.find((c) => c.code === "D06")!.matched).toBe(false);
  });

  it("USDC with no confirmed official contract and off the allowlist is D05, not D99", () => {
    const noUsdc = {
      ...SAMPLE_SETTINGS,
      officialContracts: {
        ...SAMPLE_SETTINGS.officialContracts,
        ethereum: { USDT: SAMPLE_SETTINGS.officialContracts.ethereum!.USDT },
      },
    };
    expect(
      investigate(
        withTransfer(latest("CS-1045"), { tokenSymbol: "USDC" }),
        noUsdc,
      ).code,
    ).toBe("D05");
  });

  it("with Circle's USDC contract confirmed on Ethereum, a different 'USDC' contract is D06", () => {
    expect(
      run(withTransfer(latest("CS-1045"), { tokenSymbol: "USDC" })).code,
    ).toBe("D06");
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
    expect(v.findings[0]).toMatchObject({
      code: "D07b",
      confidence: "Medium",
      matched: true,
    });
    expect(v.findings[0].evidenceIds).toContain("ev.history");
  });

  it("the D07 rule matches whether or not the look-alike pattern is present", () => {
    const f = latest("CS-1048");
    expect(run(f).checks.find((c) => c.code === "D07")!.matched).toBe(true);
    expect(
      run({ ...f, senderHistory: [] }).checks.find((c) => c.code === "D07")!
        .matched,
    ).toBe(true);
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
    const ledger = run(latest("CS-1056")).evidence.find(
      (e) => e.id === "ev.ledger",
    )!;
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
    const ledger = f.ledger.map((r) =>
      r.depositId === "DEP-55120" ? { ...r, transferIndex: 0 } : r,
    );
    const v = run({ ...f, ledger });
    expect(v.code).toBe("D12");
    expect(v.confidence).toBe("High");
  });

  it("a row for a different token contract does not match", () => {
    const f = latest("CS-1041");
    const ledger = [
      ...f.ledger,
      {
        row: 99,
        depositId: "DEP-X",
        txHash: f.tx!.hash,
        chain: "tron" as const,
        token: "USDC" as const,
        toAddress: f.tx!.transfers[0].to,
        amount: "250.00",
        status: "CREDITED" as const,
        customerId: "C-10422",
      },
    ];
    expect(run({ ...f, ledger }).code).toBe("D12");
  });

  it("no transfer_index with one company transfer in the tx is still exact", () => {
    const f = latest("CS-1053");
    const ledger = f.ledger.map((r) =>
      r.depositId === "DEP-55120" ? { ...r, transferIndex: undefined } : r,
    );
    expect(run({ ...f, ledger }).confidence).toBe("High");
  });

  it("no transfer_index with several company transfers caps D13 at Medium", () => {
    const v = run(latest("CS-1058"));
    expect(v.code).toBe("D13");
    expect(v.confidence).toBe("Medium");
  });

  it("adding the transfer_index restores High", () => {
    const f = latest("CS-1058");
    const ledger = f.ledger.map((r) =>
      r.depositId === "DEP-55161" ? { ...r, transferIndex: 1 } : r,
    );
    expect(run({ ...f, ledger }).confidence).toBe("High");
  });

  it("an address-and-amount-only match caps D12 at Medium", () => {
    const v = run(latest("CS-1059"));
    expect(v.code).toBe("D12");
    expect(v.confidence).toBe("Medium");
  });

  it.each(["HELD", "REJECTED"] as const)(
    "an address-and-amount-only %s row caps at Medium",
    (status) => {
      const f = latest("CS-1059");
      const ledger = f.ledger.map((r) =>
        r.depositId === "DEP-55170" ? { ...r, status } : r,
      );
      const v = run({ ...f, ledger });
      expect(v.code).toBe(status === "HELD" ? "D14" : "D16");
      expect(v.confidence).toBe("Medium");
    },
  );
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
      "Your transfer is on the Tron network and has 8 of 20 confirmations. Once it reaches 20 confirmations it becomes eligible for crediting, usually within about a minute. We'll update you once our checks are complete.",
    );
  });

  it("D10 uses the 22 Oct wording", () => {
    const v = investigate(latest("CS-1051"), MEMPOOL_ON);
    expect(fillReply(v.code, v.fill)).toEqual({
      text: "Your transaction is still waiting to be processed by the Ethereum network. Once the network confirms it, our usual deposit checks apply. If it's still pending after 30 minutes, please let us know.",
      open: [],
    });
  });

  it("D01 names the chains checked", () => {
    const v = run(latest("CS-1055"));
    const r = fillReply(v.code, v.fill)!;
    expect(r.open).toEqual([]);
    expect(r.text).toContain(
      "on Tron, Ethereum, BNB Chain, Polygon, Base, Arbitrum and Optimism.",
    );
  });

  it("D05 fills token and chain, leaves the date to the analyst", () => {
    const v = run(latest("CS-1045"));
    const r = fillReply(v.code, v.fill)!;
    expect(r.text).toContain("We received DAI on Ethereum");
    expect(r.open).toEqual(["date"]);
  });

  it("D11 has its template", () => {
    const v = run(latest("CS-1052"));
    expect(fillReply(v.code, v.fill)!.text).toMatch(
      /^The ID you sent is a withdrawal reference/,
    );
  });

  it("D13 fills amount, token, credit time and where_in_app from settings", () => {
    const v = run(latest("CS-1053"));
    const r = fillReply(v.code, v.fill)!;
    expect(r.text).toBe(
      "Your deposit of 1200.00 USDT was credited on 2026-10-21 11:41 SGT. You can see it under Wallet > Transaction history.",
    );
    expect(r.open).toEqual([]);
  });

  it("D12 reply makes no credit promise and matches the spec", () => {
    const t = REPLY_TEMPLATES.D12!;
    expect(t).not.toMatch(
      /completing the credit|will be credited|will credit/i,
    );
    const v = run(latest("CS-1041"));
    expect(fillReply(v.code, v.fill)).toEqual({
      text: "We can see your transfer arrived on Tron. Our team is checking why it hasn't been credited yet and will update you by {date}.",
      open: ["date"],
    });
  });

  it("D02 no longer says we'll confirm the credit", () => {
    expect(REPLY_TEMPLATES.D02).not.toMatch(
      /confirm when it has been credited/i,
    );
  });

  it("every template is word for word in docs/SPEC.md", () => {
    const spec = readFileSync(
      path.join(__dirname, "..", "docs", "SPEC.md"),
      "utf8",
    ).replace(/\\_/g, "_");
    for (const [code, t] of Object.entries(REPLY_TEMPLATES)) {
      expect(spec, code).toContain(t);
    }
  });

  it("every code with a verdict fixture except D99 has a template", () => {
    for (const code of [
      "D01",
      "D02",
      "D03",
      "D04",
      "D05",
      "D06",
      "D07",
      "D07b",
      "D08",
      "D09",
      "D10",
      "D11",
      "D12",
      "D13",
      "D14",
      "D16",
      "D17",
      "D18",
    ] as Code[]) {
      expect(REPLY_TEMPLATES[code], code).toBeDefined();
    }
  });
});

describe("g. the model holds provider payout events", () => {
  const events: ProviderEvent[] = [
    {
      provider: "SamplePay",
      reference: "PO-881",
      kind: "payout_created",
      providerStatus: "CREATED",
      amount: "1000.00",
      currency: "SGD",
      at: "2026-10-21T10:00:00+08:00",
      fetchedAt: "2026-10-21T15:20:00+08:00",
      rawBody: "{}",
    },
    {
      provider: "SamplePay",
      reference: "PO-881",
      kind: "status_update",
      providerStatus: "COMPLETED",
      at: "2026-10-21T10:05:00+08:00",
      fetchedAt: "2026-10-21T15:20:00+08:00",
      rawBody: "{}",
    },
    {
      provider: "SamplePay",
      reference: "PO-881",
      kind: "returned",
      providerStatus: "RETURNED",
      returnReason: "AC04 closed account",
      at: "2026-10-22T09:00:00+08:00",
      fetchedAt: "2026-10-22T09:05:00+08:00",
      rawBody: "{}",
    },
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

// ---- 22 Oct spec, second pass ----

describe("D17 sent to another customer's address", () => {
  it("is High from File A", () => {
    const v = run(latest("CS-1061"));
    expect(v.code).toBe("D17");
    expect(v.confidence).toBe("High");
  });

  it("D12 requires the destination to belong to this customer", () => {
    const v = run(latest("CS-1061"));
    expect(v.checks.find((c) => c.code === "D12")!.matched).toBe(false);
  });

  it("never reveals the other customer in evidence or reply", () => {
    const v = run(latest("CS-1061"));
    const other = "C-10734";
    expect(JSON.stringify(v.evidence)).not.toContain(other);
    expect(JSON.stringify(v.checks)).not.toContain(other);
    expect(fillReply(v.code, v.fill)!.text).not.toContain(other);
  });

  it("a case with no customer is neither D12 nor D17", () => {
    const v = run({ ...latest("CS-1041"), customerId: undefined });
    expect(["D12", "D17"]).not.toContain(v.code);
  });
});

describe("D18 sent to a retired address", () => {
  it("is High when mined after retired_at", () => {
    const v = run(latest("CS-1062"));
    expect(v.code).toBe("D18");
    expect(v.confidence).toBe("High");
    expect(v.evidence.find((e) => e.id === "ev.address")!.value).toMatch(
      /retired/,
    );
  });

  it("a transfer mined before retired_at is credited as normal", () => {
    const f = latest("CS-1062");
    const v = run({
      ...f,
      tx: { ...f.tx!, blockTime: "2026-09-20T12:00:00+08:00" },
    });
    expect(v.code).toBe("D12");
  });

  it("a retired address reassigned to someone else is D17, not D18", () => {
    const f = latest("CS-1062");
    const old = f.depositAddresses.find((r) => r.retiredAt)!;
    const reassigned = {
      ...old,
      row: 999,
      customerId: "C-99999",
      assignedAt: "2026-10-05T00:00:00+08:00",
      retiredAt: undefined,
    };
    expect(
      run({ ...f, depositAddresses: [...f.depositAddresses, reassigned] }).code,
    ).toBe("D17");
  });

  it("next step uses the retired-address policy setting", () => {
    expect(
      nextStep("D18", {
        ...SAMPLE_SETTINGS,
        retiredAddressPolicy: "Hold and ask ops.",
      }),
    ).toContain("Hold and ask ops.");
  });

  it("D17 and D18 share the neutral address-review reply", () => {
    expect(REPLY_TEMPLATES.D17).toBe(REPLY_TEMPLATES.D18);
    expect(REPLY_TEMPLATES.D17).not.toMatch(/customer|account holder/i);
  });
});

describe("every rule runs; other matches are findings", () => {
  it("evaluates every code from D01 to D18 except out-of-scope D15", () => {
    const codes = new Set(run(latest("CS-1041")).checks.map((c) => c.code));
    for (let i = 1; i <= 18; i++) {
      const code = `D${String(i).padStart(2, "0")}` as Code;
      expect(codes.has(code), code).toBe(i !== 15);
    }
    expect(codes.has("D07b")).toBe(true);
    expect(CATALOGUE_ORDER).toHaveLength(18);
  });

  it("a second High match is attached as a finding, not dropped", () => {
    const f = latest("CS-1046");
    const freezes = [
      {
        chain: "tron" as const,
        token: "USDT" as const,
        address: f.tx!.transfers[0].from,
        role: "sender" as const,
        method: "isBlackListed" as const,
        frozen: true,
        blockNumber: 1,
      },
    ];
    const v = run({ ...f, freezes });
    expect(v.code).toBe("D06");
    expect(v.findings.map((x) => `${x.code}/${x.confidence}`)).toEqual([
      "D09/High",
    ]);
  });
});

// ---- Review findings (spec "Data-quality guards", 22 Oct) ----

describe("a. no rule matches on a missing fact", () => {
  const noHeight = (f: Facts): Facts => ({ ...f, currentBlock: undefined });

  it("unknown current block never gives D02", () => {
    const v = run(noHeight(latest("CS-1042")));
    expect(v.code).not.toBe("D02");
    expect(v.state === "paused" || v.code === "D99").toBe(true);
  });

  it("unknown current block never gives D12", () => {
    const v = run(noHeight(latest("CS-1041")));
    expect(v.code).not.toBe("D12");
    expect(v.state === "paused" || v.code === "D99").toBe(true);
  });

  it("unknown amount never gives D02 or D12", () => {
    for (const id of ["CS-1041", "CS-1042"]) {
      const v = run(withTransfer(latest(id), { amount: "" }));
      expect(["D02", "D12"], id).not.toContain(v.code);
    }
  });
});

describe("b. canonical address comparison per chain", () => {
  const USDT_TRON_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

  it("converts 41-prefixed Tron hex to base58", () => {
    expect(canonicalAddress(USDT_TRON_HEX)).toBe(
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );
    expect(canonicalAddress(`0x${USDT_TRON_HEX}`)).toBe(
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );
  });

  it("lower-cases EVM hex and keeps the 0x prefix", () => {
    expect(canonicalAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7")).toBe(
      "0xdac17f958d2ee523a2206206994597c13d831ec7",
    );
  });

  it.each([USDT_TRON_HEX, `0x${USDT_TRON_HEX}`])(
    "official Tron USDT given as hex %s is not D06",
    (hex) => {
      const v = run(withTransfer(latest("CS-1041"), { tokenContract: hex }));
      expect(v.code).toBe("D12");
      expect(v.checks.find((c) => c.code === "D06")!.matched).toBe(false);
    },
  );

  it("a Tron deposit address given as hex still matches File A", () => {
    const f = latest("CS-1041");
    const to = f.tx!.transfers[0].to;
    expect(run(withTransfer(f, { to: tronToHex(to) })).code).toBe("D12");
  });
});

describe("c. address-and-amount fallback and D13 customer check", () => {
  it("the same amount deposited twice: the earlier credited row is ignored, D12 Medium not D13", () => {
    const f = latest("CS-1059");
    const pending = f.ledger.find((r) => r.depositId === "DEP-55170")!;
    const earlier = {
      ...pending,
      row: 50,
      depositId: "DEP-54001",
      status: "CREDITED" as const,
      creditedAt: "2026-10-10T09:00:00+08:00",
    };
    const v = run({ ...f, ledger: [earlier, ...f.ledger] });
    expect(v.code).toBe("D12");
    expect(v.confidence).toBe("Medium");
  });

  it("the fallback ignores another customer's row", () => {
    const f = latest("CS-1059");
    const ledger = f.ledger.map((r) =>
      r.depositId === "DEP-55170"
        ? { ...r, status: "CREDITED" as const, customerId: "C-99999" }
        : r,
    );
    expect(run({ ...f, ledger }).code).not.toBe("D13");
  });

  it("D13 requires the ledger row's customer to be this case's customer", () => {
    const f = latest("CS-1053");
    const ledger = f.ledger.map((r) =>
      r.depositId === "DEP-55120" ? { ...r, customerId: "C-99999" } : r,
    );
    expect(run({ ...f, ledger }).code).not.toBe("D13");
  });
});

describe("d. a non-decimal chain amount is an unknown fact, not a crash", () => {
  it.each(["1e3", "12,5", "-3", "NaN"])(
    "amount %s does not throw and decides nothing about the amount",
    (amount) => {
      const f = withTransfer(latest("CS-1041"), { amount });
      expect(() => run(f)).not.toThrow();
      const v = run(f);
      expect(["D02", "D08", "D12"]).not.toContain(v.code);
      expect(v.evidence.find((e) => e.id === "ev.amount")?.value).toMatch(
        /unknown/i,
      );
    },
  );

  it("a non-decimal dust amount in sender history does not throw", () => {
    const f = latest("CS-1048");
    const senderHistory = f.senderHistory.map((p) => ({
      ...p,
      amount: "1e-18",
    }));
    expect(() => run({ ...f, senderHistory })).not.toThrow();
  });
});

describe("D10 disabled by default (week 2 mempool finding)", () => {
  it("a known pending transaction needs review when reliable timing is unavailable", () => {
    const v = run(latest("CS-1051"));
    expect(v.code).toBe("D99");
    expect(v.checks.find((c) => c.code === "D10")!.reason).toMatch(/Disabled/);
    expect(v.evidence.find((e) => e.id === "ev.lookup")!.value).toMatch(
      /pending on Ethereum/,
    );
    expect(fillReply(v.code, v.fill)).toBeNull();
  });

  it("with mempool checks enabled, D10 applies and D01 stands aside", () => {
    const v = investigate(latest("CS-1051"), MEMPOOL_ON);
    expect(v.code).toBe("D10");
    expect(v.checks.find((c) => c.code === "D01")!.matched).toBe(false);
  });

  it("D01 still never fires when a chain lookup failed", () => {
    expect(run(withChainDown(latest("CS-1051"), "bsc")).state).toBe("paused");
  });
});

describe("D99 sample: mined before the address was assigned", () => {
  it("ownership at block time is unknown, so no address verdict is guessed", () => {
    const v = run(latest("CS-1060"));
    expect(v.code).toBe("D99");
    expect(v.evidence.find((e) => e.id === "ev.address")!.status).toBe("warn");
  });
});

it("cannot declare absent everywhere after only one chain answered", () => {
  const f = structuredClone(latest("CS-1055"));
  f.lookups = f.lookups.slice(0, 1);
  expect(run(f).code).toBe("D99");
});
