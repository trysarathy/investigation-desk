// SECURITY BUG (qa-security-engineer, 31 Oct 2026, origin/main @ 8decb27):
// POST /api/demo/reset has no demo-mode check. On a live deployment (DEMO_MODE=off) one unauthenticated
// POST replaces the company's uploaded Files A and B with the demo files and deletes cases.json and bulk/.
// `src/app/api/demo/reset/route.ts` calls `resetDemoWorkspace` unconditionally.
//
// Manual reproduction (scratch server only):
//   DEMO_MODE=off DESK_DATA_DIR=$(mktemp -d) npx next dev -p 3400
//   # upload a real File A, create a case, then:
//   curl -s -X POST http://localhost:3400/api/demo/reset      # -> {"ok":true}; cases.json and bulk/ gone
//
// The test below is marked it.fails so the suite stays green. SECURITY BUG: remove .fails when fixed.

import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { DESK_DATA_DIR: process.env.DESK_DATA_DIR, DEMO_MODE: process.env.DEMO_MODE };
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "desk-sec-reset-"));
  process.env.DESK_DATA_DIR = dir;
  process.env.DEMO_MODE = "off"; // live mode
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const exists = (p: string) => stat(p).then(() => true, () => false);

describe("security: demo reset in live mode", () => {
  // SECURITY BUG: remove .fails when fixed
  it.fails("POST /api/demo/reset is refused in live mode and leaves the live workspace, cases and bulk runs alone", async () => {
    const workspace = JSON.stringify({ history: [{ marker: "live-upload" }] });
    await writeFile(path.join(dir, "workspace.json"), workspace);
    await writeFile(path.join(dir, "cases.json"), JSON.stringify({ cases: [{ id: "LIVE-CASE-1" }] }));
    await mkdir(path.join(dir, "bulk"), { recursive: true });
    await writeFile(path.join(dir, "bulk", "job-1.json"), "{}");

    const { POST } = await import("@/app/api/demo/reset/route");
    const res = await POST();

    expect(await exists(path.join(dir, "cases.json")), "cases.json deleted").toBe(true);
    expect(await exists(path.join(dir, "bulk", "job-1.json")), "bulk/ deleted").toBe(true);
    expect(res.status).toBe(403);
    expect(await readFile(path.join(dir, "workspace.json"), "utf8")).toBe(workspace);
  });
});
