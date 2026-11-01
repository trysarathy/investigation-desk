// Live-mode wording on the request screens (At a glance, the decision hints, the customer reply).
// Auto-mark-paid is on only in demo mode (src/lib/requests/service.ts: `autoMarkPaid: demo`), so a
// live screen must say what happens today: checked, then a person marks it paid. Demo keeps its
// wording, labelled demo. Sources: company/PRODUCT_FACTS.md, team/CLAIMS_REVIEW.md row 2.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { glanceCopy, requestBalanceHint } from "@/lib/requests/copy";
import { addr } from "@/lib/requests/demo";
import { createRequest, decide, deriveRequest, ingest } from "@/lib/requests/lifecycle";
import { nextAction, replyDraft } from "@/lib/requests/present";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type RequestsData } from "@/lib/requests/types";
import { glance } from "@/lib/requests/ui";

const OVERCLAIM = /automatically|every payment/i;
const NOW = "2026-10-25T09:00:00.000Z";
const sim = new SimulatedProvider();

/** A live request (auto-mark rule off, as service.ts makes it outside demo) with a payment of `paid`. */
function liveRequest(paid: string, auto = false): RequestsData {
  let d = createRequest(emptyRequests(), { customerRef: "Cust L1", invoiceRef: "INV-L1", amount: "1250", receivingAddress: addr("l1"), token: "USDC" },
    { now: NOW, by: "Mei", demo: false, publicId: "L1", tokenContract: OFFICIAL_USDC, id: "L1", autoMarkPaid: auto }).data;
  const ev = { ...sim.send(emptyRequests(), { to: addr("l1"), amount: paid, tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:l1"), seq: "a" }),
    source: "live" as const, demo: false, blockNumber: 900, blockTime: NOW, confirmations: CONFIRMATIONS };
  d = ingest(d, ev, NOW, "test", checkObservation(NOW), CONFIRMATIONS).data;
  return d;
}

describe("At a glance, live mode (DEMO_MODE=off)", () => {
  const d = liveRequest("1250.00");
  const views = Object.values(d.requests).map((r) => deriveRequest(d, r, CONFIRMATIONS));
  const g = glance(d, views, Date.parse(NOW) + 60_000);
  const c = glanceCopy(false, g);

  it("never says 'automatically' or 'Every payment'", () => {
    expect(c.heroSub).not.toMatch(OVERCLAIM);
    expect(`${c.paidTile.label} ${c.paidTile.sub}`).not.toMatch(OVERCLAIM);
  });

  it("the tile says what happens today: checked and ready to mark paid, counting matched requests", () => {
    expect(c.paidTile.label).toBe("Checked and ready to mark paid");
    expect(c.paidTile.value).toBe(1);
    expect(c.paidTile.sub).toBe("waiting for you to mark them paid");
    expect(c.heroSub).toMatch(/When a payment is wrong, Clearline says why in plain English/);
    expect(c.heroSub).toMatch(/Correct payments are checked and ready to mark paid in one click, with the reasons written down\./);
  });

  it("hides the time-saved tile (an unmeasured demo estimate)", () => {
    expect(c.showTimeSaved).toBe(false);
  });
});

describe("At a glance, demo mode", () => {
  const c = glanceCopy(true, { paidAuto: 11, readyToMark: 0, arrived: 16 });
  it("keeps the demo wording, visibly labelled demo, and the labelled time-saved estimate", () => {
    expect(c.paidTile.label).toBe("Paid automatically · demo");
    expect(c.paidTile.value).toBe(11);
    expect(c.paidTile.sub).toBe("of 16 payments that arrived");
    expect(c.showTimeSaved).toBe(true);
  });
  it("drops 'Every payment' there too: ambiguous payments go to a person (CLAIMS_REVIEW rows 3-4)", () => {
    expect(c.heroSub).not.toMatch(/every payment/i);
  });
});

describe("decision hint and customer words for a short payment", () => {
  it("live: checked and ready for you to mark it paid; nothing is marked paid until you confirm", () => {
    const h = requestBalanceHint(false);
    expect(h).not.toMatch(OVERCLAIM);
    expect(h).toMatch(/Checked: ready for you to mark it paid/);
    expect(h).toMatch(/nothing is marked paid until you confirm/i);
  });
  it("demo: says automatically, labelled demo", () => {
    expect(requestBalanceHint(true)).toMatch(/automatically/);
    expect(requestBalanceHint(true)).toMatch(/demo/i);
  });
  it("live: the next step and the reply to the customer don't promise automatic marking", () => {
    const d = liveRequest("1200.00");
    const v = deriveRequest(d, d.requests.L1, CONFIRMATIONS);
    expect(v.review).toBe("short");
    expect(replyDraft(v, d, { business: "Northwind Pay Pte Ltd" })).not.toMatch(OVERCLAIM);
    const auto = liveRequest("1200.00", true);
    expect(replyDraft(deriveRequest(auto, auto.requests.L1, CONFIRMATIONS), auto, { business: "Northwind Pay Pte Ltd" })).toMatch(/automatically/);
    const asked = decide(d, "L1", { kind: "request_balance", note: "Asked for the 50.00" }, { now: NOW, by: "Mei", threshold: CONFIRMATIONS }).data;
    const next = nextAction(deriveRequest(asked, asked.requests.L1, CONFIRMATIONS), asked);
    expect(next.title).toMatch(/Wait for the remaining/);
    expect(next.detail).not.toMatch(/It's marked paid when the rest arrives/);
    expect(next.detail).toMatch(/ready for you to mark it paid/);
  });
});

describe("no hard-coded over-claims left in the screen files", () => {
  for (const f of ["src/app/requests/page.tsx", "src/components/requests/RequestActions.tsx"]) {
    it(f, () => expect(readFileSync(path.resolve(__dirname, "..", f), "utf8")).not.toMatch(/Paid automatically|marked paid automatically|Every payment/));
  }
});
