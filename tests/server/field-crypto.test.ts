/**
 * v1 Phase 5.3: field encryption without a database — the KMS stand-in and the hosted adapter shape, the envelope
 * cipher (AAD binding, versions, blind indexes), sealing/opening rows, and that no error ever carries a value.
 * Fictional addresses and keys only.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { HostedKmsAdapter, KmsError, LocalKms, kmsFromEnv, parseKmsKeys, type HostedKmsClient } from "../../src/server/crypto/kms";
import { FieldCryptoError, OrgCipher, SEALED, sealedVersion } from "../../src/server/crypto/envelope";
import { ENCRYPTED_TABLES, jsonbOrdered, openOne, sealOne, type EncryptedTable } from "../../src/server/crypto/fields";
import { encryptionRequired } from "../../src/server/crypto/org-keys";

const ORG = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ADDR = "0xF1C71000000000000000000000000000000FACE1"; // fictional
const key = () => randomBytes(32);
const cipher = (org = ORG, keys = new Map([[1, key()]]), active = 1, index = key()) => new OrgCipher(org, keys, active, index);

function messages(fn: () => unknown): string {
  try { fn(); } catch (e) { return `${(e as Error).message}\n${(e as Error).stack ?? ""}`; }
  throw new Error("expected an error");
}

describe("KMS", () => {
  it("parses CLEARLINE_KMS_KEYS (first is active) and refuses malformed keys without echoing them", () => {
    const a = randomBytes(32).toString("base64"), b = randomBytes(32).toString("base64");
    const ks = parseKmsKeys(`k2:${a}, k1:${b}`)!;
    expect(ks.map(([id]) => id)).toEqual(["k2", "k1"]);
    expect(parseKmsKeys(undefined)).toBeNull();
    expect(parseKmsKeys("  ")).toBeNull();
    const bad = "k1:c2hvcnQ=";
    expect(() => parseKmsKeys(bad)).toThrow(KmsError);
    expect(messages(() => parseKmsKeys(bad))).not.toContain("c2hvcnQ");
    expect(() => parseKmsKeys(`k1:${a},k1:${b}`)).toThrow(/twice/);
    expect(() => parseKmsKeys(`bad id:${a}`)).toThrow(KmsError);
    expect(kmsFromEnv({ CLEARLINE_KMS_KEYS: `k1:${a}` })?.activeKekId()).toBe("k1");
    expect(kmsFromEnv({})).toBeNull();
  });

  it("LocalKms wraps under the active master key, unwraps under any configured one, and binds the context", async () => {
    const k1 = key(), k2 = key();
    const old = new LocalKms([["k1", k1]]);
    const dk = key();
    const w = await old.wrap(dk, "org:a|purpose:data|v:1");
    expect(w.kekId).toBe("k1");
    expect(w.wrapped).not.toContain(dk.toString("base64url"));
    expect(await old.unwrap(w, "org:a|purpose:data|v:1")).toEqual(dk);
    await expect(old.unwrap(w, "org:b|purpose:data|v:1")).rejects.toThrow(KmsError);
    const both = new LocalKms([["k2", k2], ["k1", k1]]);
    expect(both.activeKekId()).toBe("k2");
    expect(await both.unwrap(w, "org:a|purpose:data|v:1")).toEqual(dk);
    const w2 = await both.wrap(dk, "ctx");
    expect(w2.kekId).toBe("k2");
    await expect(old.unwrap(w2, "ctx")).rejects.toThrow(/k2 is not configured/);
    expect(new LocalKms([["k2", k2]]).canUnwrap("k1")).toBe(false);
  });

  it("the hosted adapter passes the context as the encryption context and maps errors to KmsError", async () => {
    const calls: Record<string, string>[] = [];
    const store = new LocalKms([["hosted-1", key()]]);
    const client: HostedKmsClient = {
      async encrypt({ plaintext, encryptionContext }) { calls.push(encryptionContext); const w = await store.wrap(Buffer.from(plaintext), encryptionContext.clearline); return { ciphertext: Buffer.from(w.wrapped) }; },
      async decrypt({ ciphertext, encryptionContext }) { calls.push(encryptionContext); return { plaintext: await store.unwrap({ kekId: "hosted-1", wrapped: Buffer.from(ciphertext).toString() }, encryptionContext.clearline) }; },
    };
    const kms = new HostedKmsAdapter("hosted-test", client, ["hosted-1"]);
    const dk = key();
    const w = await kms.wrap(dk, "org:x|purpose:index|v:1");
    expect(w.wrapped.startsWith("hk1.")).toBe(true);
    expect(await kms.unwrap(w, "org:x|purpose:index|v:1")).toEqual(dk);
    expect(calls).toEqual([{ clearline: "org:x|purpose:index|v:1" }, { clearline: "org:x|purpose:index|v:1" }]);
    await expect(kms.unwrap(w, "org:y|purpose:index|v:1")).rejects.toThrow(KmsError);
    await expect(kms.unwrap({ ...w, kekId: "hosted-0" }, "x")).rejects.toThrow(/not configured/);
  });
});

describe("envelope cipher", () => {
  it("seals with AES-256-GCM under the active version and opens only with the same org, table, column and row", () => {
    const dk = key();
    const c = cipher(ORG, new Map([[1, dk]]));
    const s = c.seal("merchant_quotes", "deposit_address", "Q-1", ADDR);
    expect(s).toMatch(SEALED);
    expect(sealedVersion(s)).toBe(1);
    expect(s).not.toContain(ADDR);
    expect(c.seal("merchant_quotes", "deposit_address", "Q-1", ADDR)).not.toBe(s); // random IV
    expect(c.open("merchant_quotes", "deposit_address", "Q-1", s)).toBe(ADDR);
    for (const [tb, col, row] of [["merchant_quotes", "deposit_address", "Q-2"], ["payment_links", "deposit_address", "Q-1"], ["merchant_quotes", "other", "Q-1"]]) {
      expect(() => c.open(tb, col, row, s)).toThrow(FieldCryptoError);
    }
    expect(() => cipher(OTHER, new Map([[1, dk]])).open("merchant_quotes", "deposit_address", "Q-1", s)).toThrow(FieldCryptoError); // same key, another organisation
    const tampered = s.slice(0, -2) + (s.endsWith("A") ? "BB" : "AA");
    expect(() => c.open("merchant_quotes", "deposit_address", "Q-1", tampered)).toThrow(FieldCryptoError);
  });

  it("opens values of a retired version and seals new ones with the active version", () => {
    const k1 = key(), k2 = key(), idx = key();
    const v1 = cipher(ORG, new Map([[1, k1]]), 1, idx);
    const old = v1.seal("t", "c", "r", ADDR);
    const v2 = cipher(ORG, new Map([[1, k1], [2, k2]]), 2, idx);
    expect(v2.open("t", "c", "r", old)).toBe(ADDR);
    expect(sealedVersion(v2.seal("t", "c", "r", ADDR))).toBe(2);
    expect(() => cipher(ORG, new Map([[2, k2]]), 2, idx).open("t", "c", "r", old)).toThrow(/version .* not available/);
    expect(v1.blindIndex("address", ADDR)).toBe(v2.blindIndex("address", ADDR)); // the index key is not rotated with data keys
  });

  it("blind index: exact-value equality per organisation and domain, nothing normalised", () => {
    const c = cipher();
    const b = c.blindIndex("address", ADDR);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(c.blindIndex("address", ADDR)).toBe(b);
    expect(c.blindIndex("address", ADDR.toLowerCase())).not.toBe(b); // exactly what plaintext equality did
    expect(c.blindIndex("order_ref", ADDR)).not.toBe(b);
    expect(cipher().blindIndex("address", ADDR)).not.toBe(b); // another organisation's index key
  });

  it("errors name the table and column only (never the value or the sealed text)", () => {
    const c = cipher();
    const s = c.seal("chain_transfers", "to_address", "row", ADDR);
    const text = messages(() => c.open("chain_transfers", "to_address", "other-row", s));
    expect(text).toContain("chain_transfers.to_address");
    expect(text).not.toContain(ADDR);
    expect(text).not.toContain(s.split(".")[2].slice(0, 16));
  });
});

describe("sealing and opening rows", () => {
  const spec = (n: keyof typeof ENCRYPTED_TABLES) => ENCRYPTED_TABLES[n] as EncryptedTable;

  it("a chain transfer: both addresses and the earlier hops sealed, indexes for the addresses, opened back exactly", () => {
    const c = cipher();
    const hops = [{ txHash: "0xh1", to: ADDR, from: "0xF1C7200000000000000000000000000000000002" }];
    const row = { orgId: ORG, network: "ethereum", txHash: "0xabc", logIndex: 3, source: "chain_client", fromAddress: "0xF1C7300000000000000000000000000000000003", toAddress: ADDR, priorHops: hops };
    const s = sealOne(c, spec("chain_transfers"), row);
    expect(s.toAddressBidx).toBe(c.blindIndex("address", ADDR));
    expect(String(s.toAddressEnc)).not.toContain(ADDR);
    expect(s.priorHopsEnc).toMatch(SEALED);
    const stored = { ...s, priorHops: jsonbOrdered(hops) }; // jsonb's key order, as PostgreSQL returns it
    const o = openOne(c, spec("chain_transfers"), stored);
    expect(o.toAddress).toBe(ADDR);
    expect(o.priorHops).toEqual(jsonbOrdered(hops));
    expect(JSON.stringify(o.priorHops)).toBe(JSON.stringify(jsonbOrdered(hops)));
    // contract phase: no plaintext columns, values come from the sealed copies alone
    const sealedOnly = { ...s, fromAddress: null, toAddress: null, priorHops: null };
    expect(openOne(c, spec("chain_transfers"), sealedOnly).toAddress).toBe(ADDR);
  });

  it("refuses a row whose plaintext copy and sealed copy disagree, without printing either", () => {
    const c = cipher();
    const s = sealOne(c, spec("merchant_quotes"), { quoteId: "Q-9", depositAddress: ADDR });
    const other = "TFict0000000000000000000000000000Z";
    const text = messages(() => openOne(c, spec("merchant_quotes"), { ...s, depositAddress: other }));
    expect(text).toMatch(/does not agree/);
    expect(text).not.toContain(ADDR);
    expect(text).not.toContain(other);
  });

  it("an address fact's sealed address is bound to its blind index; null values stay null; no KMS → refused", () => {
    const c = cipher();
    const s = sealOne(c, spec("address_facts"), { network: "tron", address: ADDR, fact: "registered_wallet" });
    expect(openOne(c, spec("address_facts"), s).address).toBe(ADDR);
    expect(() => openOne(c, spec("address_facts"), { ...s, addressBidx: c.blindIndex("address", "x") })).toThrow(FieldCryptoError);
    const l = sealOne(c, spec("ledger_invoices"), { entityId: "E1", invoiceNumber: "INV-1", orderRef: null, contact: "Fictional Buyer Pte" });
    expect([l.orderRefEnc, l.orderRefBidx]).toEqual([null, null]);
    expect(openOne(c, spec("ledger_invoices"), l).contact).toBe("Fictional Buyer Pte");
    expect(() => openOne(null, spec("ledger_invoices"), l)).toThrow(/no KMS is configured/);
    expect(openOne(null, spec("ledger_invoices"), { entityId: "E1", invoiceNumber: "INV-1", orderRef: "ORD-1", orderRefEnc: null, contactEnc: null }).orderRef).toBe("ORD-1");
  });

  it("jsonb order: shorter keys first, then bytewise", () => {
    expect(Object.keys(jsonbOrdered({ txHash: 1, to: 2, from: 3, b: 4 }) as object)).toEqual(["b", "to", "from", "txHash"]);
  });

  it("staging and production require encryption; local, ci and demo do not", () => {
    expect(encryptionRequired({ CLEARLINE_DEPLOY_ENV: "production" })).toBe(true);
    expect(encryptionRequired({ CLEARLINE_DEPLOY_ENV: "staging" })).toBe(true);
    for (const e of ["local", "ci", "demo", undefined]) expect(encryptionRequired({ CLEARLINE_DEPLOY_ENV: e })).toBe(false);
  });
});
