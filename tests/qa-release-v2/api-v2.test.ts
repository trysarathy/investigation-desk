/**
 * Independent QA + security review of release/clearline-v2-20261113 @ c498da6: v1 API and redirects.
 * Fictional sandbox data only. "DEFECT …" tests assert correct behaviour and fail until fixed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/clearline/test/v1/[...path]/route";
import { REDIRECTS, SECTIONS } from "@/components/clearline/nav";
import { moved } from "@/components/clearline/redirect";
import { sampleWorkspace, scenarioIntentId } from "@/lib/clearline";

const H = { authorization: "Bearer cl_test_demo", "content-type": "application/json" };
const ctx = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });
const post = (p: string, body: unknown) =>
  POST(new NextRequest("http://x/api/clearline/test/v1/" + p, { method: "POST", headers: H, body: JSON.stringify(body) }), ctx(p));

describe("QA v2 — 308 redirects (IA v2)", () => {
  const hrefs = new Set(SECTIONS.flatMap((s) => [s.href, ...(s.tabs ?? []).map((t) => t.href)]));
  it("every redirect target is a same-origin console path that is itself a nav destination", () => {
    for (const [from, to] of Object.entries(REDIRECTS)) {
      expect(from.startsWith("/clearline/")).toBe(true);
      expect(to).toMatch(/^\/clearline\/[a-z/-]+$/);
      expect(hrefs.has(to)).toBe(true);
    }
  });
  it.each([
    "http://x/clearline/connect?next=https://evil.example",
    "http://x/clearline/connect?//evil.example",
    "http://evil.example/clearline/connect",
    "http://x/clearline/connect?%0d%0aSet-Cookie:a=1",
    "http://x/clearline/connect?@evil.example",
  ])("%s → 308 with a relative Location under /clearline/routes/new", async (url) => {
    const res = moved("/clearline/connect")(new Request(url));
    expect(res.status).toBe(308);
    const loc = res.headers.get("location")!;
    expect(loc.startsWith("/clearline/routes/new")).toBe(true);
    expect(loc.startsWith("//")).toBe(false);
    expect(new URL(loc, "https://trial.example").origin).toBe("https://trial.example");
    expect(loc).not.toMatch(/[\r\n]/);
  });
});

describe("QA v2 — F1/F2 through the v1 route (pinned)", () => {
  it("provider settlement report on the returned sample payout → contradiction, settlement stays contradicted (never upgraded)", async () => {
    const ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s2_returned")!;
    const ppid = ws.instructions.find((x) => x.id === ws.intents.find((i) => i.id === id)!.instructionId)!.providerPaymentId!;
    const intent = ws.intents.find((i) => i.id === id)!;
    const r = await post("reconciliation/statement-lines", {
      workspace: ws,
      line: { lineId: "QA-V2-F1", source: "provider_settlement_report", accountRef: "prv_northline:settlement", direction: "debit", kind: "payment", amountMinor: intent.amountMinor, currency: intent.sourceCurrency, reference: ppid, counterparty: "Northline", valueDate: "2026-11-12" },
    });
    const j = await r.json();
    expect(r.status).toBeLessThan(300);
    expect(j.outcome).toBe("contradictory_exception_raised");
    expect(j.workspace.intents.find((i: { id: string }) => i.id === id).status.settlement).toBe("contradicted"); // rc3 s2: debited then returned
    const v = await (await post(`investigations/${id}`, { workspace: j.workspace })).json();
    expect(v.data.contradictions.map((c: { code: string }) => c.code)).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
  });

  it("a tampered amountDifference in a submitted workspace is a 4xx, never a 5xx", async () => {
    for (const ad of [{}, null, "x", { code: "RC_PARTIAL_AMOUNT", expectedMinor: 3, reportedMinor: 1, differenceMinor: 1, currency: "SGD", source: "bank_statement", statementLineId: "x", requiredNextAction: "x" }]) {
      const ws = sampleWorkspace() as unknown as { statementLines: Record<string, unknown>[] };
      ws.statementLines[0].amountDifference = ad;
      const r = await post("liquidity", { workspace: ws });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
  });
});

describe("QA v2 — console error boundary present", () => {
  it("src/app/clearline/error.tsx exists", () => {
    expect(existsSync(join(__dirname, "../../src/app/clearline/error.tsx"))).toBe(true);
  });
});
