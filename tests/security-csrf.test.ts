// SECURITY BUG (qa-security-engineer, 31 Oct 2026, origin/main @ 8decb27):
// No CSRF defence on any state-changing route: no token, no Origin / Sec-Fetch-Site check. JSON routes
// use `req.json()`, which also parses a `text/plain` body, so a cross-site
// `<form method=POST enctype="text/plain">` can send JSON-shaped data, and browsers resend cached
// Basic-auth credentials, so the preview password does not stop it. The approval key is no defence:
// `idempotencyKeyFor` (`src/lib/accounting/rules.ts`) is sha256 of the request ID, line kinds,
// amounts, `chain:hash:logIndex` and account codes, all known to anyone who knows the request and
// the transaction. Result: an attacker page visited by a signed-in finance user approves and posts
// an entry to the books under a name the attacker types.
//
// Manual reproduction (scratch server only):
//   DESK_DATA_DIR=$(mktemp -d) npx next dev -p 3400
//   curl -s -X POST localhost:3400/api/requests/demo -d '{"kind":"reset"}'
//   curl -s -X POST localhost:3400/api/requests/demo -d '{"kind":"advance","blocks":64}'
//   # DEMO-1042 is now "ready"; its key is recomputable (see the test). Then, as a cross-site form would:
//   curl -s -X POST localhost:3400/api/accounting/DEMO-1042 -H 'Origin: https://attacker.example' \
//        -H 'Sec-Fetch-Site: cross-site' -H 'Content-Type: text/plain' \
//        -d '{"actor":"Attacker","key":"clearline-<recomputed>"}'          # -> 200 {"ok":true,…}: posted
//
// SECURITY BUG: remove .fails when fixed.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKeyFor } from "@/lib/accounting/rules";

const saved = { DESK_DATA_DIR: process.env.DESK_DATA_DIR, DEMO_MODE: process.env.DEMO_MODE };
beforeAll(async () => {
  process.env.DESK_DATA_DIR = await mkdtemp(path.join(tmpdir(), "desk-sec-csrf-"));
  delete process.env.DEMO_MODE; // demo books, so nothing leaves the machine
  const { POST } = await import("@/app/api/requests/demo/route");
  for (const body of [{ kind: "reset" }, { kind: "advance", blocks: 64 }]) {
    const res = await POST(new Request("http://desk.test/api/requests/demo", { method: "POST", body: JSON.stringify(body) }));
    if (res.status !== 200) throw new Error(`demo setup failed: ${res.status}`);
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const ID = "DEMO-1042"; // "ready" to post after the demo day + 64 blocks

describe("security: cross-site request forgery on approve-and-post", () => {
  it("the approval key is a pure function of non-secret facts (request ID, kinds, amounts, tx, account codes)", async () => {
    const { planFor } = await import("@/lib/accounting/service");
    const { plan } = await planFor(ID);
    expect(plan.status).toBe("ready");
    // Only what an outsider can know: line kind, amount (invoice / transfer), the transfer's
    // chain:hash:logIndex (public on-chain) and the account code (Xero defaults).
    const outsider = plan.lines.map((l) => ({ kind: l.kind, amount: l.amount, observationKey: l.observationKey, accountCode: l.accountCode })) as typeof plan.lines;
    expect(outsider.filter((l) => l.kind === "payment").every((l) => /^[a-z]+:0x[0-9a-f]{64}:\d+$/.test(l.observationKey ?? ""))).toBe(true);
    const recomputed = idempotencyKeyFor(ID, outsider);
    expect(recomputed).toBe(plan.idempotencyKey);
  });

  // SECURITY BUG: remove .fails when fixed
  it.fails("a cross-site text/plain POST with a recomputed key is refused and nothing is posted", async () => {
    const { planFor, loadAccounting } = await import("@/lib/accounting/service");
    const { plan } = await planFor(ID);
    const key = idempotencyKeyFor(ID, plan.lines); // equal to the outsider's recomputation (test above)
    const { POST } = await import("@/app/api/accounting/[id]/route");
    const res = await POST(new Request(`http://desk.test/api/accounting/${ID}`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ actor: "Attacker", key }),
    }), { params: Promise.resolve({ id: ID }) });
    const acct = await loadAccounting();
    expect(acct.audit.filter((e) => e.requestId === ID && e.kind === "posted"), "forged approval was posted").toHaveLength(0);
    expect(res.status).toBe(403);
  });
});
