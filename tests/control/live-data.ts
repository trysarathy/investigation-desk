/**
 * rc7 phase 3b test helper: one LIVE merchant's Singapore entity filled through the real upload pipeline (orders,
 * provider export, per-payment settlement, CSV statement confirmed by a second person), then reconciled against
 * recorded chain data (a recording client, as a chain reader would see it). Fictional values from upload-scenarios.ts.
 */
import * as sc from "./upload-scenarios";
import { accountFields, liveCtx, type LiveSeed } from "./upload-harness";
import type { TenantContext } from "../../src/server/tenant";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { runReconciliation } from "../../src/server/merchant";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";
import { RecordingChainClient, recordingOf } from "../../src/lib/clearline/merchant/chain";
import type { ChainTransfer } from "../../src/lib/clearline/merchant/types";

/** SG chain data as a reader recorded it (the scenario's observed transfers plus SG-1004's), for runs of the live entity. */
export function sgChain() {
  const seen = sc.observedTransfers(sc.SG);
  const o4 = sc.SG.orders[3];
  const all: ChainTransfer[] = [...seen, { ...seen[0], txHash: sc.hash(o4.payment!.txIndex), to: o4.address, amountBaseUnits: 500_000_000n, block: 70_100, timestamp: o4.payment!.paidAt, confirmations: 50 }];
  return new RecordingChainClient(recordingOf(all), { now: "2026-11-21T00:00:00.000Z" });
}

let n = 0;
export const liveKey = (tag = "live") => `${tag}-${++n}-${Date.now()}`;

export async function pushFile(uploader: TenantContext, confirmer: TenantContext, entityId: string, fileType: FileType, fileName: string, bytes: Uint8Array, mapping?: Mapping) {
  const up = await createUpload(uploader, { entityId, fileType, fileName, bytes, ...(await accountFields(uploader, entityId, fileType)) }, liveKey());
  if (mapping) await setUploadMapping(uploader, up.upload.id, { mapping }, liveKey());
  const v = (await validateUpload(uploader, up.upload.id, liveKey())).body;
  await decideUpload(confirmer, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, liveKey());
  await normaliseUpload(confirmer, up.upload.id, liveKey());
  return up.upload.id;
}

export interface LiveSg { fin: TenantContext; ops: TenantContext; approver: TenantContext; admin: TenantContext; viewer: TenantContext; entityId: string; uploadIds: string[]; runId: string }

/** Fill merchant A's SGD entity and reconcile once (Payment Operations). `marker` is written into the files' free text. */
export async function seedSgLive(s: LiveSeed, marker = "ZQX-LIVE-MARKER"): Promise<LiveSg> {
  const [fin, ops, approver, admin, viewer] = await Promise.all([liveCtx(s, "finance@live-a.example", "a"), liveCtx(s, "ops@live-a.example", "a"), liveCtx(s, "approver@live-a.example", "a"),
    liveCtx(s, "admin@live-a.example", "a"), liveCtx(s, "viewer@live-a.example", "a")]);
  const entityId = sc.SG.entityId;
  const uploadIds = [
    await pushFile(fin, fin, entityId, "orders_invoices", "orders.csv", sc.sgOrdersCsv(), sc.SG_ORDERS_MAPPING),
    await pushFile(ops, ops, entityId, "provider_export", "Export Nov (fictional).csv", sc.sgExportCsv(marker), sc.SG_EXPORT_MAPPING),
    await pushFile(fin, fin, entityId, "settlement_report", "payouts.csv", sc.sgSettlementCsv(), sc.SG_SETTLEMENT_MAPPING),
    await pushFile(fin, approver, entityId, "bank_statement", "statement.csv", sc.sgBankCsv(marker), sc.SG_BANK_MAPPING),
  ];
  const run = (await runReconciliation(ops, entityId, liveKey(), { chain: sgChain() })).body;
  return { fin, ops, approver, admin, viewer, entityId, uploadIds, runId: run.runId };
}
