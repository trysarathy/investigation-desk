// Regression tests for the overnight QA pass (29 Oct 2026). Logic fixes are tested directly; the
// layout fixes are guarded by small checks on the files that carry them (the full layout check is
// the Playwright run in tests/e2e/qa_flows.mjs, which measures overflow at 390 px).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lines, seedDemoBooks } from "@/lib/accounting/engine";
import { emptyAccounting } from "@/lib/accounting/types";
import { CONFIRMATIONS } from "@/lib/requests/check";
import { resetDemo } from "@/lib/requests/demo";
import { emptyRequests } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const src = (p: string) => readFileSync(path.join(__dirname, "..", "src", p), "utf8");

describe("audit log wording", () => {
  it("counts lines in plain English, never 'line(s)'", () => {
    expect(lines(1)).toBe("1 line");
    expect(lines(2)).toBe("2 lines");
    expect(lines(0)).toBe("0 lines");
  });

  it("the demo books' 'Request made' entries write amounts the way every other page does", async () => {
    const reqData = resetDemo(emptyRequests(), NOW, (id) => `pub-${id}`);
    const acct = await seedDemoBooks(reqData, emptyAccounting(), { now: NOW, operator: "Mei Tan (Finance ops)", threshold: CONFIRMATIONS });
    const made = acct.audit.find((e) => e.kind === "imported" && e.requestId === "DEMO-1041");
    expect(made?.reason).toBe("Payment request DEMO-1041 made from INV-1041 (1,250.00 USD due).");
    expect(acct.audit.some((e) => /line\(s\)/.test(e.reason))).toBe(false);
  });

  it("an approval of one line says '1 line'", async () => {
    const reqData = resetDemo(emptyRequests(), NOW, (id) => `pub-${id}`);
    const acct = await seedDemoBooks(reqData, emptyAccounting(), { now: NOW, operator: "Mei", threshold: CONFIRMATIONS });
    const approved = acct.audit.filter((e) => e.kind === "approved");
    expect(approved.length).toBeGreaterThan(0);
    for (const e of approved) expect(e.reason).toMatch(/approved \d+ lines?: /);
    expect(approved.some((e) => e.reason.includes("approved 1 line: "))).toBe(true);
  });
});

describe("pages that broke on a 390 px phone", () => {
  it("a customer's message wraps long unbroken text (a 64-character transaction hash)", () => {
    expect(src("app/globals.css")).toMatch(/\.message p \{[^}]*overflow-wrap: anywhere/);
  });

  it("the Books audit log stacks on a phone instead of three fixed columns", () => {
    const css = src("app/globals.css");
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.audit-row \{ grid-template-columns: auto minmax\(0, 1fr\)/);
    expect(src("app/books/page.tsx")).toContain('className="audit-row"');
  });

  it("wide tables scroll inside their panel (posting lines, demo invoices)", () => {
    expect(src("components/books/BooksPanel.tsx")).toMatch(/<div className="table-wrap">\s*<table className="table"[^>]*data-testid="posting-lines"/);
    expect(src("app/books/page.tsx")).toMatch(/<div className="table-wrap">\s*<table className="table"[^>]*data-testid="demo-invoices"/);
  });

  it("the loading skeleton has no fixed-width columns", () => {
    expect(src("app/loading.tsx")).not.toMatch(/\d+px \d+px/);
  });
});

describe("not-found pages", () => {
  it("never talk about 'cases' or the hidden queue in demo mode, and the customer's page has no operator links", () => {
    const root = src("app/not-found.tsx");
    expect(root).not.toContain("Case not found");
    expect(root).toContain("Back to At a glance");
    const pay = src("app/pay/[publicId]/not-found.tsx");
    expect(pay).toContain("This payment link isn&apos;t valid");
    expect(pay).not.toMatch(/href=/);
  });

  it("the request page only says the books aren't connected when this request isn't linked to them", () => {
    const page = src("app/requests/[id]/page.tsx");
    expect(page).not.toContain("this demo isn&apos;t connected to one");
    expect(page).toContain("{!linkedToBooks && <li>Whether your accounting system was updated");
  });
});

describe("names in sentences", () => {
  it("one possessive rule everywhere: Kite Analytics' and Acme's", async () => {
    const { possessive } = await import("@/lib/requests/ui");
    expect(possessive("Kite Analytics")).toBe("Kite Analytics'");
    expect(possessive("Acme Logistics")).toBe("Acme Logistics'");
    expect(possessive("Orbit Retail")).toBe("Orbit Retail's");
    expect(src("app/requests/payments/[key]/page.tsx")).not.toContain("customerRef}&apos;s");
  });
});

describe("one short form for a transaction hash", () => {
  it("the books panel's reasons shorten a hash the same way as the transfer list and the reply", async () => {
    const { planPosting } = await import("@/lib/accounting/rules");
    const { shortHash } = await import("@/lib/requests/present");
    const reqData = resetDemo(emptyRequests(), NOW, (id) => `pub-${id}`);
    const acct = await seedDemoBooks(reqData, emptyAccounting(), { now: NOW, operator: "Mei", threshold: CONFIRMATIONS });
    const plan = planPosting(reqData, acct, "DEMO-1043", { threshold: CONFIRMATIONS });
    const obs = Object.values(reqData.observations).find((o) => o.attribution.kind === "request" && o.attribution.requestId === "DEMO-1043")!;
    expect(plan.reasons.join(" ")).toContain(`Transfer ${shortHash(obs.hash)} `);
  });
});
