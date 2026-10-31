// SECURITY BUGS (qa-security-engineer, 31 Oct 2026, origin/main @ 8decb27): two demo/live guards.
//
// (a) POST /api/requests/demo (`src/app/api/requests/demo/route.ts`) has no demo-mode check. In live
//     mode (DEMO_MODE=off) anyone can seed the fictional demo day into the live payment-requests
//     store and rebuild the demo books ("reset", "send", "mine", "advance", "redeliver").
//       DEMO_MODE=off DESK_DATA_DIR=$(mktemp -d) npx next dev -p 3400
//       curl -s -X POST localhost:3400/api/requests/demo -d '{"kind":"reset"}'   # -> {"ok":true}
//
// (b) Two demo switches disagree: `isDemoMode()` (`src/lib/mode.ts`: on unless DEMO_MODE is
//     off/0/false/no/live) and `demoModeOn()` (`src/lib/demo/reset.ts`: only DEMO_MODE === "1").
//     With DEMO_MODE=on (the spelling mode.ts documents as the default) the app is in demo mode
//     but uploads and imports are ACCEPTED, so the shared demo preview can end up holding real data.
//       DEMO_MODE=on DESK_DATA_DIR=$(mktemp -d) npx next dev -p 3400
//       printf 'x\n' > a.csv; curl -s -o /dev/null -w '%{http_code}\n' -F file=@a.csv localhost:3400/api/uploads/A
//       # 422 (parsed and recorded as a rejected upload); with DEMO_MODE=1 the same call is 403
//
// SECURITY BUG: remove .fails when fixed.

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_FILE_A } from "@/lib/demo/files";

const saved = { DESK_DATA_DIR: process.env.DESK_DATA_DIR, DEMO_MODE: process.env.DEMO_MODE };
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "desk-sec-guards-")); process.env.DESK_DATA_DIR = dir; });
afterEach(() => { process.env.DEMO_MODE = saved.DEMO_MODE; if (saved.DEMO_MODE === undefined) delete process.env.DEMO_MODE; });
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("security: demo-only actions in live mode", () => {
  // SECURITY BUG: remove .fails when fixed
  it.fails("POST /api/requests/demo is refused in live mode and writes no demo records", async () => {
    process.env.DEMO_MODE = "off";
    const { POST } = await import("@/app/api/requests/demo/route");
    const res = await POST(new Request("http://desk.test/api/requests/demo", { method: "POST", body: JSON.stringify({ kind: "reset" }) }));
    const file = path.join(dir, "requests.json");
    const body = (await exists(file)) ? await readFile(file, "utf8") : "";
    expect(body.includes("DEMO-"), "demo requests written into the live store").toBe(false);
    expect(res.status).toBe(403);
  });
});

describe("security: DEMO_MODE=on must refuse uploads like DEMO_MODE=1", () => {
  const upload = async () => {
    const { POST } = await import("@/app/api/uploads/[kind]/route");
    const f = new FormData();
    f.set("file", new File([DEMO_FILE_A], "real-customer-file-a.csv", { type: "text/csv" }));
    return POST(new Request("http://desk.test/api/uploads/A", { method: "POST", body: f }), { params: Promise.resolve({ kind: "A" }) });
  };

  it("control: DEMO_MODE=1 refuses the upload (passes today)", async () => {
    process.env.DEMO_MODE = "1";
    const { isDemoMode } = await import("@/lib/mode");
    expect(isDemoMode()).toBe(true);
    expect((await upload()).status).toBe(403);
  });

  // SECURITY BUG: remove .fails when fixed
  it.fails("DEMO_MODE=on (demo mode per isDemoMode) refuses the upload and stores nothing", async () => {
    process.env.DEMO_MODE = "on";
    const { isDemoMode } = await import("@/lib/mode");
    expect(isDemoMode()).toBe(true);
    const res = await upload();
    expect(await exists(path.join(dir, "workspace.json")), "upload stored on a demo-mode server").toBe(false);
    expect(res.status).toBe(403);
  });
});
