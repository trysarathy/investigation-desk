import { describe, expect, it } from "vitest";
import { parseAmount, formatMinor, formatMoney, currencyDecimals, signSandboxWebhook, verifySandboxWebhook, sandboxWebhookSecret } from "@/lib/clearline";
import { addMoney, convertMinor } from "@/lib/clearline/money";
import { hmacSha256Hex, sha256Hex } from "@/lib/clearline/sha256";

describe("money in integer minor units", () => {
  it("parses decimal strings exactly, USDC with 6 decimals", () => {
    expect(parseAmount("50000.00", "SGD")).toEqual({ ok: true, value: 5_000_000 });
    expect(parseAmount("0.1", "SGD")).toEqual({ ok: true, value: 10 });
    expect(parseAmount("6427.83", "USDC")).toEqual({ ok: true, value: 6_427_830_000 });
    expect(currencyDecimals("USDC")).toBe(6);
  });
  it("rejects invalid amounts and currencies", () => {
    for (const bad of ["0", "-1", "1.234", "1e5", "abc", "", "0.00"]) expect(parseAmount(bad, "SGD").ok).toBe(false);
    expect(parseAmount("1.1234567", "USDC").ok).toBe(false);
    expect(parseAmount("1", "XYZ" as never)).toMatchObject({ ok: false, error: { code: "invalid_currency" } });
  });
  it("formats without floating point", () => {
    expect(formatMinor(5_000_000, "SGD")).toBe("SGD 50,000.00");
    expect(formatMoney({ amountMinor: 6_427_830_000, currency: "USDC" })).toBe("USDC 6,427.830000");
    expect(formatMinor(1, "SGD")).toBe("SGD 0.01");
  });
  it("never adds across currencies", () => {
    expect(addMoney({ amountMinor: 1, currency: "SGD" }, { amountMinor: 1, currency: "USD" })).toMatchObject({ ok: false, error: { code: "currency_mismatch" } });
    expect(addMoney({ amountMinor: 1, currency: "SGD" }, { amountMinor: 2, currency: "SGD" })).toEqual({ ok: true, value: { amountMinor: 3, currency: "SGD" } });
  });
  it("converts with BigInt, rounding down, across decimal scales", () => {
    expect(convertMinor(100, "SGD", "PHP", "42.1738")).toBe(4217);
    expect(convertMinor(100, "USDC", "USDC", "1")).toBe(100);
    expect(convertMinor(100, "SGD", "USDC", "0.7448")).toBe(744_800);
  });
});

describe("sandbox webhook signatures", () => {
  it("sha256 and HMAC match published test vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    // RFC 4231 test case 2
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
  it("verifies valid signatures and rejects tampering, malformed headers and stale timestamps", () => {
    const secret = sandboxWebhookSecret("prv_northline");
    const body = '{"id":"E1","type":"payout.completed"}';
    const h = signSandboxWebhook(body, secret, 1_794_500_000);
    expect(verifySandboxWebhook(body, h, secret, 1_794_500_010)).toEqual({ valid: true, timestamp: 1_794_500_000 });
    expect(verifySandboxWebhook(body + " ", h, secret, 1_794_500_010)).toEqual({ valid: false, reason: "signature_mismatch" });
    expect(verifySandboxWebhook(body, h, sandboxWebhookSecret("prv_harbour"), 1_794_500_010).valid).toBe(false);
    expect(verifySandboxWebhook(body, "v1=abc", secret, 1_794_500_010)).toEqual({ valid: false, reason: "malformed_header" });
    expect(verifySandboxWebhook(body, h, secret, 1_794_500_000 + 301)).toEqual({ valid: false, reason: "timestamp_outside_tolerance" });
  });
  it("refuses to sign with non-test secrets", () => {
    expect(() => signSandboxWebhook("{}", "live_secret", 1)).toThrow();
  });
});
