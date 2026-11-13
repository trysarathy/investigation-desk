/**
 * rc3 Priority A — data exposure (invariant 9). The sample is fictional: no real bank or company names,
 * no IBAN-shaped strings, and every address or transaction hash is a synthetic derivation. The
 * real-bank-name test failed before the sample's statement line ids were renamed (they used "DBS").
 */
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, sampleWorkspace, serializeWorkspace } from "@/lib/clearline";
import { expectedBeneficiaryWallet } from "@/lib/clearline/chain";
import { sha256Hex } from "@/lib/clearline/sha256";

const ws = sampleWorkspace();
const text = serializeWorkspace(ws);

describe("rc3 invariant 9: sample data is fictional", () => {
  it("no real bank, payment-company or stablecoin-issuer names", () => {
    const real = /\b(DBS|POSB|OCBC|UOB|HSBC|Citi(bank)?|JPMorgan|Chase|Standard Chartered|Maybank|Barclays|Wise|Revolut|Stripe|Circle|Tether|Coinbase|Binance|Airwallex|Payoneer|SWIFT)\b/i;
    expect(text.match(real)?.[0] ?? null).toBeNull();
  });
  it("no IBAN-shaped or card-number-shaped strings", () => {
    expect(text.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/)?.[0] ?? null).toBeNull();
    expect(text.match(/\b\d{13,19}\b/)?.[0] ?? null).toBeNull();
  });
  it("every person, organisation, beneficiary, customer and supplier name is marked fictional (or sandbox)", () => {
    const names = [
      ws.organization.name,
      ...ws.actors.map((a) => a.name),
      ...ws.intents.map((i) => i.beneficiaryName),
      ...ws.advances.flatMap((a) => [a.customerName, a.supplierName]),
      ...ws.routes.map((r) => r.providerName),
      ...ws.liquidity.map((l) => l.accountRef + " " + l.source),
      ...ws.statementLines.map((l) => l.accountRef),
    ];
    for (const n of names) expect(n).toMatch(/fictional|sandbox|Synthetic/i);
    expect(ws.organization.fictional).toBe(true);
  });
  it("every 20-byte address is the synthetic token identity or a synthetic beneficiary wallet; every tx hash is synthetic", () => {
    const allowed = new Set([...ALLOWLISTED_TOKENS.map((t) => t.contract), ...ws.intents.map((i) => expectedBeneficiaryWallet(i))]);
    const addresses = new Set(text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? []);
    expect(addresses.size).toBeGreaterThan(0);
    for (const a of addresses) expect(allowed.has(a.toLowerCase())).toBe(true);
    const ppids = ws.instructions.map((i) => i.providerPaymentId).filter(Boolean) as string[];
    const syntheticTx = new Set(ppids.map((p) => "0x" + sha256Hex("synthetic-tx:" + p)));
    for (const o of ws.chainObservations) expect(syntheticTx.has(o.txHash)).toBe(true);
    expect(ALLOWLISTED_TOKENS[0].label).toMatch(/not the issuer's official contract/);
  });
});
