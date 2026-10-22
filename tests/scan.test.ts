import { beforeAll, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newScan, runScan, scanSummary } from "../src/lib/scan/run";
import { signalFor } from "../src/lib/scan/history";
import { scanPdf } from "../src/lib/scan/pdf";
beforeAll(() => {
  process.env.DESK_DATA_DIR = mkdtempSync(join(tmpdir(), "scan-test-"));
});
it("outages are unavailable, never zero problem payments", async () => {
  const r = await runScan(
    newScan("Test", [{ chain: "ethereum", address: "0x123" }], 7),
    async () => {
      throw Error("quota");
    },
  );
  expect(r.status).toBe("unavailable");
  expect(scanSummary(r).confirmedProblems).toBeNull();
  expect(r.completedAddresses).toBe(0);
});
it("detects repeated cursors instead of claiming full coverage", async () => {
  const r = await runScan(
    newScan("Test", [{ chain: "tron", address: "T123" }], 7),
    async () => ({ rows: [], next: "same", complete: false }),
  );
  expect(r.errors[0]).toContain("repeated");
  expect(r.completedAddresses).toBe(0);
});
it("never calls a zero transfer poisoning or a BNB contract issuer fake", () => {
  expect(signalFor("bsc", "0xfake", "2")).toBe("none");
  expect(
    signalFor("ethereum", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0.00"),
  ).toBe("zero_value");
});
it("exports a real multi-page PDF with limitations", async () => {
  const r = await runScan(
    newScan(
      "Fictional test",
      [{ chain: "ethereum", address: "Fictional" }],
      7,
      true,
    ),
  );
  const bytes = await scanPdf(r);
  expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  expect(bytes.length).toBeGreaterThan(3000);
});

import { parseBlockscout, claimedSymbol } from "../src/lib/scan/history";
it("recognizes format-character impersonation without trusting a ticker", () => {
  expect(claimedSymbol("US\u034fDC")).toBe("USDC");
  expect(claimedSymbol("US\u200bDC")).toBe("USDC");
});
it("keeps incoming transfer identity and exact amounts from the public fallback", () => {
  const rows = parseBlockscout(
    [
      {
        transaction_hash: "0x" + "a".repeat(64),
        log_index: 3,
        timestamp: "2026-10-20T00:00:00Z",
        from: { hash: "0x" + "1".repeat(40) },
        to: { hash: "0x" + "2".repeat(40) },
        token: {
          symbol: "USDC",
          address_hash: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          decimals: "6",
        },
        total: { value: "123456789012345678901", decimals: "6" },
      },
    ],
    "0x" + "2".repeat(40),
    Date.parse("2026-10-19"),
    Date.parse("2026-10-22"),
    "proof",
  );
  expect(rows[0].amount).toBe("123456789012345.678901");
  expect(rows[0].id).toContain(":3");
  expect(rows[0].signal).toBe("none");
});
