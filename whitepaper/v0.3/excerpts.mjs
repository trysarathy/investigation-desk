// Code excerpts quoted in section 5. Copied from the repository, trimmed for reading only: a line
// shown as "…" stands for lines left out, and "…" inside a line stands for a long text label left out.
// Nothing is reworded. Branch qa-polish @ 12abf33 (PR #31) unless noted; the approval check is from
// branch xero-scopes @ da07676 (PR #36). Both branches are unmerged.

export const EXCERPTS = {
  order: {
    title: "1. Every rule runs; the first high-confidence match wins",
    path: "src/lib/catalogue.ts 12–15 · src/lib/engine/run.ts 30–39",
    code: `export const CATALOGUE_ORDER: Code[] = [
  "D01", "D02", "D03", "D09", "D04", "D05", "D06", "D07", "D07b", "D17", "D18",
  "D08", "D10", "D11", "D12", "D13", "D14", "D16",
];

  // A chain we could not reach means absence is unproven: pause instead of guessing.
  const pausedChains = facts.lookups.filter((l) => l.result === "error").map((l) => l.chain);
  const mempoolCounts = !!facts.mempool && settings.mempoolChecksEnabled;
  if (!facts.tx && !mempoolCounts && pausedChains.length > 0) {
    return { ...base, state: "paused", code: "D99", confidence: null, evidenceIds: [], findings: [], checks: [], pausedChains };
  }

  const checks: RuleResult[] = CATALOGUE_ORDER.map((code) => RULES[code as keyof typeof RULES](ctx));
  const winner = checks.find((c) => c.matched && c.confidence === "High") ??
    checks.find((c) => c.matched && c.confidence === "Medium");`,
  },
  counterfeit: {
    title: "2. Genuine means the issuer's contract, not the name",
    path: "src/lib/requests/lifecycle.ts 288–292",
    code: `  if (!sameAddress(o.tokenContract, r.tokenContract)) {
    return o.tokenSymbol.toUpperCase().includes(r.token)
      ? { kind: "counterfeit", text: \`Calls itself \${o.tokenSymbol}, but it doesn't come from \${ISSUER[r.token]}'s \${r.token} contract: it isn't real \${r.token}.\` }
      : { kind: "wrong_token", text: \`\${o.tokenSymbol} is not the token requested (\${r.token}).\` };
  }`,
  },
  lookalike: {
    title: "3. The look-alike address check on the payment page",
    path: "src/lib/requests/lifecycle.ts 557–563",
    code: `export function compareAddress(input: string, real: string): AddressCheck["result"] {
  const a = input.trim();
  if (!EVM_ADDRESS.test(a)) return "invalid";
  if (sameAddress(a, real)) return "match";
  const x = a.toLowerCase().slice(2), y = real.toLowerCase().slice(2);
  return x.slice(0, 4) === y.slice(0, 4) || x.slice(-4) === y.slice(-4) ? "lookalike" : "different";
}`,
  },
  matching: {
    title: "4. Matching: never by amount alone; evidence scores for a person to confirm",
    path: "src/lib/requests/lifecycle.ts 143–146 · 517–527",
    code: `  const exact = candidates.filter((r) => isDecimal(ev.amount) && compareDecimal(ev.amount, r.amount) === 0);
  const hint = exact.length === 1 ? \` The amount equals \${exact[0].id}, but amount alone isn't proof.\` : "";
  return { kind: "ambiguous", candidates: candidates.map((r) => r.id), at,
    reason: … };
…
    const signals: MatchSignal[] = [
      { label: …, points: exact ? 40 : 0, ok: exact },
      { label: …, points: knownSender ? 35 : 0, ok: knownSender },
      { label: …, points: exact && sameAmount === 1 ? 15 : 0, ok: exact && sameAmount === 1 },
      { label: …, points: after ? 10 : 0, ok: after },
    ];
    const score = signals.reduce((s, x) => s + x.points, 0);
    return { request: r, score, confidence: (score >= 80 ? "Strong" : score >= 50 ? "Possible" : "Weak") as MatchSuggestion["confidence"], signals };
  });
  // Only suggestions with real evidence (the amount or the sender), never timing alone.
  return out.filter((s) => s.score >= 40).sort(…).slice(0, 3);`,
  },
  posting: {
    title: "5. The posting plan: some transfers never reach the books, and approval is for one exact plan",
    path: "src/lib/accounting/rules.ts 98–100 · src/lib/accounting/engine.ts 38–47 (PR #36)",
    code: `  // Transfers that must never reach the books.
  const neverKinds = new Set(["counterfeit", "wrong_network", "failed", "wrong_token"]);
  const never = v.flagged.filter((f) => neverKinds.has(f.kind));
…
  if (!o.expectedKey) {
    // No key means nobody showed which plan was approved: never post "whatever the plan is now".
    const error = "Plan key missing: approve the plan shown on the page.";
    return { acct: appendAudit(acct, { …, kind: "refused", … }), plan, error };
  }
  if (o.expectedKey !== plan.idempotencyKey) {
    // What the person approved isn't what would post now (a transfer arrived, a decision changed): show them again.
    const error = "The plan changed since you looked at it. Check the new lines and approve again.";
    return { acct: appendAudit(acct, { …, kind: "refused", … }), plan, error };
  }`,
  },
  schema: {
    title: "The proposed payment instruction and receipt (draft, section 7)",
    path: "proposal; most fields map to records Clearline keeps today (src/lib/requests/types.ts)",
    code: `{
  "instruction": {
    "version": "0.1",
    "issuer": { "name": "Northwind Pay Pte Ltd", "domain": "northwind.example" },
    "invoice": "INV-1042",
    "amount": { "value": "5000000000", "decimals": 6 },
    "asset": { "chain": "eip155:1", "contract": "0xA0b8…eB48", "symbol": "USDC" },
    "payTo": "0x…",
    "expires": "2026-11-30T00:00:00Z",
    "signature": "signed with a key published at the issuer's domain"
  },
  "receipt": {
    "instructionHash": "sha256 of the instruction",
    "transfer": { "chain": "eip155:1", "tx": "0x…", "logIndex": 7, "block": 21480123 },
    "checks": [ { "rule": "genuine_token", "result": "pass", "ruleVersion": "rules-2026-10-22.5" } ],
    "verdict": "short",
    "evidence": [ { "source": "rpc", "sha256": "hash of the raw response" } ],
    "booked": { "system": "xero", "lines": ["payment 4950.00", "fee write-off 50.00"] }
  }
}`,
  },
};
