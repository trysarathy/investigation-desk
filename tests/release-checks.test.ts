// S1 "release checks": the paid wording says only what was actually checked (Aashmiin, 2 Nov 2026).
// Five checks: finality, token contract, amount, sender vs the OFAC SDN digital-currency addresses,
// issuer freeze (sender AND receiving address). A check that couldn't run says "NOT checked"; a failed
// one is a problem headline; the word "safe" never appears. Sources and limits:
// team/knowledge/crypto-protocol-engineer/sanctions-freeze-sources.md.

import { describe, expect, it } from "vitest";
import { OFFICIAL_USDC, OFFICIAL_USDT } from "@/lib/requests/check";
import {
  amountCheck, finalityCheck, releaseHeadline, tokenCheck,
  type CheckState, type FinalityCheck, type FreezeCheck, type ReleaseChecks, type SanctionsCheck,
} from "@/lib/requests/release-checks";
import { parseSanctionsSnapshot, screenSender, type SanctionsSnapshot } from "@/lib/requests/sanctions";

const T = "2026-11-02T03:00:00.000Z";
const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/**
 * TEST-ONLY snapshot. These are NOT OFAC entries: the addresses are synthetic (repeated digits / a
 * made-up base58 string), chosen so no real person is named. The real snapshot is recorded from
 * sanctionslist.ofac.treas.gov only (see the pack file); none is shipped while that host is blocked.
 */
const TEST_SNAPSHOT: SanctionsSnapshot = {
  list: "OFAC SDN",
  source: { url: "test://not-a-real-list", fetchedAt: "2026-11-01T00:00:00.000Z", listPublishDate: "2026-10-31", sha256: "0".repeat(64) },
  entries: [
    { idType: "Digital Currency Address - ETH", address: "0x1111111111111111111111111111111111111111" },
    { idType: "Digital Currency Address - TRX", address: "TTestTestTestTestTestTestTestTestT" },
  ],
};

const fin = (s: "passed" | "pending" | "not_run" | "failed"): FinalityCheck =>
  s === "passed" ? finalityCheck({ chain: "ethereum", blockNumber: 100, finalizedBlock: 120, checkedAt: T })
  : s === "pending" ? finalityCheck({ chain: "ethereum", blockNumber: 100, finalizedBlock: 90, checkedAt: T, eta: "Confirming (5 of 12 at the last check): Ethereum usually takes about 2 minutes; look the payment up again to update it." })
  : s === "not_run" ? finalityCheck({ chain: "ethereum", blockNumber: 100, checkedAt: T })
  : { state: "failed", detail: "The payment is no longer in the chain's history." };
const sanctions = (s: CheckState): SanctionsCheck =>
  s === "passed" ? screenSender(TEST_SNAPSHOT, "ethereum", "0x2222222222222222222222222222222222222222", T)
  : s === "failed" ? screenSender(TEST_SNAPSHOT, "ethereum", "0x1111111111111111111111111111111111111111", T)
  : screenSender(undefined, "ethereum", "0x2222222222222222222222222222222222222222", T);
const freeze = (s: CheckState): FreezeCheck =>
  s === "passed" ? { state: "passed", issuer: "Circle", detail: "Neither the sender nor the receiving address is frozen by Circle (checked 2 Nov 2026, 11:00 SGT).", checkedAt: T }
  : s === "failed" ? { state: "failed", issuer: "Circle", detail: "Sender frozen by Circle.", checkedAt: T }
  : { state: "not_run", issuer: "Circle", detail: "Circle's contract didn't answer, so freeze status is unknown." };
const token = (s: CheckState) =>
  s === "passed" ? tokenCheck({ chain: "ethereum", token: "USDC", contract: OFFICIAL_USDC.toUpperCase().replace("0X", "0x") })
  : s === "failed" ? tokenCheck({ chain: "ethereum", token: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb49" })
  : tokenCheck({ chain: "polygon", token: "USDC", contract: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" });
const amount = (s: CheckState) =>
  s === "passed" ? amountCheck({ expected: "1250", received: "1250.000000", token: "USDC" })
  : s === "failed" ? amountCheck({ expected: "1250", received: "1200", token: "USDC" })
  : amountCheck({ expected: "1250", received: "", token: "USDC" });

const all = (o: Partial<Record<keyof ReleaseChecks, string>> = {}): ReleaseChecks => ({
  finality: fin((o.finality ?? "passed") as never), token: token((o.token ?? "passed") as CheckState),
  amount: amount((o.amount ?? "passed") as CheckState), sanctions: sanctions((o.sanctions ?? "passed") as CheckState),
  freeze: freeze((o.freeze ?? "passed") as CheckState),
});

describe("releaseHeadline: words only for checks that passed", () => {
  it("all five passed", () => {
    const h = releaseHeadline(all());
    expect(h.tone).toBe("paid");
    expect(h.allChecked).toBe(true);
    expect(h.headline).toBe("Paid and final. Right token and amount. Sender not on public sanctions lists. Not frozen.");
    // The scope of "public sanctions lists" is always spelled out underneath.
    expect(h.lines.join(" ")).toMatch(/OFAC SDN list only, dated 2026-10-31/);
    expect(h.lines.join(" ")).toMatch(/UN, EU, UK, Singapore \(MAS\)/);
  });

  it("sanctions couldn't run (no list snapshot) → \"Sender NOT checked.\"", () => {
    const h = releaseHeadline(all({ sanctions: "not_run" }));
    expect(h.headline).toBe("Paid and final. Right token and amount. Sender NOT checked. Not frozen.");
    expect(h.allChecked).toBe(false);
    expect(h.headline).not.toMatch(/sanctions lists/);
  });

  it("freeze couldn't run (call failed) → \"Freeze status NOT checked.\"", () => {
    const h = releaseHeadline(all({ freeze: "not_run" }));
    expect(h.headline).toBe("Paid and final. Right token and amount. Sender not on public sanctions lists. Freeze status NOT checked.");
    expect(h.headline).not.toMatch(/Not frozen/);
  });

  it("sanctioned sender → problem, says what failed", () => {
    const h = releaseHeadline(all({ sanctions: "failed" }));
    expect(h.tone).toBe("problem");
    expect(h.headline).toMatch(/^Don't release: Sender is on the US OFAC sanctions list \(SDN, dated 2026-10-31\)/);
    expect(h.headline).not.toMatch(/Paid and final/);
  });

  it("frozen sender → problem", () => {
    const h = releaseHeadline(all({ freeze: "failed" }));
    expect(h).toMatchObject({ tone: "problem", headline: "Don't release: Sender frozen by Circle." });
  });

  it("look-alike token contract → problem (one hex digit off the real USDC contract)", () => {
    const h = releaseHeadline(all({ token: "failed" }));
    expect(h.tone).toBe("problem");
    expect(h.headline).toBe("Don't release: Wrong token: this is not Circle's USDC contract on Ethereum, it's a look-alike.");
  });

  it("short amount → problem", () => {
    const h = releaseHeadline(all({ amount: "failed" }));
    expect(h).toMatchObject({ tone: "problem", headline: "Don't release: Short by 50 USDC (received 1200, asked 1250)." });
  });

  it("not final yet → \"Not final yet.\" with the 6a status sentence, no other claim", () => {
    const h = releaseHeadline(all({ finality: "pending" }));
    expect(h.tone).toBe("not_yet");
    expect(h.headline).toBe("Not final yet.");
    expect(h.lines[0]).toMatch(/^Confirming \(5 of 12 at the last check\)/);
  });

  it("finality couldn't be read → not yet, \"Finality NOT checked.\"", () => {
    const h = releaseHeadline(all({ finality: "not_run" }));
    expect(h).toMatchObject({ tone: "not_yet", headline: "Finality NOT checked." });
  });

  it("several failures are all named", () => {
    const h = releaseHeadline(all({ amount: "failed", freeze: "failed" }));
    expect(h.headline).toBe("Don't release: Short by 50 USDC (received 1200, asked 1250). Sender frozen by Circle.");
  });

  it("never the word \"safe\", in any combination of results (and even if a caller's line contains it)", () => {
    const S: CheckState[] = ["passed", "failed", "not_run"];
    let n = 0;
    for (const f of ["passed", "pending", "not_run", "failed"]) for (const t of S) for (const a of S) for (const s of S) for (const z of S) {
      const h = releaseHeadline(all({ finality: f, token: t, amount: a, sanctions: s, freeze: z }));
      expect(`${h.headline} ${h.lines.join(" ")}`).not.toMatch(/safe/i);
      n++;
    }
    expect(n).toBe(324);
    const sneaky = releaseHeadline({ ...all({ finality: "pending" }), finality: { ...fin("pending"), eta: "Safe to release soon" } });
    expect(`${sneaky.headline} ${sneaky.lines.join(" ")}`).not.toMatch(/safe/i);
  });
});

describe("the five checks", () => {
  it("finality: block at or below the finalized/solidified head passes; above it is pending; no head read is not_run", () => {
    expect(finalityCheck({ chain: "tron", blockNumber: 50, finalizedBlock: 50, checkedAt: T }).state).toBe("passed");
    expect(finalityCheck({ chain: "tron", blockNumber: 51, finalizedBlock: 50, checkedAt: T }).state).toBe("pending");
    expect(finalityCheck({ chain: "tron", checkedAt: T }).state).toBe("pending");
    expect(finalityCheck({ chain: "ethereum", blockNumber: 51, checkedAt: T }).state).toBe("not_run");
  });

  it("token: issuer contract per chain, EVM case-insensitive; Tron exact; no issuer contract on record → not_run", () => {
    expect(tokenCheck({ chain: "ethereum", token: "USDT", contract: OFFICIAL_USDT.toUpperCase().replace("0X", "0x") }).state).toBe("passed");
    expect(tokenCheck({ chain: "tron", token: "USDT", contract: TRON_USDT }).state).toBe("passed");
    expect(tokenCheck({ chain: "tron", token: "USDT", contract: TRON_USDT.toLowerCase() }).state).toBe("failed");
    expect(tokenCheck({ chain: "ethereum", token: "USDT", contract: OFFICIAL_USDC }).state).toBe("failed");
    expect(tokenCheck({ chain: "bsc", token: "USDT", contract: "0x55d398326f99059ff775485246999027b3197955" }).state).toBe("not_run");
  });

  it("amount: exact decimal, overpaid is not \"right amount\" either; unparseable → not_run", () => {
    expect(amountCheck({ expected: "1250", received: "1250.5", token: "USDT" })).toMatchObject({ state: "failed", detail: "Overpaid by 0.5 USDT (received 1250.5, asked 1250)." });
    expect(amountCheck({ expected: "0.1", received: "0.10", token: "USDT" }).state).toBe("passed");
    expect(amountCheck({ expected: "1250", received: "1e3", token: "USDT" }).state).toBe("not_run");
  });
});

describe("sanctions: offline against a recorded OFAC SDN snapshot", () => {
  it("no snapshot shipped → not_run, never passed", () => {
    const c = screenSender(undefined, "ethereum", "0x2222222222222222222222222222222222222222", T);
    expect(c).toMatchObject({ state: "not_run", list: "OFAC SDN" });
    expect(c.listDate).toBeUndefined();
  });

  it("EVM: checksum-insensitive; matches any EVM-format entry whatever its ID type; Tron: exact base58", () => {
    expect(screenSender(TEST_SNAPSHOT, "ethereum", "0X1111111111111111111111111111111111111111".replace("0X", "0x"), T).state).toBe("failed");
    expect(screenSender(TEST_SNAPSHOT, "bsc", "0x1111111111111111111111111111111111111111", T).state).toBe("failed");
    expect(screenSender(TEST_SNAPSHOT, "tron", "TTestTestTestTestTestTestTestTestT", T).state).toBe("failed");
    expect(screenSender(TEST_SNAPSHOT, "tron", "TtESTtESTtESTtESTtESTtESTtESTtESTt", T).state).toBe("passed");
  });

  it("carries list name, list date and provenance", () => {
    expect(screenSender(TEST_SNAPSHOT, "ethereum", "0x2222222222222222222222222222222222222222", T))
      .toMatchObject({ state: "passed", list: "OFAC SDN", listDate: "2026-10-31", source: "test://not-a-real-list", checkedAt: T });
  });

  it("a stale snapshot (fetched more than 7 days before the check) → not_run", () => {
    expect(screenSender(TEST_SNAPSHOT, "ethereum", "0x2222222222222222222222222222222222222222", "2026-11-09T00:00:01.000Z").state).toBe("not_run");
  });

  it("rejects a snapshot without full provenance, with no entries, or with an unrecognised address", () => {
    expect(parseSanctionsSnapshot(TEST_SNAPSHOT)).toBeDefined();
    expect(parseSanctionsSnapshot({ ...TEST_SNAPSHOT, source: { ...TEST_SNAPSHOT.source, sha256: "abc" } })).toBeUndefined();
    expect(parseSanctionsSnapshot({ ...TEST_SNAPSHOT, source: { ...TEST_SNAPSHOT.source, listPublishDate: "" } })).toBeUndefined();
    expect(parseSanctionsSnapshot({ ...TEST_SNAPSHOT, entries: [] })).toBeUndefined();
    expect(parseSanctionsSnapshot({ ...TEST_SNAPSHOT, entries: [{ idType: "Digital Currency Address - XBT", address: "bc1qnotsupportedhere" }] })).toBeUndefined();
    expect(parseSanctionsSnapshot("nonsense")).toBeUndefined();
  });
});
