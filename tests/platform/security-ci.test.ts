/**
 * v1 E1 (phase 5.1): the CI security gates. The dependency gate (scripts/security/audit-gate.mjs) against synthetic
 * npm audit reports, and the secret scanner (scripts/security/secret-scan.mjs) against synthetic tokens. Every
 * token below is assembled at run time from fragments, so this file never contains a token-shaped literal itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error plain ESM without type declarations
import { advisories, evaluate, MAX_ACCEPT_DAYS, parseAllowlist as parseAuditAllowlist, render } from "../../scripts/security/audit-gate.mjs";
// @ts-expect-error plain ESM without type declarations
import { addedLines, applyAllowlist, entropy, fingerprint, parseAllowlist, scanText, scanTree } from "../../scripts/security/secret-scan.mjs";

const ROOT = path.resolve(__dirname, "../..");
type Finding = { path: string; line: number; rule: string; fingerprint: string };

// ---- dependency audit gate ------------------------------------------------------------------------------------------
const via = (id: string, severity: string, name: string) => ({ source: 1, name, title: `fictional advisory ${id}`, url: `https://github.com/advisories/${id}`, severity, range: "<9" });
const report = (...vs: { name: string; severity: string; via: unknown[] }[]) => ({ auditReportVersion: 2, vulnerabilities: Object.fromEntries(vs.map((v) => [v.name, v])), metadata: {} });
const HIGH = "GHSA-aaaa-bbbb-cccc", MOD = "GHSA-dddd-eeee-ffff", CRIT = "GHSA-gggg-hhhh-jjjj";
const entry = (id: string, expires: string) => ({ id, owner: "devops-engineer", reason: "fictional reason long enough to count", expires });

describe("dependency audit gate (threshold: high)", () => {
  const r = report(
    { name: "alpha", severity: "high", via: [via(HIGH, "high", "alpha")] },
    { name: "beta", severity: "moderate", via: [via(MOD, "moderate", "beta"), "alpha"] },
    { name: "gamma", severity: "critical", via: [via(CRIT, "critical", "gamma")] },
  );
  it("collects distinct advisories, most severe first", () => {
    expect(advisories(r).map((a: { id: string }) => a.id)).toEqual([CRIT, HIGH, MOD]);
  });
  it("fails on high and critical, reports moderate", () => {
    const e = evaluate(r, { accepted: [] }, "2026-11-25");
    expect(e.ok).toBe(false);
    expect(e.failures.map((a: { id: string }) => a.id)).toEqual([CRIT, HIGH]);
    expect(e.reported.map((a: { id: string }) => a.id)).toEqual([MOD]);
    expect(render(e)).toMatch(/dependency audit: FAIL/);
  });
  it("passes when every high/critical advisory is accepted and unexpired", () => {
    const e = evaluate(r, { accepted: [entry(HIGH, "2026-12-31"), entry(CRIT, "2027-01-15")] }, "2026-11-25");
    expect(e.ok).toBe(true);
    expect(e.accepted).toHaveLength(2);
  });
  it("an expired acceptance fails, even when the advisory is gone", () => {
    expect(evaluate(r, { accepted: [entry(HIGH, "2026-11-24"), entry(CRIT, "2027-01-15")] }, "2026-11-25").ok).toBe(false);
    const gone = evaluate(report(), { accepted: [entry(HIGH, "2026-11-01")] }, "2026-11-25");
    expect(gone.ok).toBe(false);
    expect(gone.expiredUnused).toEqual([HIGH]);
  });
  it(`an acceptance longer than ${MAX_ACCEPT_DAYS} days fails`, () => {
    expect(evaluate(report(), { accepted: [entry(HIGH, "2027-06-01")] }, "2026-11-25").ok).toBe(false);
  });
  it("refuses an allow-list entry without id, owner, reason or date, and a non-audit input", () => {
    for (const bad of [{ id: "x", owner: "o", reason: "fictional reason long enough", expires: "2026-12-01" }, { ...entry(HIGH, "2026-12-01"), reason: "short" }, { ...entry(HIGH, "soon") }, { ...entry(HIGH, "2026-12-01"), owner: "" }]) {
      expect(() => parseAuditAllowlist({ accepted: [bad] })).toThrow();
    }
    expect(() => evaluate({ vulnerabilities: {} }, { accepted: [] }, "2026-11-25")).toThrow(/npm audit v2/);
  });
  it("the committed allow-list is well formed and every entry expires within the window", () => {
    const allow = JSON.parse(readFileSync(path.join(ROOT, ".github/security/audit-allowlist.json"), "utf8"));
    expect(() => parseAuditAllowlist(allow)).not.toThrow();
    expect(evaluate(report(), allow, "2026-11-25").tooLong).toEqual([]);
  });
});

// ---- secret scanner -------------------------------------------------------------------------------------------------
const j = (...p: string[]) => p.join("");
const rand = (n: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") => {
  let s = "", x = 12345;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += alphabet[x % alphabet.length]; }
  return s;
};
const rules = (text: string) => (scanText("f.ts", text) as Finding[]).map((f) => f.rule);

describe("secret scanner", () => {
  it.each([
    ["private-key-block", j("-----BEGIN ", "RSA PRIVATE KEY-----")],
    ["aws-access-key-id", j("const id = 'AK", "IA", rand(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), "'")],
    ["github-token", j("gh", "p_", rand(36))],
    ["slack-token", j("xo", "xb-", rand(24))],
    ["stripe-live-key", j("sk", "_live_", rand(24))],
    ["anthropic-api-key", j("sk-", "ant-api03-", rand(60))],
    ["google-api-key", j("AI", "za", rand(35))],
    ["npm-token", j("np", "m_", rand(36))],
    ["jwt", j("ey", "J", rand(20), ".ey", "J", rand(20), ".", rand(30))],
    ["url-with-password", j("DATABASE_URL=postgres://app:", rand(24), "@db.internal:5432/app")],
    ["high-entropy-assignment", j('const clientSecret = "', rand(32), '";')],
    ["high-entropy-assignment", j('DB_PASSWORD: "', rand(24), '"')],
  ])("flags %s", (rule, text) => {
    expect(rules(text)).toContain(rule);
  });
  it("does not flag placeholders, low-entropy values, URLs, chain identifiers or names that merely start with token", () => {
    for (const text of [
      'password: "aaaaaaaaaaaaaaaaaaaaaaaa"', 'const apiKey = "${process.env.API_KEY}"', 'secret: "<your-secret-goes-here-please>"',
      'const XERO_TOKEN = "https://identity.xero.com/connect/token"', j('"token_contract": "T', rand(33, "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"), '"'),
      j('txToken = "0x', rand(64, "0123456789abcdef"), '"'), 'secret: "test_whsec_fictional_public_example_value"', j('const tokenSymbol = "', rand(30), '"'),
      j('const pw = "', rand(30), '" // secret-scan: allow fixture'), "postgres://clearline_runtime:devpw@127.0.0.1/x",
    ]) expect(rules(text), text).toEqual([]);
  });
  it("prints a fingerprint, never the value", () => {
    const value = rand(32);
    const [f] = scanText("a.ts", `apiKey = "${value}"`) as Finding[];
    expect(f).toEqual({ path: "a.ts", line: 1, rule: "high-entropy-assignment", fingerprint: fingerprint(`apiKey = "${value}"`) });
    expect(JSON.stringify(f)).not.toContain(value);
  });
  it("entropy is in bits per character", () => {
    expect(entropy("aaaa")).toBe(0);
    expect(entropy("abcd")).toBe(2);
  });
  it("diff mode reads only added lines, with their line numbers in the new file", () => {
    const secret = j("gh", "p_", rand(36));
    const diff = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -3,0 +4,2 @@", `+const a = 1;`, `+const t = "${secret}";`, "@@ -10 +12 @@", `-const old = "${secret}";`, "+const b = 2;", "--- a/y.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone"].join("\n");
    const files = addedLines(diff) as Map<string, { lines: string[]; numbers: number[] }>;
    expect([...files.keys()]).toEqual(["x.ts"]);
    expect(files.get("x.ts")!.numbers).toEqual([4, 5, 12]);
    const found = scanText("x.ts", files.get("x.ts")!.lines.join("\n"), files.get("x.ts")!.numbers) as Finding[];
    expect(found.map((f) => [f.rule, f.line])).toEqual([["github-token", 5]]);
  });
  it("the allow-list matches by path and fingerprint only, and every entry needs a reason", () => {
    const f = [{ path: "a.ts", line: 1, rule: "jwt", fingerprint: "0123abcd" }, { path: "b.ts", line: 1, rule: "jwt", fingerprint: "0123abcd" }];
    expect(applyAllowlist(f, [{ path: "a.ts", fingerprint: "0123abcd", reason: "fictional fixture" }])).toEqual([f[1]]);
    expect(() => parseAllowlist({ allowed: [{ path: "a.ts", fingerprint: "0123abcd" }] })).toThrow(/reason/);
    expect(() => parseAllowlist({ allowed: [{ path: "a.ts", fingerprint: "xyz", reason: "fictional fixture" }] })).toThrow(/fingerprint/);
  });
  it("the tracked tree has no open finding with the committed allow-list", () => {
    const { findings, scanned } = scanTree(ROOT) as { findings: Finding[]; scanned: number };
    expect(scanned).toBeGreaterThan(1000);
    const allowed = parseAllowlist(JSON.parse(readFileSync(path.join(ROOT, ".github/security/secret-scan-allowlist.json"), "utf8")));
    expect(applyAllowlist(findings, allowed).map((f: Finding) => `${f.path}:${f.line} ${f.rule}`)).toEqual([]);
  });
});
