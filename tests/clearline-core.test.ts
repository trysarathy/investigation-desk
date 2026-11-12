import { describe, expect, it } from "vitest";
import { allowedTransition, transition, initialWorkspace, quoteFor, reconcile, liquidity, explain, signWebhook, verifyWebhook, createIntent } from "@/lib/clearline/core";

describe("Clearline Connect payment state machine", () => {
  it("allows the complete partner-executed happy path", () => {
    let p = initialWorkspace().payments[0];
    for (const next of ["quoted", "approved", "submitted", "in_transit", "completed"] as const) {
      expect(allowedTransition(p.status, next)).toBe(true);
      p = transition(p, next, "Sandbox provider status update");
    }
    expect(p.status).toBe("completed");
    expect(p.timeline.at(-1)?.state).toBe("completed");
  });
  it("blocks skips and terminal rewrites", () => {
    const p = initialWorkspace().payments[0];
    expect(() => transition(p, "completed", "skip")).toThrow();
    expect(allowedTransition("completed", "submitted")).toBe(false);
    expect(allowedTransition("returned", "completed")).toBe(false);
  });
  it("quotes 3 supported sandbox routes, explains ineligible providers", () => {
    const quotes = quoteFor({ amountMinor:4821537, currency:"SGD", destinationCurrency:"PHP", kycTier:2 });
    expect(quotes.filter(q=>q.eligible)).toHaveLength(3);
    expect(quotes.some(q=>!q.eligible && q.reason)).toBe(true);
  });
  it("reconciles only exact references, never amounts alone", () => {
    const state = initialWorkspace();
    const events = [{ paymentId:"unknown", reference:"NOT_THE_REFERENCE", amountMinor:4821537, currency:"SGD", source:"sandbox" }];
    expect(reconcile(state.payments, events).some(x=>x.reason==="Unmatched reference")).toBe(true);
    expect(reconcile(state.payments, events).some(x=>x.status==="matched")).toBe(false);
  });
  it("calculates liquid cash with reserved, pending and buffer subtracted", () => {
    expect(liquidity({ balanceMinor:4821537,safeguardedMinor:1000000,pendingMinor:1250000,bufferMinor:750000 })).toBe(1821537);
  });
  it("states observations without asserting independent settlement", () => {
    const p = initialWorkspace().payments.find(x=>x.scenario==="delay")!;
    expect(explain(p).toLowerCase()).toMatch(/finality|confirmation/);
    expect(explain(p)).not.toMatch(/verified settlement/i);
  });
  it("signs and verifies webhook payloads, rejects tampering", async () => {
    const payload='{"id":"evt_test_83a","type":"payout.completed"}';
    const secret="test_secret_synthetic_only_123456";
    const signature=await signWebhook(payload,secret,1794500000);
    expect(await verifyWebhook(payload,secret,signature,1794500000)).toBe(true);
    expect(await verifyWebhook(payload+" ",secret,signature,1794500000)).toBe(false);
  });
  it("accepts strictly fictional payment intents and rejects malicious inputs",()=>{
    expect(createIntent({amount:"48215.37",currency:"SGD",destinationCurrency:"PHP",beneficiary:"Supplier Alpha",purpose:"Invoice",reference:"INV-2026-137"}).status).toBe("created");
    expect(()=>createIntent({amount:"0",currency:"SGD",destinationCurrency:"PHP",beneficiary:"Supplier Alpha",purpose:"Invoice",reference:"INV-2026-137"})).toThrow();
    expect(()=>createIntent({amount:"1",currency:"SGD",destinationCurrency:"PHP",beneficiary:"<script>",purpose:"Invoice",reference:"INV-2026-137"})).toThrow();
  });
});