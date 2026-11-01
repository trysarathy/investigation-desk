// Task 6a-2: both screens (/requests/all and /requests/[id]) show the status sentence from paymentStatus().

import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentStatusLine } from "@/components/requests/PaymentStatusLine";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr } from "@/lib/requests/demo";
import { createRequest, deriveRequest, ingest } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { paymentStatus } from "@/lib/requests/status";
import { emptyRequests } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";

/** A demo request with a simulated 1,250.00 USDC transfer at 6 of 12 confirmations. */
function confirming() {
  let d = createRequest(emptyRequests(), { customerRef: "Cust L1", invoiceRef: "INV-L1", amount: "1250", receivingAddress: addr("l1"), token: "USDC" },
    { now: NOW, by: "Mei", demo: true, publicId: "L1", tokenContract: OFFICIAL_USDC, id: "L1" }).data;
  const ev = new SimulatedProvider().send(d, { to: addr("l1"), amount: "1250.00", tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr("from:l1"), seq: "a" });
  d = ingest(d, { ...ev, blockNumber: 100, blockTime: NOW, confirmations: 6 }, NOW, "test", checkObservation(NOW), CONFIRMATIONS).data;
  return paymentStatus(d, deriveRequest(d, d.requests.L1, CONFIRMATIONS));
}

describe("both screens show the sentence", () => {
  it("the shared line renders the sentence, in a status region on the detail page", () => {
    const s = confirming();
    const html = renderToStaticMarkup(createElement(PaymentStatusLine, { s, live: true }));
    expect(html).toContain("Confirming: about 2 minutes until it&#x27;s confirmed, and there&#x27;s nothing to do yet.");
    expect(html).toContain('role="status"');
    expect(html).toContain('data-status="confirming"');
    expect(renderToStaticMarkup(createElement(PaymentStatusLine, { s }))).not.toContain("role=");
  });
  for (const f of ["src/app/requests/all/page.tsx", "src/app/requests/[id]/page.tsx"]) {
    it(`${f} renders PaymentStatusLine from paymentStatus()`, () => {
      const src = readFileSync(path.resolve(__dirname, "..", f), "utf8");
      expect(src).toMatch(/paymentStatus\(data, v\)/);
      expect(src).toMatch(/<PaymentStatusLine /);
    });
  }
});
