// approvePosting through the real file stores, on a scratch data directory in demo mode. Two people
// approving two invoices at the same moment both get their postings, and neither waits on the other.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { dir: process.env.DESK_DATA_DIR, mode: process.env.DEMO_MODE };
beforeAll(async () => {
  process.env.DESK_DATA_DIR = await mkdtemp(path.join(tmpdir(), "desk-approve-"));
  delete process.env.DEMO_MODE;
  const { demoAction, actOnRequest } = await import("@/lib/requests/service");
  await demoAction({ kind: "reset" });
  await demoAction({ kind: "advance", blocks: 64 });
  // DEMO-1047 was paid twice: decide the excess is refunded, so it is ready to post too.
  await actOnRequest("DEMO-1047", { kind: "decide", decision: { kind: "refund_excess", note: "Refund agreed with the customer." } }, "Mei Tan (Finance ops)");
});
afterAll(() => {
  if (saved.dir === undefined) delete process.env.DESK_DATA_DIR; else process.env.DESK_DATA_DIR = saved.dir;
  if (saved.mode === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = saved.mode;
});

describe("approve and post", () => {
  it("two approvals at the same moment both post", async () => {
    const { approvePosting, planFor } = await import("@/lib/accounting/service");
    const [a, b] = await Promise.all([planFor("DEMO-1042"), planFor("DEMO-1047")]);
    expect([a.plan.status, b.plan.status]).toEqual(["ready", "ready"]);
    const res = await Promise.all([
      approvePosting("DEMO-1042", "Mei Tan (Finance ops)", a.plan.idempotencyKey),
      approvePosting("DEMO-1047", "Arjun Rao (Controller)", b.plan.idempotencyKey),
    ]);
    expect(res.map((r) => r.error)).toEqual([undefined, undefined]);
    expect(res.map((r) => r.message)).toEqual(["Posted 2 line(s) to the demo books.", `Posted ${b.plan.lines.length} line(s) to the demo books.`]);
  });

  it("PROBE after", async () => {
    const { planFor, loadAccounting } = await import("@/lib/accounting/service");
    const acct = await loadAccounting();
    for (const id of ["DEMO-1042", "DEMO-1047"]) {
      const posted = acct.audit.filter((e) => e.requestId === id && e.kind === "posted").length;
      const approved = acct.audit.filter((e) => e.requestId === id && e.kind === "approved").length;
      console.log("PROBE", id, "approved", approved, "posted", posted, "plan now", (await planFor(id)).plan.status);
    }
  });

  it("a changed plan is refused, not posted", async () => {
    const { approvePosting } = await import("@/lib/accounting/service");
    expect((await approvePosting("DEMO-1045", "Mei Tan (Finance ops)", "clearline-stale")).error).toBeTruthy();
  });
});
