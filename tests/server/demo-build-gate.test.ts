/**
 * Demo build: recorded chain data and the demo conveniences only in a build made with CLEARLINE_DEMO_BUILD=1, and in
 * such a build only for an organisation whose data mode is 'demo'. The build constants are simulated at run time the
 * way next.config.mjs inlines them (as in chain-recording-gate.test.ts). Demo · fictional data.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNoChainRecordingOutsideTestBuild, ChainRecordingRefused } from "@/server/test-build";
import { assertDemoBuildOffline, demoBuild, DemoNetworkRefused, DemoRecordingRefused } from "@/server/demo-build";
import { verifyClientFromEnv } from "@/server/chain-verify";
import { recordingOf } from "@/lib/clearline/merchant/chain";
import { DEMO_DATA_LABEL, LIVE_DATA_LABEL, dataLabel, isDataMode, usesUploadPipeline } from "@/lib/clearline/data-mode";
import { TEST_MODE_LABEL } from "@/lib/clearline/merchant/types";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const build = (o: { test?: boolean; demo?: boolean }) => {
  process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = o.test ? "1" : ""; process.env.CLEARLINE_DEMO_BUILD = o.demo ? "1" : "";
};
const recordingFile = () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "clearline-demo-rec-")), "chain.json");
  writeFileSync(f, JSON.stringify(recordingOf([])));
  return f;
};

describe("data modes and labels", () => {
  it("the demo label is exactly 'Demo · fictional data', only for the demo mode", () => {
    expect(dataLabel("demo")).toBe("Demo · fictional data");
    expect(DEMO_DATA_LABEL).toBe("Demo · fictional data");
    expect(dataLabel("live")).toBe(LIVE_DATA_LABEL);
    expect(dataLabel("sample")).toBe(TEST_MODE_LABEL);
    expect(dataLabel("live")).not.toBe(DEMO_DATA_LABEL);
    expect(isDataMode("demo")).toBe(true);
    expect(isDataMode("Demo")).toBe(false);
    expect([usesUploadPipeline("live"), usesUploadPipeline("demo"), usesUploadPipeline("sample")]).toEqual([true, true, false]);
  });
});

describe("recorded chain data in a demo build", () => {
  it("a real build (no demo, no test flag) refuses a recording for a demo organisation, at start and per call", () => {
    build({});
    expect(demoBuild()).toBe(false);
    const f = recordingFile();
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f }, "demo")).toThrow(ChainRecordingRefused);
    expect(() => assertNoChainRecordingOutsideTestBuild({ CLEARLINE_CHAIN_RECORDING: f })).toThrow(ChainRecordingRefused);
    // run-time flags do not make a demo build: only the inlined constant does
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f, CLEARLINE_DEMO_BUILD: "1" }, "demo")).toThrow(ChainRecordingRefused);
  });

  it("a demo build starts with a recording but refuses it for a live or a sample organisation", () => {
    build({ demo: true });
    expect(demoBuild()).toBe(true);
    const f = recordingFile();
    expect(() => assertNoChainRecordingOutsideTestBuild({ CLEARLINE_CHAIN_RECORDING: f })).not.toThrow();
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f }, "live")).toThrow(DemoRecordingRefused);
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f }, "sample")).toThrow(DemoRecordingRefused);
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f })).toThrow(DemoRecordingRefused);
    expect(verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f }, "demo").mode).toBe("recorded");
    expect(verifyClientFromEnv({}, "live").mode).toBe("none"); // no recording: nothing changes
  });

  it("outside a Next build there is no demo build", () => {
    delete process.env.CLEARLINE_NEXT_BUILD; process.env.CLEARLINE_DEMO_BUILD = "1";
    expect(demoBuild()).toBe(false);
  });

  it("a demo build refuses to start with live chain reads or the ledger pull (network)", () => {
    build({ demo: true });
    expect(() => assertDemoBuildOffline({ CLEARLINE_CHAIN_LIVE: "1" })).toThrow(DemoNetworkRefused);
    expect(() => assertDemoBuildOffline({ CLEARLINE_LEDGER_PULL: "1" })).toThrow(DemoNetworkRefused);
    expect(() => assertDemoBuildOffline({})).not.toThrow();
    build({});
    expect(() => assertDemoBuildOffline({ CLEARLINE_CHAIN_LIVE: "1" })).not.toThrow(); // not a demo build: unchanged
  });
});

describe("next.config.mjs", () => {
  const load = async (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    const url = `${pathToFileURL(path.resolve(__dirname, "../../next.config.mjs")).href}?t=${Math.random()}`;
    return import(/* @vite-ignore */ url);
  };
  it("inlines CLEARLINE_DEMO_BUILD only when it is exactly 1", async () => {
    expect((await load({ CLEARLINE_DEMO_BUILD: undefined })).default.env).toMatchObject({ CLEARLINE_DEMO_BUILD: "" });
    const pilot = { CLEARLINE_CONTROL_PILOT: "1", BETTER_AUTH_SECRET: "x".repeat(40), CLEARLINE_ORIGIN: "http://127.0.0.1:3100", DATABASE_URL: "postgres://clearline_runtime@127.0.0.1/x" };
    expect((await load({ ...pilot, CLEARLINE_DEMO_BUILD: "1" })).default.env).toMatchObject({ CLEARLINE_DEMO_BUILD: "1" });
    expect((await load({ ...pilot, CLEARLINE_DEMO_BUILD: "true" }).catch((e: Error) => e.message))).toMatch(/only "1" makes a demo build/);
  });
  it("refuses a demo build without the pilot, combined with a test build, or with network flags", async () => {
    const { deploymentConfigProblems } = await load({});
    const pilot = { CLEARLINE_CONTROL_PILOT: "1", BETTER_AUTH_SECRET: "x".repeat(40), CLEARLINE_ORIGIN: "http://127.0.0.1:3100", DATABASE_URL: "postgres://clearline_runtime@127.0.0.1/x" };
    expect(deploymentConfigProblems({ CLEARLINE_DEMO_BUILD: "1" }).join()).toMatch(/needs CLEARLINE_CONTROL_PILOT=1/);
    expect(deploymentConfigProblems({ ...pilot, CLEARLINE_DEMO_BUILD: "yes" }).join()).toMatch(/only "1" makes a demo build/);
    expect(deploymentConfigProblems({ ...pilot, CLEARLINE_DEMO_BUILD: "1", CLEARLINE_TEST_BUILD: "1" }).join()).toMatch(/either a demo build or a test build/);
    expect(deploymentConfigProblems({ ...pilot, CLEARLINE_DEMO_BUILD: "1", CLEARLINE_CHAIN_LIVE: "1" }).join()).toMatch(/runs offline/);
    expect(deploymentConfigProblems({ ...pilot, CLEARLINE_DEMO_BUILD: "1" })).toEqual([]);
  });
  it("the bundle check knows the demo marker, which sits in the demo branch of chain-verify", async () => {
    // @ts-expect-error plain .mjs script without types
    const { DEMO_MARKER, serverFilesWithMarker } = await import("../../scripts/build/check-chain-recording.mjs");
    const { readFileSync, mkdirSync } = await import("node:fs");
    expect(readFileSync(path.resolve(__dirname, "../../src/server/chain-verify.ts"), "utf8")).toContain(DEMO_MARKER);
    const dir = mkdtempSync(path.join(tmpdir(), "clearline-next-demo-"));
    mkdirSync(path.join(dir, "server"), { recursive: true });
    writeFileSync(path.join(dir, "server", "a.js"), `x("${DEMO_MARKER}")`);
    expect(serverFilesWithMarker(dir, DEMO_MARKER).hits).toEqual([path.join("server", "a.js")]);
    expect(serverFilesWithMarker(dir).hits).toEqual([]);
  });
});
