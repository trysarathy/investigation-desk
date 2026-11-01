import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { isDemoMode } from "@/lib/mode";
describe("probe", () => {
  for (const v of ["off", "OFF", "off ", "0", "false", "live", "no"]) it(`DEMO_MODE=${JSON.stringify(v)}`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "desk-p4-"));
    process.env.DESK_DATA_DIR = dir; process.env.DEMO_MODE = v;
    await writeFile(path.join(dir, "cases.json"), "{}"); await mkdir(path.join(dir, "bulk"));
    const { POST } = await import("@/app/api/demo/reset/route");
    const res = await POST();
    const kept = await stat(path.join(dir, "cases.json")).then(() => true, () => false);
    console.log("PROBE", JSON.stringify(v), "isDemoMode", isDemoMode(), "status", res.status, "cases.json kept", kept);
  });
});
