import { defineConfig } from "@playwright/test";
import base from "./playwright.demo.config";

/**
 * The demo walkthrough recording (`npm run demo:video`): the 13-step journey (tests/e2e-demo/journey.ts) at 1440 px on
 * the demo build, recorded to docs/demo/walkthrough.webm, with one screenshot per step (deviceScaleFactor 2) in
 * docs/demo/screenshots/NN-<step>.png. Same web server and demo database as playwright.demo.config.ts (it resets to
 * the seeded state first). Demo · fictional data.
 */
const desktop = base.projects!.find((p) => p.name === "desktop")!.use!;
export default defineConfig({
  ...base,
  testMatch: "walkthrough.record.ts",
  projects: [{
    name: "walkthrough",
    use: {
      ...desktop,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      video: { mode: "on", size: { width: 1440, height: 900 } },
      launchOptions: { ...(base.use?.launchOptions ?? {}), slowMo: 120 },
    },
  }],
});
