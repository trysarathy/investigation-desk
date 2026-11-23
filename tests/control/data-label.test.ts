/**
 * rc7: the merchant screens' data label follows the organisation's data mode: "Your data" for a live merchant (never
 * the demo label), "Test mode · illustrative data" for sample organisations (unchanged from rc6). Fictional data.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import { merchantShell } from "../../src/server/merchant-ui";
import { uploadsOverview } from "../../src/server/upload-ui";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { resolveTenant } from "../../src/server/tenant";
import { TEST_MODE_LABEL } from "../../src/lib/clearline/merchant/types";

let s: LiveSeed;
let sampleUsers: Record<string, string>;
beforeAll(async () => {
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-dl");
  const r = await seedMerchantCases(ownerDb(), { password: "fictional-test-pass-01" });
  sampleUsers = r.users;
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

it("a live merchant shows 'Your data'; a sample merchant keeps the demo label", async () => {
  const live = await merchantShell(await liveCtx(s, "finance@live-a.example", "a"));
  expect(live).toMatchObject({ label: "Your data", dataMode: "live", kind: "merchant" });
  expect(JSON.stringify(live)).not.toContain(TEST_MODE_LABEL);
  expect(await uploadsOverview(await liveCtx(s, "viewer@live-a.example", "a"))).toMatchObject({ label: "Your data", dataMode: "live", retentionDays: 90, uploads: [] });
  const email = "finance@straits-demo.example";
  const sample = await merchantShell(await resolveTenant({ userId: sampleUsers[email], name: email, email }, MERCHANT_SEED_ORGS.sg.slug));
  expect(sample).toMatchObject({ label: TEST_MODE_LABEL, dataMode: "sample" });
});
