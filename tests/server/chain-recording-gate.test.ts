/**
 * rc8: recorded chain data only in test builds. The guard in both modes (a Next build with and without
 * CLEARLINE_TEST_BUILD, and outside a Next build), the client chosen from the environment, the worker/server start
 * check, the build constants in next.config.mjs, and the bundle check script. Test mode · illustrative data.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNoChainRecordingOutsideTestBuild, ChainRecordingRefused, chainRecordingAllowed } from "@/server/test-build";
import { verifyClientFromEnv } from "@/server/chain-verify";
import { recordingOf } from "@/lib/clearline/merchant/chain";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
/** What `next build` inlines (next.config.mjs env), simulated at run time. */
const build = (testBuild: boolean) => { process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = testBuild ? "1" : ""; };
const recordingFile = () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "clearline-rec-")), "chain.json");
  writeFileSync(f, JSON.stringify(recordingOf([])));
  return f;
};

describe("recorded chain data is honoured only in a test build", () => {
  it("a Next build without CLEARLINE_TEST_BUILD refuses a recording; setting the flag at run time does not help", () => {
    build(false);
    expect(chainRecordingAllowed()).toBe(false);
    const f = recordingFile();
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f })).toThrow(ChainRecordingRefused);
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f, CLEARLINE_TEST_BUILD: "1", VITEST: "true" })).toThrow(/honoured only in a test build/);
    expect(() => assertNoChainRecordingOutsideTestBuild({ CLEARLINE_CHAIN_RECORDING: f })).toThrow(ChainRecordingRefused);
    expect(verifyClientFromEnv({}).mode).toBe("none"); // without a recording nothing changes
    expect(() => assertNoChainRecordingOutsideTestBuild({})).not.toThrow();
    process.env.VITEST = "true"; // a Next build ignores the test runner's variable
    expect(chainRecordingAllowed()).toBe(false);
  });

  it("a test build (CLEARLINE_TEST_BUILD=1 at build) and the vitest runner use the recording", () => {
    const f = recordingFile();
    build(true);
    expect(chainRecordingAllowed()).toBe(true);
    expect(verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f }).mode).toBe("recorded");
    expect(() => assertNoChainRecordingOutsideTestBuild({ CLEARLINE_CHAIN_RECORDING: f })).not.toThrow();
    delete process.env.CLEARLINE_NEXT_BUILD; delete process.env.CLEARLINE_TEST_BUILD;
    expect(process.env.VITEST).toBe("true");
    expect(verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: f }).mode).toBe("recorded");
  });

  it("outside a Next build and outside vitest (tsx scripts such as the job worker) a recording is refused", () => {
    delete process.env.CLEARLINE_NEXT_BUILD; delete process.env.VITEST;
    process.env.CLEARLINE_TEST_BUILD = "1"; // a run-time flag is not a test build
    expect(chainRecordingAllowed()).toBe(false);
    expect(() => verifyClientFromEnv({ CLEARLINE_CHAIN_RECORDING: recordingFile() })).toThrow(ChainRecordingRefused);
  });
});

describe("build constants and the bundle check", () => {
  it("next.config.mjs inlines CLEARLINE_NEXT_BUILD and the build's own CLEARLINE_TEST_BUILD", async () => {
    const load = async (flag: string | undefined) => {
      if (flag === undefined) delete process.env.CLEARLINE_TEST_BUILD; else process.env.CLEARLINE_TEST_BUILD = flag;
      const url = `${pathToFileURL(path.resolve(__dirname, "../../next.config.mjs")).href}?t=${flag}-${Math.random()}`;
      return (await import(/* @vite-ignore */ url)).default.env as Record<string, string>;
    };
    expect(await load(undefined)).toMatchObject({ CLEARLINE_NEXT_BUILD: "1", CLEARLINE_TEST_BUILD: "" });
    expect(await load("yes")).toMatchObject({ CLEARLINE_TEST_BUILD: "" }); // only "1" makes a test build
    expect(await load("1")).toMatchObject({ CLEARLINE_NEXT_BUILD: "1", CLEARLINE_TEST_BUILD: "1" });
  });

  it("the check script finds the marker in a server bundle, and only there", async () => {
    // @ts-expect-error plain .mjs script without types
    const { MARKER, serverFilesWithMarker } = await import("../../scripts/build/check-chain-recording.mjs");
    const dir = mkdtempSync(path.join(tmpdir(), "clearline-next-"));
    mkdirSync(path.join(dir, "server", "chunks"), { recursive: true });
    writeFileSync(path.join(dir, "server", "chunks", "a.js"), "module.exports = 1;");
    expect(serverFilesWithMarker(dir)).toEqual({ scanned: 1, hits: [] });
    writeFileSync(path.join(dir, "server", "chunks", "b.js"), `throw new Error("${MARKER}: x")`);
    expect(serverFilesWithMarker(dir)).toEqual({ scanned: 2, hits: [path.join("server", "chunks", "b.js")] });
    // the marker is the one in chain-verify's recording branch
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.resolve(__dirname, "../../src/server/chain-verify.ts"), "utf8")).toContain(MARKER);
  });
});
