/**
 * v1: a demo build or a test build refuses to start as a staging or production deployment (src/server/deploy-guard.ts,
 * src/instrumentation.ts), and next.config.mjs refuses to make one. Build constants are simulated as next.config.mjs
 * inlines them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDeployableBuild, buildFlags, DEPLOY_ENV_REQUIRED, deployBuildProblem, DeployBuildRefused } from "@/server/deploy-guard";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const build = (o: { demo?: boolean; test?: boolean }) => {
  process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_DEMO_BUILD = o.demo ? "1" : ""; process.env.CLEARLINE_TEST_BUILD = o.test ? "1" : "";
};
const prod = (deploy?: string) => ({ NODE_ENV: "production", ...(deploy === undefined ? {} : { CLEARLINE_DEPLOY_ENV: deploy }) });

describe("server start: demo and test builds never serve staging or production", () => {
  for (const flags of [{ demo: true }, { test: true }, { demo: true, test: true }]) {
    for (const deploy of ["staging", "production"]) {
      it(`refuses a ${Object.keys(flags).join("+")} build with NODE_ENV=production and CLEARLINE_DEPLOY_ENV=${deploy}`, () => {
        build(flags);
        expect(() => assertDeployableBuild(prod(deploy))).toThrow(DeployBuildRefused);
        expect(deployBuildProblem(prod(deploy))).toMatch(/never serves CLEARLINE_DEPLOY_ENV/);
      });
    }
  }
  it("a plain build starts in staging and production", () => {
    build({});
    expect(() => assertDeployableBuild(prod("staging"))).not.toThrow();
    expect(() => assertDeployableBuild(prod("production"))).not.toThrow();
  });
  it("a demo build still starts locally, for the demo, in CI and outside NODE_ENV=production", () => {
    build({ demo: true });
    for (const d of ["local", "demo", "ci"]) expect(deployBuildProblem(prod(d))).toBeNull();
    expect(deployBuildProblem({ NODE_ENV: "development", CLEARLINE_DEPLOY_ENV: "production" })).toBeNull();
    build({ test: true });
    expect(deployBuildProblem(prod("ci"))).toBeNull();
  });
  it("a misspelt CLEARLINE_DEPLOY_ENV refuses in every build, so a typo cannot switch the check off", () => {
    build({});
    expect(() => assertDeployableBuild(prod("prod"))).toThrow(/CLEARLINE_DEPLOY_ENV is "prod"/);
    build({ demo: true });
    expect(() => assertDeployableBuild(prod("Production"))).toThrow(DeployBuildRefused);
  });
  it("reads the build flags only as inlined constants: outside a Next build there is neither", () => {
    process.env.CLEARLINE_NEXT_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = "1";
    expect(buildFlags()).toEqual({ demo: false, test: false });
    build({ demo: true });
    expect(buildFlags()).toEqual({ demo: true, test: false });
  });
  it("src/instrumentation.ts runs the check at server start and exits on it", () => {
    const s = readFileSync(path.resolve(__dirname, "../../src/instrumentation.ts"), "utf8");
    expect(s).toMatch(/assertDeployableBuild\(\);/);
    expect(s).toMatch(/e instanceof DeployBuildRefused/);
    const flags = readFileSync(path.resolve(__dirname, "../../src/server/deploy-guard.ts"), "utf8");
    expect(flags).toMatch(/process\.env\.CLEARLINE_DEMO_BUILD === "1"/);
    expect(flags).toMatch(/process\.env\.CLEARLINE_TEST_BUILD === "1"/);
  });
});

describe("v1 #165: CLEARLINE_DEPLOY_ENV is required for a production server", () => {
  it("NODE_ENV=production with CLEARLINE_DEPLOY_ENV unset or empty refuses to start, in every build, with a clear message", () => {
    for (const flags of [{}, { demo: true }, { test: true }]) {
      build(flags);
      for (const d of [undefined, ""]) {
        expect(() => assertDeployableBuild(prod(d))).toThrow(DeployBuildRefused);
        expect(deployBuildProblem(prod(d))).toBe(DEPLOY_ENV_REQUIRED);
      }
    }
    expect(DEPLOY_ENV_REQUIRED).toMatch(/CLEARLINE_DEPLOY_ENV is not set/);
    expect(DEPLOY_ENV_REQUIRED).toMatch(/production or staging on a real deployment, or local, ci or demo/);
  });
  it("every named environment starts a plain build; next dev and tests (not NODE_ENV=production) need none", () => {
    build({});
    for (const d of ["local", "ci", "demo", "staging", "production"]) expect(deployBuildProblem(prod(d))).toBeNull();
    for (const n of ["development", "test", undefined]) expect(deployBuildProblem({ NODE_ENV: n })).toBeNull();
  });
  it("test servers say local or ci, never staging, production or demo", async () => {
    const { testDeployEnv } = await import("../deploy-env");
    expect(testDeployEnv({})).toBe("local");
    expect(testDeployEnv({ CI: "true" })).toBe("ci");
    expect(testDeployEnv({ CLEARLINE_DEPLOY_ENV: "ci" })).toBe("ci");
    for (const v of ["production", "staging", "demo", "prod"]) expect(() => testDeployEnv({ CLEARLINE_DEPLOY_ENV: v })).toThrow(/local or ci/);
  });
  it("every Playwright web server, spawned test server, the demo and every CI job set it", () => {
    const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
    for (const f of ["playwright.clearline.config.ts", "playwright.rc3-console.config.ts", "playwright.mentor.config.ts", "playwright.funding.config.ts", "tests/qa-release-v2/playwright.qa-v2.config.ts",
      "tests/e2e-control/env.ts", "tests/e2e-merchant/env.ts", "tests/platform/server.ts"]) expect(read(f), f).toMatch(/CLEARLINE_DEPLOY_ENV: testDeployEnv\(\)/);
    expect(read("scripts/demo/lib.ts")).toMatch(/CLEARLINE_DEPLOY_ENV: "demo"/);
    for (const f of ["ci.yml", "clearline-browser.yml", "control-e2e.yml", "funding-browser.yml", "funding-replay.yml", "mentor-browser.yml", "merchant-e2e.yml"])
      expect(read(`.github/workflows/${f}`), f).toMatch(/CLEARLINE_DEPLOY_ENV: ci/);
  });
});

describe("next.config.mjs (build time)", () => {
  const problems = async (vars: Record<string, string | undefined>) => {
    const url = `${pathToFileURL(path.resolve(__dirname, "../../next.config.mjs")).href}?t=${Math.random()}`;
    const { deploymentConfigProblems } = await import(/* @vite-ignore */ url);
    return deploymentConfigProblems(vars) as string[];
  };
  it("refuses to build a demo or test build for staging or production, and a misspelt deploy environment", async () => {
    const pilot = { CLEARLINE_CONTROL_PILOT: "1", BETTER_AUTH_SECRET: "x".repeat(40), CLEARLINE_ORIGIN: "https://pilot.example", DATABASE_URL: "postgres://clearline_runtime:x@db/x" };
    expect((await problems({ ...pilot, CLEARLINE_DEMO_BUILD: "1", CLEARLINE_DEPLOY_ENV: "production" })).join("\n")).toMatch(/never serves staging or production/);
    expect((await problems({ CLEARLINE_TEST_BUILD: "1", CLEARLINE_DEPLOY_ENV: "staging" })).join("\n")).toMatch(/never serves staging or production/);
    expect((await problems({ CLEARLINE_DEPLOY_ENV: "prod" })).join("\n")).toMatch(/use one of local, ci, demo, staging, production/);
    expect(await problems({ CLEARLINE_DEPLOY_ENV: "production" })).toEqual([]);
    expect(await problems({ ...pilot, CLEARLINE_DEMO_BUILD: "1", CLEARLINE_DEPLOY_ENV: "demo" })).toEqual([]);
  });
});
