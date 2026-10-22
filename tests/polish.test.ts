// Decisions after Week 4: AI model default, reporting customer, BSC-USD sample setting, demo mode.

import { mkdtemp, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aiModelId, DEFAULT_MODEL, requestParams } from "@/lib/ai/anthropic";
import { fetchFacts, type Workspace } from "@/lib/chain/investigate";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { parseReportingCustomer, validateBulk, validateFileA, validateFileB } from "@/lib/csv/files";
import { DEMO_BULK_CSV, DEMO_FILE_A, DEMO_FILE_B, DEMO_STEPS } from "@/lib/demo/files";
import { RECORDINGS } from "@/lib/demo/recordings";
import { resetDemoWorkspace } from "@/lib/demo/reset";
import { demoTransport } from "@/lib/demo/transport";
import { investigate } from "@/lib/engine/run";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { applyUpload, MemoryWorkspaceStore } from "@/lib/workspace/store";

const enc = (s: string) => new TextEncoder().encode(s);

describe("AI model", () => {
  const saved = process.env.AI_MODEL;
  afterEach(() => { if (saved === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = saved; });

  it("defaults to claude-haiku-5-5 and is overridable with AI_MODEL", () => {
    delete process.env.AI_MODEL;
    expect(DEFAULT_MODEL).toBe("claude-haiku-5-5");
    expect(aiModelId()).toBe("claude-haiku-5-5");
    process.env.AI_MODEL = "claude-opus-5-5";
    expect(aiModelId()).toBe("claude-opus-5-5");
  });

  it("sends server-side fallbacks only to models that support them (not Haiku)", () => {
    const input = { code: "D12", evidence: [], template: null };
    const haiku = requestParams("claude-haiku-5-5", input);
    expect("fallbacks" in haiku).toBe(false);
    expect("betas" in haiku).toBe(false);
    const opus = requestParams("claude-opus-5-5", input);
    expect(opus).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(haiku.output_config).toEqual(opus.output_config);
  });
});

describe("reporting customer", () => {
  it.each([
    [undefined, {}],
    ["", {}],
    ["C-10422", { customerId: "C-10422" }],
    [" C-10422", { error: "Reporting customer has leading or trailing spaces." }],
    ["jane@example.com", { error: expect.stringMatching(/^Reporting customer: Looks like an email/) }],
  ])("%s", (raw, out) => expect(parseReportingCustomer(raw as string | undefined)).toEqual(out));
});

// ---- Demo workspace ----

async function demoWorkspace(customerId?: string): Promise<Workspace> {
  const a = validateFileA(enc(DEMO_FILE_A));
  const b = validateFileB(enc(DEMO_FILE_B));
  return { customerId, depositAddresses: a.rows, ledger: b.rows, ledgerUploadedAt: "2026-10-22T09:00:00Z",
    fileARejectedRows: a.rowErrors.length, fileBRejectedRows: b.rowErrors.length };
}
const recordedOnly = () => buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
  transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true });

describe("demo workspace", () => {
  it("demo files are valid: every row accepted", () => {
    const a = validateFileA(enc(DEMO_FILE_A));
    const b = validateFileB(enc(DEMO_FILE_B));
    expect([a.fileErrors, a.rowErrors, b.fileErrors, b.rowErrors]).toEqual([[], [], [], []]);
    expect(a.rows).toHaveLength(7);
    expect(b.rows).toHaveLength(2);
  });

  it.each(DEMO_STEPS.map((s) => [s.note, s] as const))("%s", async (_, step) => {
    const facts = await fetchFacts(step.hash, await demoWorkspace(step.customer), recordedOnly(), SAMPLE_SETTINGS);
    const v = investigate(facts, SAMPLE_SETTINGS);
    expect(v.code).toBe(step.expect);
    expect(v.state).toBe("verdict");
    expect(v.confidence).toBe("High");
  });

  it("step 2's D12 cites a real explorer link and the customer from File A", async () => {
    const facts = await fetchFacts(DEMO_STEPS[0].hash, await demoWorkspace(), recordedOnly(), SAMPLE_SETTINGS);
    const v = investigate(facts, SAMPLE_SETTINGS);
    expect(v.evidence.find((e) => e.id === "ev.tx")!.source).toEqual({ kind: "explorer", url: `https://tronscan.org/#/transaction/${DEMO_STEPS[0].hash}` });
    expect(v.evidence.find((e) => e.id === "ev.input")!.value).toMatch(/^Customer C-DEMO-01, taken from File A line 2/);
  });

  it("a hash that wasn't recorded pauses when there are no keys: never a guess", async () => {
    const facts = await fetchFacts("cd".repeat(32), await demoWorkspace(), recordedOnly(), SAMPLE_SETTINGS);
    expect(investigate(facts, SAMPLE_SETTINGS).state).toBe("paused");
  });

  it("the demo bulk file has each demo hash once and one row that is skipped", () => {
    const v = validateBulk(enc(DEMO_BULK_CSV));
    expect(v.rows).toHaveLength(new Set(DEMO_STEPS.map((s) => s.hash)).size);
    expect(v.rowErrors).toHaveLength(1);
  });
});

describe("demo reset", () => {
  it("loads the demo files, flags the workspace, and clears demo cases and bulk runs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "demo-"));
    await writeFile(path.join(dir, "cases.json"), "[]");
    await mkdir(path.join(dir, "bulk"));
    const store = new MemoryWorkspaceStore();
    await resetDemoWorkspace(store, new Date("2026-10-22T10:00:00Z"), dir);
    const data = await store.load();
    expect(data.demo).toBe(true);
    expect(data.fileA!.rows).toHaveLength(7);
    expect(data.fileB!.rows).toHaveLength(2);
    await expect(stat(path.join(dir, "cases.json"))).rejects.toThrow();
    await expect(stat(path.join(dir, "bulk"))).rejects.toThrow();
  });

  it("is repeatable, and a real upload ends demo mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "demo-"));
    const store = new MemoryWorkspaceStore();
    await resetDemoWorkspace(store, new Date(), dir);
    await resetDemoWorkspace(store, new Date(), dir);
    expect((await store.load()).demo).toBe(true);
    await applyUpload(store, "A", "real.csv", validateFileA(enc("address,chain,customer_id,assigned_at,retired_at\nTR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t,tron,C-1,2024-01-01T00:00:00Z,\n")), new Date());
    expect((await store.load()).demo).toBe(false);
  });
});
