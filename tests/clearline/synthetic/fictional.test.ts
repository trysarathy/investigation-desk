import { beforeAll, describe, expect, it } from "vitest";
import { ALLOWED_REAL_CONTRACTS, SYNTHETIC_LABEL, eip55Valid, monthPreset, tronChecksumValid, type Preset } from "@/lib/clearline/synthetic";
import { textsOf } from "./helpers";

// Well-known real contracts that must never appear (besides the three allowed ones).
const REAL_DENYLIST = [
  "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", // USDC (TRON)
  "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC (Polygon)
  "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT (Polygon)
  "0x4Fabb145d64652a948d72533023f6E7A623C7C53", // BUSD
];
const B58 = "1-9A-HJ-NP-Za-km-z";
const TRON_RE = new RegExp(`(?<![${B58}])T[${B58}]{33}(?![${B58}])`, "g");
const ETH_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

let p: Preset;
let all: { name: string; body: string }[];
beforeAll(async () => {
  p = await monthPreset();
  all = p.files.flatMap((f) => textsOf(f).map((body) => ({ name: f.name, body })));
}, 60_000);

describe("synthetic month preset: fictional-only guard", () => {
  it("every generated address fails its chain's checksum (so it can never be a real one)", () => {
    for (const a of p.world.generated.addresses) {
      if (a.startsWith("T")) expect(tronChecksumValid(a), a).toBe(false);
      else {
        expect(eip55Valid(a), a).toBe(false);
        expect(a.slice(2)).not.toBe(a.slice(2).toLowerCase()); // mixed case: carries a (wrong) checksum
      }
    }
    for (const c of ALLOWED_REAL_CONTRACTS) expect(c.startsWith("T") ? tronChecksumValid(c) : eip55Valid(c), c).toBe(true);
  });

  it("every address-like string in every file is an allowed contract or a generated fictional address", () => {
    const generated = new Set(p.world.generated.addresses);
    const allowed = new Set(ALLOWED_REAL_CONTRACTS);
    let seen = 0;
    for (const { name, body } of all) {
      for (const m of [...body.matchAll(TRON_RE), ...body.matchAll(ETH_RE)]) {
        seen++;
        const v = m[0];
        if (allowed.has(v)) continue;
        expect(generated.has(v), `${name}: ${v}`).toBe(true);
        expect(v.startsWith("T") ? tronChecksumValid(v) : eip55Valid(v), `${name}: ${v} passes a real checksum`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(5_000);
  });

  it("no well-known real contract other than the three allowed ones appears", () => {
    for (const { name, body } of all) for (const c of REAL_DENYLIST) expect(body.toLowerCase().includes(c.toLowerCase()), `${name} contains ${c}`).toBe(false);
  });

  it("emails use a reserved, non-deliverable domain; nothing looks like an IBAN", () => {
    let emails = 0;
    for (const { name, body } of all) {
      for (const m of body.matchAll(EMAIL_RE)) { emails++; expect(m[0], name).toMatch(/@example\.test$/); }
      expect([...body.matchAll(IBAN_RE)].map((m) => m[0]), name).toEqual([]);
    }
    expect(emails).toBeGreaterThan(0);
  });

  it("every file name carries the label, and so does the content where the format allows", () => {
    for (const f of p.files) {
      expect(f.name).toContain(SYNTHETIC_LABEL);
      const body = textsOf(f).join("\n");
      if (f.name.endsWith(".json")) expect(JSON.parse(body)._note).toBe(SYNTHETIC_LABEL);
      if (f.name.endsWith(".xml")) expect(body).toContain(`<AddtlStmtInf>${SYNTHETIC_LABEL}</AddtlStmtInf>`);
      if (f.name.endsWith(".sta")) expect(body.split("\r\n").find((l) => l.startsWith(":86:"))).toBe(`:86:${SYNTHETIC_LABEL}`);
      if (f.name.endsWith(".xlsx")) expect(body).toContain(SYNTHETIC_LABEL);
    }
  });

  it("names of entities, banks and customers are marked fictional", () => {
    for (const e of p.world.entities) expect(e.name).toMatch(/\(fictional\)/);
    for (const a of p.world.bankAccounts) expect(a.bankName).toMatch(/\(fictional\)/);
    for (const c of p.world.customers) expect(c.name).toMatch(/^Fictional Customer \d{4}$/);
  });
});
