/**
 * rc3 follow-up: the s2 sample shows the outgoing debit, then payout.returned, then the return credit.
 * The other four guided cases must stay byte-identical to the v2 sample. The fingerprints below were taken from the
 * sample BEFORE the s2 change (commit efabe6a): SHA-256 over every record owned only by the case (ids, timestamps,
 * statuses), its audit entries, idempotency key, investigation view, evidence timeline, funding rows and exceptions.
 */
import { describe, expect, it } from "vitest";
import { evidenceTimelineFor, fundingProjection, investigate, listExceptions, sampleWorkspace, scenarioIntentId, type Workspace } from "@/lib/clearline";
import { scenarioOwnership } from "@/lib/clearline/scenarios";
import { sha256Hex } from "@/lib/clearline/sha256";

const COLL = ["intents", "quotes", "instructions", "providerEvents", "evidence", "statementLines", "allocations", "exceptions", "cases", "holds", "chainObservations", "advances", "fundingDecisions", "obligations", "repaymentAllocations"] as const;
function fingerprint(ws: Workspace, sc: string): string {
  const own = scenarioOwnership(ws);
  const mine = (id: string) => { const s = own.get(id); return !!s && s.size === 1 && s.has(sc); };
  const recs = COLL.flatMap((c) => (ws[c] as unknown as { id: string }[]).filter((r) => mine(r.id)));
  const audit = ws.audit.filter((a) => mine(a.entityId));
  const id = scenarioIntentId(ws, sc)!;
  const v = investigate(ws, id);
  const view = { v: v.ok ? v.value : null, t: evidenceTimelineFor(ws, id), f: fundingProjection(ws).rows.filter((r) => r.intentId === id), e: listExceptions(ws, { intentId: id }) };
  return sha256Hex(JSON.stringify({ recs, audit, view, idem: Object.entries(ws.idempotency).filter(([, x]) => mine(x.intentId)) }));
}

const V2_FINGERPRINTS: Record<string, string> = {
  s1_success: "7a772666dfb179eed4245f4c75620e509b553ffa67f6ad7e075d1bcf4bbde950",
  s3_hold: "74de9b1bb804dd613fd21a57ff990c57171dc18a5944525cf4955751bd0cd55f",
  s4_chain: "253f03e4b31ad7db9b008a8193f3c79cfa240a280dbb88012d3544ffdb2b9aff",
  s5_funding: "36a561d6265510fd9788183e095266f590e1bcf420414c892d474c3765c64fe8",
};
/**
 * After the console's label fix ("Bank statement BANK-SGD-OPS (fictional) (fictional)" → "(fictional)" once,
 * reconciliation.ts evidenceSourceLabel), s1 and s5 bank-line evidence carries the corrected source text.
 * CURRENT pins the sample as it is now; the v2 pins above are still checked after undoing only that text.
 */
const CURRENT_FINGERPRINTS: Record<string, string> = {
  s1_success: "8d11d133face15e4b6326f62974a7eb2eb6562efe92074274446cdd69a8d735b",
  s3_hold: "74de9b1bb804dd613fd21a57ff990c57171dc18a5944525cf4955751bd0cd55f",
  s4_chain: "253f03e4b31ad7db9b008a8193f3c79cfa240a280dbb88012d3544ffdb2b9aff",
  s5_funding: "0b05dd74ae918190c6280c00fa70a68ce69a74b6f7a362c68024176a863104d2",
};
/** The v2 builder's source text: it always appended " (fictional)", even after an account ref that already ends with it. */
const asV2Labels = (ws: Workspace): Workspace => {
  const w = JSON.parse(JSON.stringify(ws)) as Workspace;
  for (const e of w.evidence) if (/^(Bank statement|Provider settlement report) .*\(fictional\)$/.test(e.source) && !e.source.endsWith("(fictional) (fictional)")) {
    const line = w.statementLines.find((l) => l.lineId === e.reference);
    if (line && /\(fictional\)/i.test(line.accountRef)) e.source += " (fictional)";
  }
  return w;
};

describe("rc3 sample: the s2 change leaves the other four cases byte-identical", () => {
  const ws = sampleWorkspace();
  for (const [sc, fp] of Object.entries(CURRENT_FINGERPRINTS)) it(`${sc} is pinned as it is now`, () => expect(fingerprint(ws, sc)).toBe(fp));
  for (const [sc, fp] of Object.entries(V2_FINGERPRINTS)) it(`${sc} is unchanged from the v2 sample apart from the corrected evidence source text`, () => expect(fingerprint(asV2Labels(ws), sc)).toBe(fp));

  it("s2 keeps its payment id; the statement shows the debit before payout.returned and the equal return credit after it", () => {
    const id = scenarioIntentId(ws, "s2_returned")!;
    expect(id).toBe("pi_00027");
    const debit = ws.statementLines.find((l) => l.lineId === "SIMBANK-0002")!;
    const credit = ws.statementLines.find((l) => l.lineId === "SIMBANK-0006")!;
    expect(debit).toMatchObject({ source: "bank_statement", direction: "debit", kind: "payment", amountMinor: 1_278_490, currency: "USD", status: "allocated", explanationCodes: ["RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW"] });
    expect(credit).toMatchObject({ source: "bank_statement", direction: "credit", kind: "return", amountMinor: 1_278_490, currency: "USD", status: "allocated", explanationCodes: ["RC_RETURN_CONFIRMS_PROVIDER_RETURN"] });
    const returned = ws.providerEvents.find((e) => e.intentId === id && e.normalizedType === "payout.returned" && e.processingOutcome === "applied")!;
    expect(Date.parse(debit.receivedAt)).toBeLessThan(Date.parse(returned.receivedAt));
    expect(Date.parse(returned.receivedAt)).toBeLessThan(Date.parse(credit.receivedAt));
  });
});
