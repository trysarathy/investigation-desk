import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { resetDemo, settled } from "./demo";
import { DEMO_E2E } from "./env";
import { runJourney } from "./journey";
import { GUIDE_STEPS } from "../../src/lib/clearline/demo/guide";

/*
 * Records the 13-step demo journey (playwright.demo-video.config.ts, `npm run demo:video`): the video to
 * docs/demo/walkthrough.webm and one screenshot per step to docs/demo/screenshots/NN-<step>.png, from the seeded
 * state. The page checks run in journey.spec.ts; here the journey only pauses on each step's screen so the video
 * can be followed. Demo · fictional data.
 */
const DOCS = path.join(DEMO_E2E.root, "docs/demo");
const SHOTS = path.join(DOCS, "screenshots");

test("record the demo walkthrough", async ({ page }, info) => {
  test.setTimeout(1_200_000);
  resetDemo();
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  const taken: string[] = [];
  await runJourney(page, info, {
    checks: false,
    onStep: async (n) => {
      await settled(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const step = GUIDE_STEPS[n - 1];
      const file = path.join(SHOTS, `${String(n).padStart(2, "0")}-${step.slug}.png`);
      await page.screenshot({ path: file });
      taken.push(file);
      await page.waitForTimeout(1_500); // a pause on each step's screen, for the video
    },
  });
  expect(taken.map((f) => path.basename(f))).toEqual(GUIDE_STEPS.map((s) => `${String(s.n).padStart(2, "0")}-${s.slug}.png`));
  const video = page.video();
  await page.close();
  expect(video).not.toBeNull();
  const out = path.join(DOCS, "walkthrough.webm");
  await video!.saveAs(out);
  const mb = statSync(out).size / 1_048_576;
  console.log(`walkthrough.webm: ${mb.toFixed(1)} MB; ${taken.length} screenshots in docs/demo/screenshots/`);
  expect(mb).toBeLessThan(30);
});
