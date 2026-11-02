// S1 "release checks": the paid wording says only what was actually checked (Aashmiin, 2 Nov 2026).
// Five checks: finality, token contract, amount, sender vs the OFAC SDN digital-currency addresses,
// issuer freeze (sender AND receiving address). A check that couldn't run says "NOT checked"; a failed
// one is a problem headline; the word "safe" never appears. Sources and limits:
// team/knowledge/crypto-protocol-engineer/sanctions-freeze-sources.md.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICIAL_USDC, OFFICIAL_USDT } from "@/lib/requests/check";
import {
  amountCheck, finalityCheck, networkCheck, receivingAddressCheck, releaseHeadline, sgtTime, tokenCheck,
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
    expect(h.headline).toBe("Paid and final. Right token and amount. Sender not on the US OFAC SDN list. Not frozen.");
    // The scope (one list, its date, the lists not checked) is always spelled out underneath.
    expect(h.lines.join(" ")).toMatch(/OFAC SDN list only, dated 2026-10-31/);
    expect(h.lines.join(" ")).toMatch(/UN, EU, UK, Singapore \(MAS\)/);
  });

  it("sanctions couldn't run (no list snapshot) → \"Sender NOT checked.\"", () => {
    const h = releaseHeadline(all({ sanctions: "not_run" }));
    expect(h.headline).toBe("Paid and final. Right token and amount. Sender NOT checked. Not frozen.");
    expect(h.allChecked).toBe(false);
    expect(h.headline).not.toMatch(/OFAC|sanctions/);
  });

  it("freeze couldn't run (call failed) → \"Freeze status NOT checked.\"", () => {
    const h = releaseHeadline(all({ freeze: "not_run" }));
    expect(h.headline).toBe("Paid and final. Right token and amount. Sender not on the US OFAC SDN list. Freeze status NOT checked.");
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
    expect(h).toMatchObject({ tone: "problem", headline: "Don't release: Short by 50.00 USDC (received 1,200.00, asked 1,250.00)." });
  });

  it("not final yet → \"Not final yet.\" with the 6a status sentence, no other claim", () => {
    const h = releaseHeadline(all({ finality: "pending" }));
    expect(h.tone).toBe("not_yet");
    expect(h.headline).toBe("Not final yet.");
    // 10 blocks short of final × 12-second slots: the usual pace only, no confirmation counts.
    expect(h.lines[0]).toBe("Not final yet — usually about 2 minutes more.");
  });

  it("finality couldn't be read → not yet, \"Finality NOT checked.\"", () => {
    const h = releaseHeadline(all({ finality: "not_run" }));
    expect(h).toMatchObject({ tone: "not_yet", headline: "Finality NOT checked." });
  });

  it("several failures are all named", () => {
    const h = releaseHeadline(all({ amount: "failed", freeze: "failed" }));
    expect(h.headline).toBe("Don't release: Short by 50.00 USDC (received 1,200.00, asked 1,250.00). Sender frozen by Circle.");
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
    expect(tokenCheck({ chain: "polygon", token: "USDT", contract: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" }).state).toBe("not_run");
  });

  it("amount: exact decimal, overpaid is not \"right amount\" either; unparseable → not_run", () => {
    expect(amountCheck({ expected: "1250", received: "1250.5", token: "USDT" })).toMatchObject({ state: "failed", blocking: false, detail: "Paid 0.50 USDT more than the invoice. Check with finance before refunding." });
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

  it("a snapshot \"fetched\" after the check time (clock skew or a bad file) → not_run", () => {
    expect(screenSender(TEST_SNAPSHOT, "ethereum", "0x2222222222222222222222222222222222222222", "2026-10-31T23:59:59.000Z").state).toBe("not_run");
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

describe("plain English (2 Nov): no jargon in the main lines, numbers in `technical`", () => {
  const JARGON = /confirmations|finali[sz]ed|solidified|block \d|\d{6,}/i;

  it("final: \"Final on Ethereum (can't be reversed).\", block numbers only in technical", () => {
    const c = fin("passed");
    expect(c.detail).toBe("Final on Ethereum (can't be reversed).");
    expect(c.technical).toBe("In block 100; the network had finalized up to block 120.");
    expect(finalityCheck({ chain: "tron", blockNumber: 5, finalizedBlock: 9 }).detail).toBe("Final on Tron (can't be reversed).");
    expect(finalityCheck({ chain: "tron", blockNumber: 10, finalizedBlock: 9 }).detail).toBe("Not final yet — usually about a minute more.");
  });

  it("no jargon in any headline or line, in any combination", () => {
    for (const f of ["passed", "pending", "not_run"]) for (const z of ["passed", "failed", "not_run"] as CheckState[]) for (const a of ["passed", "failed", "not_run"] as CheckState[]) {
      const h = releaseHeadline(all({ finality: f, freeze: z, amount: a }));
      expect(`${h.headline} ${h.lines.join(" ")}`).not.toMatch(JARGON);
    }
  });

  it("recorded time as a human SGT time", () => {
    expect(sgtTime("2026-11-02T06:54:26.025Z")).toBe("2 Nov 2026, 2:54 pm SGT");
    expect(sgtTime("2026-11-01T16:05:00.000Z")).toBe("2 Nov 2026, 12:05 am SGT");
    expect(sgtTime("2026-11-02T04:00:00.000Z")).toBe("2 Nov 2026, 12:00 pm SGT");
  });

  it("overpaid: problem tone (a person decides, POSTING_RULES C5), but not \"Don't release\"", () => {
    const over = amountCheck({ expected: "1250", received: "1255", token: "USDC" });
    const h = releaseHeadline({ ...all(), amount: over });
    expect(h.tone).toBe("problem");
    expect(h.headline).toBe("Paid 5.00 USDC more than the invoice. Check with finance before refunding.");
    expect(h.lines[0]).toBe("Paid and final. Right token. Sender not on the US OFAC SDN list. Not frozen.");
    // A blocking failure still wins, and the overpayment is still named.
    expect(releaseHeadline({ ...all({ freeze: "failed" }), amount: over }).headline)
      .toBe("Don't release: Sender frozen by Circle. Paid 5.00 USDC more than the invoice. Check with finance before refunding.");
  });
});

describe("\"Paid\" only with finality AND token AND amount (code review #65)", () => {
  it("final but token not checked → not_yet, not called paid", () => {
    const h = releaseHeadline(all({ token: "not_run" }));
    expect(h).toMatchObject({ tone: "not_yet", headline: "Final, but not confirmed as paid. Right amount. Token NOT checked. Sender not on the US OFAC SDN list. Not frozen." });
  });
  it("final but amount not checked → not_yet", () => {
    expect(releaseHeadline(all({ amount: "not_run" }))).toMatchObject({ tone: "not_yet", headline: "Final, but not confirmed as paid. Right token. Amount NOT checked. Sender not on the US OFAC SDN list. Not frozen." });
  });
  it("tone 'paid' never comes with a token, amount or finality that didn't pass", () => {
    const S: CheckState[] = ["passed", "failed", "not_run"];
    for (const f of ["passed", "pending", "not_run", "failed"]) for (const t of S) for (const a of S) for (const z of S) {
      const c = all({ finality: f, token: t, amount: a, freeze: z });
      if (releaseHeadline(c).tone === "paid") expect([f, t, a]).toEqual(["passed", "passed", "passed"]);
    }
  });
  it("BNB Chain: the company-declared contract passes as the accepted one; any other contract is a look-alike, not \"not checked\"", () => {
    expect(tokenCheck({ chain: "bsc", token: "USDT", contract: "0x55D398326f99059fF775485246999027B3197955" }))
      .toMatchObject({ state: "passed", detail: "The USDT contract your company accepts on BNB Chain." });
    expect(tokenCheck({ chain: "bsc", token: "USDT", contract: "0x55d398326f99059ff775485246999027b3197956" }))
      .toMatchObject({ state: "failed", detail: "Wrong token: this is not the USDT contract your company accepts on BNB Chain, it's a look-alike." });
  });
});

describe("network and receiving-address slots: failures that block \"Paid and final\"", () => {
  const INVOICE = "0xbaff2f13638c04b10f8119760b2d2ae86b08f8b5";

  it("wrong network", () => {
    const n = networkCheck({ paidOn: "tron", invoiceOn: "ethereum" });
    expect(n).toMatchObject({ state: "failed", detail: "Sent on Tron, not Ethereum, the network on the invoice." });
    expect(networkCheck({ paidOn: "ethereum", invoiceOn: "ethereum" }).state).toBe("passed");
    expect(releaseHeadline({ ...all(), network: n })).toMatchObject({ tone: "problem", headline: "Don't release: Sent on Tron, not Ethereum, the network on the invoice." });
  });

  it("look-alike receiving address, both addresses shortened", () => {
    const a = receivingAddressCheck({ paidTo: "0xbaff2f13638c04b10f8119760b2d2ae86b08f8b6", invoiceAddress: INVOICE });
    expect(a).toMatchObject({ state: "failed", detail: "Sent to a look-alike address (0xbaff…f8b6), not the invoice's address (0xbaff…f8b5)." });
    expect(releaseHeadline({ ...all(), address: a }).headline).toMatch(/^Don't release: Sent to a look-alike address/);
    expect(receivingAddressCheck({ paidTo: INVOICE.toUpperCase().replace("0X", "0x"), invoiceAddress: INVOICE }).state).toBe("passed");
    expect(receivingAddressCheck({ paidTo: "0x1234567890123456789012345678901234567890", invoiceAddress: INVOICE }).detail)
      .toBe("Sent to a different address (0x1234…7890), not the invoice's address (0xbaff…f8b5).");
  });

  it("passed slots add nothing to the headline", () => {
    const ok = { network: networkCheck({ paidOn: "ethereum", invoiceOn: "ethereum" }), address: receivingAddressCheck({ paidTo: INVOICE, invoiceAddress: INVOICE }) };
    expect(releaseHeadline({ ...all(), ...ok }).headline).toBe(releaseHeadline(all()).headline);
  });
});

describe("UI-safe module (code review #65)", () => {
  it("release-headline.ts has no runtime imports (type-only or none), so it can't pull node:crypto into the client", () => {
    const src = readFileSync(path.join(__dirname, "..", "src", "lib", "requests", "release-headline.ts"), "utf8");
    expect(src.split("\n").filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l))).toEqual([]);
    expect(src).not.toMatch(/require\s*\(/);
    expect(src).not.toMatch(/^\s*export\s[^\n]*\sfrom\s/m);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });
});

describe("re-review #65 (2 Nov)", () => {
  it("overpaid with the token NOT checked (BNB USDC, final, 105 vs 100) → not \"Paid and final.\"", () => {
    const token = tokenCheck({ chain: "bsc", token: "USDC", contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" });
    expect(token.state).toBe("not_run");
    const h = releaseHeadline({ ...all(), token, amount: amountCheck({ expected: "100", received: "105", token: "USDC" }) });
    expect(h.tone).toBe("problem");
    expect(h.headline).toBe("Paid 5.00 USDC more than the invoice. Check with finance before refunding.");
    expect(h.lines[0]).toBe("Final, but not confirmed as paid. Token NOT checked. Sender not on the US OFAC SDN list. Not frozen.");
    expect(`${h.headline} ${h.lines.join(" ")}`).not.toMatch(/Paid and final/);
  });

  it("amounts read with thousands separators, every digit kept", () => {
    expect(amountCheck({ expected: "4300", received: "4300.00", token: "USDT" }).detail).toBe("Exactly 4,300.00 USDT.");
    expect(amountCheck({ expected: "1010", received: "1001.25819", token: "USDC" }).detail).toBe("Short by 8.74181 USDC (received 1,001.25819, asked 1,010.00).");
    expect(amountCheck({ expected: "1000", received: "1250.5", token: "USDT" }).detail).toBe("Paid 250.50 USDT more than the invoice. Check with finance before refunding.");
  });
});

describe("QA #65 (2 Nov)", () => {
  it("the headline names only the list that was checked (Aashmiin's rule: wording states only checks that ran)", () => {
    const h = releaseHeadline(all());
    expect(h.headline).toBe("Paid and final. Right token and amount. Sender not on the US OFAC SDN list. Not frozen.");
    expect(h.headline).not.toMatch(/public sanctions lists/);
  });

  it("finality: a block number that isn't a positive safe integer → not_run, and no NaN anywhere", () => {
    for (const b of [NaN, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 2, Infinity]) {
      for (const f of [b, 100]) {
        const c = finalityCheck({ chain: "ethereum", blockNumber: f === b ? b : 100, finalizedBlock: f === b ? 120 : b, checkedAt: T });
        expect(c.state).toBe("not_run");
        const h = releaseHeadline({ ...all(), finality: c });
        expect(`${h.headline} ${h.lines.join(" ")} ${c.technical ?? ""}`).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("sgtTime: an invalid date gives an empty string, never \"NaN\"", () => {
    for (const bad of ["", "not a date", "2026-13-45T99:00:00Z"]) expect(sgtTime(bad)).toBe("");
  });

  // TIPPING-OFF (docs/SPEC.md §2 legal note for D09/D14): these sentences are for the business's own
  // staff only. They must never be put into anything the payer sees (payment page, customer replies).
  it("sanctions and freeze sentences are internal-only: the module says so", () => {
    const src = readFileSync(path.join(__dirname, "..", "src", "lib", "requests", "release-headline.ts"), "utf8");
    expect(src).toMatch(/INTERNAL ONLY[\s\S]*tipping-off[\s\S]*SPEC\.md/);
  });
});
