/**
 * rc7 phase 3b: the data label on API responses and on every evidence-pack file. A LIVE merchant's responses and its
 * evidence pack (JSON, CSV, PDF: text and metadata) never carry the demo label; a SAMPLE organisation's always do.
 * Live data comes through the real upload pipeline; sample data is the rc6 seed. Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { liveKey, seedSgLive, sgChain, type LiveSg } from "./live-data";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import {
  batchBridge, dailyReport, exceptionsQueue, listMerchantPayments, logMinutes, merchantPaymentDetail, monthEnd, pilotMetrics, recordMatchReview, runReconciliation,
} from "../../src/server/merchant";
import {
  evidencePack, exceptionDetail, exceptionsView, journalExport, listBatches, listMerchantApprovals, merchantShell, monthEndView, paymentContext,
} from "../../src/server/merchant-ui";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { TEST_MODE_LABEL } from "../../src/lib/clearline/merchant/types";
import { LIVE_DATA_LABEL } from "../../src/lib/clearline/data-mode";

let s: LiveSeed;
let live: LiveSg;
let sampleFin: TenantContext, sampleOps: TenantContext;

/** Every text a PDF carries: its raw bytes, its (inflated) content streams and every hex string decoded (WinAnsi or UTF-16). */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const parts = [raw];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const buf = Buffer.from(m[1], "latin1");
    try { parts.push(inflateSync(buf).toString("latin1")); } catch { parts.push(m[1]); }
  }
  const all = parts.join("\n");
  const decoded: string[] = [];
  for (const m of all.matchAll(/<([0-9A-Fa-f\s]{4,})>/g)) {
    const hex = Buffer.from(m[1].replace(/\s/g, ""), "hex");
    decoded.push(hex[0] === 0xfe && hex[1] === 0xff ? Buffer.from(hex.subarray(2)).swap16().toString("utf16le") : hex.toString("latin1"));
  }
  for (const m of all.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) decoded.push(m[1]);
  return `${all}\n${decoded.join("\n")}`;
}
const text = (body: string | Uint8Array, format: string) => (format === "pdf" ? pdfText(body as Uint8Array) : (body as string));
const DEMO = [TEST_MODE_LABEL, "illustrative data", "Test mode"];

beforeAll(async () => {
  useTestStorage();
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-label");
  live = await seedSgLive(s);
  const sample = await seedMerchantCases(ownerDb(), { password: "fictional-test-pass-01" });
  const ctxOf = (email: string) => resolveTenant({ userId: sample.users[email], name: email, email }, MERCHANT_SEED_ORGS.sg.slug);
  sampleFin = await ctxOf("finance@straits-demo.example");
  sampleOps = await ctxOf("ops@straits-demo.example");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(sampleOps, e, liveKey());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

async function responsesOf(c: { fin: TenantContext; ops: TenantContext }, entityId: string) {
  const shell = await merchantShell(c.ops);
  const month = shell.entities.find((e) => e.id === entityId)!.months[0];
  const day = shell.entities.find((e) => e.id === entityId)!.days[0];
  const payments = await listMerchantPayments(c.ops);
  const orderId = payments.find((p) => p.entityId === entityId)!.orderId;
  const batches = await listBatches(c.ops);
  const ex = await exceptionsView(c.ops);
  return {
    month, orderId,
    bodies: {
      shell, payments, batches, ex, approvals: await listMerchantApprovals(c.ops), queue: await exceptionsQueue(c.ops), detail: await merchantPaymentDetail(c.ops, orderId),
      context: await paymentContext(c.ops, orderId), bridge: batches[0] ? await batchBridge(c.ops, batches.find((b) => b.entityId === entityId)!.batchId) : null,
      daily: await dailyReport(c.ops, entityId, day), monthEnd: await monthEnd(c.ops, entityId, month), monthEndView: await monthEndView(c.ops, entityId, month, null),
      exDetail: ex.exceptions[0] ? await exceptionDetail(c.ops, ex.exceptions[0].id) : null, metrics: await pilotMetrics(c.ops),
      review: await recordMatchReview(c.ops, orderId, { verdict: "correct" }, liveKey()), minutes: await logMinutes(c.ops, { day: "2026-11-20", minutes: 5 }, liveKey()),
      run: (await runReconciliation(c.ops, entityId, liveKey(), { chain: sgChain() })).body,
    },
  };
}

describe("a live merchant: 'Your data', never the demo label", () => {
  it("every API response carries 'Your data' and no demo wording", async () => {
    const r = await responsesOf(live, live.entityId);
    for (const [name, body] of Object.entries(r.bodies)) {
      const json = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      for (const d of DEMO) expect(json, name).not.toContain(d);
      if (body && typeof body === "object" && "label" in body) expect((body as { label: string }).label, name).toBe(LIVE_DATA_LABEL);
    }
  });

  it("every evidence-pack file (payment and month; JSON, CSV, PDF text and metadata) and the journal file carry 'Your data' only", async () => {
    const r = await responsesOf(live, live.entityId);
    for (const scope of [{ kind: "payment" as const, orderId: r.orderId }, { kind: "month" as const, entityId: live.entityId, month: r.month }]) {
      for (const format of ["json", "csv", "pdf"] as const) {
        const pack = await evidencePack(live.fin, scope, format);
        const body = text(pack.body, format);
        for (const d of DEMO) expect(body, `${scope.kind} ${format}`).not.toContain(d);
        expect(body, `${scope.kind} ${format}`).toContain(LIVE_DATA_LABEL);
      }
    }
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load((await evidencePack(live.fin, { kind: "payment", orderId: r.orderId }, "pdf")).body as Uint8Array, { updateMetadata: false });
    expect([doc.getSubject(), doc.getProducer()]).toEqual([LIVE_DATA_LABEL, "Clearline"]);
    for (const format of ["csv", "json"] as const) {
      const j = (await journalExport(live.fin, live.entityId, r.month, format)).body;
      for (const d of DEMO) expect(j).not.toContain(d);
    }
  });
});

describe("a sample organisation: always the demo label", () => {
  it("every API response carries the demo label", async () => {
    const r = await responsesOf({ fin: sampleFin, ops: sampleOps }, "ENT-SG-01");
    for (const [name, body] of Object.entries(r.bodies)) {
      if (body && typeof body === "object" && "label" in body) expect((body as { label: string }).label, name).toBe(TEST_MODE_LABEL);
      expect(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), name).not.toContain(LIVE_DATA_LABEL);
    }
  });

  it("every evidence-pack file carries the demo label", async () => {
    for (const scope of [{ kind: "payment" as const, orderId: "BK-24817" }, { kind: "month" as const, entityId: "ENT-SG-01", month: "2026-11" }]) {
      for (const format of ["json", "csv", "pdf"] as const) {
        const body = text((await evidencePack(sampleFin, scope, format)).body, format);
        expect(body, `${scope.kind} ${format}`).toContain(TEST_MODE_LABEL);
        expect(body, `${scope.kind} ${format}`).not.toContain(LIVE_DATA_LABEL);
      }
    }
  });
});
