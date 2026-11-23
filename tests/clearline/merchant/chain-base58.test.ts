/** Base58Check for TRON addresses. Fictional addresses only (plus the public USDT contract). No network. */
import { describe, expect, it } from "vitest";
import { base58Decode, base58Encode, base58checkDecode, base58checkEncode, bytesToHex, hexToBytes, isTronAddress, tronBase58ToHex20, tronHexToBase58 } from "@/lib/clearline/merchant/chain";
import { USDT_TRON } from "@/lib/clearline/merchant";
import { guardRealFetch } from "./chain-helpers";

guardRealFetch();

describe("base58check (TRON)", () => {
  it("round-trips a fictional 20-byte address through the 0x41 base58check form", () => {
    const hex20 = "00112233445566778899aabbccddeeff00112233"; // fictional
    const addr = tronHexToBase58(hex20);
    expect(addr).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(tronBase58ToHex20(addr)).toBe(hex20);
    expect(tronHexToBase58("41" + hex20)).toBe(addr);
    expect(tronHexToBase58("0x" + "0".repeat(24) + hex20)).toBe(addr); // ABI-padded topic
    expect(isTronAddress(addr)).toBe(true);
  });

  it("decodes the public USDT contract to its known 0x41 hex form", () => {
    expect(tronBase58ToHex20(USDT_TRON)).toBe("a614f803b6fd780986a42c78ec9c7f77e6ded13c");
    expect(tronHexToBase58("41a614f803b6fd780986a42c78ec9c7f77e6ded13c")).toBe(USDT_TRON);
  });

  it("rejects a bad checksum, a wrong version byte and invalid characters", () => {
    const addr = tronHexToBase58("00112233445566778899aabbccddeeff00112233");
    const last = addr.at(-1)!;
    const tampered = addr.slice(0, -1) + (last === "a" ? "b" : "a");
    expect(() => tronBase58ToHex20(tampered)).toThrow(/checksum/);
    expect(() => tronBase58ToHex20(base58checkEncode(hexToBytes("42" + "11".repeat(20))))).toThrow(/0x41/);
    expect(() => base58Decode("0OIl")).toThrow(/invalid base58/);
    expect(isTronAddress("not-an-address")).toBe(false);
  });

  it("keeps leading zero bytes as leading '1's", () => {
    const b = hexToBytes("0000ff");
    expect(base58Encode(b).startsWith("11")).toBe(true);
    expect(bytesToHex(base58Decode(base58Encode(b)))).toBe("0000ff");
    expect(bytesToHex(base58checkDecode(base58checkEncode(b)))).toBe("0000ff");
  });
});
