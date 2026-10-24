// The live payment records, inbox and audit log, and how matching reaches the chains. Server-only.

import "server-only";
import path from "node:path";
import { loadCases } from "../bulk/cases";
import { liveDeps, liveKeysPresent } from "../chain/live";
import { demoDeps } from "../demo/deps";
import { caseRows, storedCaseRows } from "../view";
import { workspaceStore } from "../workspace/live";
import { FileAuditLog } from "./audit";
import type { DepositCaseRow } from "./exceptions";
import { refreshMatching, type RefreshOpts } from "./refresh";
import { FilePaymentsStore, ledgerFromFileB, type PaymentsData } from "./store";
import { FileInboxStore, rematchInto, syncAll, type Stores, type Who } from "./workflow";
import { dataDir } from "../data-dir";

const DATA = () => dataDir();
export const paymentsStore = () => new FilePaymentsStore(path.join(DATA(), "payments.json"));
export const inboxStore = () => new FileInboxStore(path.join(DATA(), "inbox.json"));
export const auditLog = () => new FileAuditLog(path.join(DATA(), "audit.jsonl"));
export const stores = (): Stores => ({ payments: paymentsStore(), inbox: inboxStore(), audit: auditLog() });

/** Matching on given data: chain lookups for unresolved hashes, then the matcher. The ledger leg also reads File B. */
export async function rematchData(data: PaymentsData, progress: Pick<RefreshOpts, "onLookup" | "beforeMatch"> = {}): Promise<PaymentsData> {
  const ws = await workspaceStore().load();
  const ledger = ws.fileB ? ledgerFromFileB(ws.fileB.rows, ws.fileB.upload.sha256, ws.fileB.upload.uploadedAt) : [];
  // Without chain keys, the demo workspace replays its recorded chain responses; anything else is looked up live.
  const deps = !liveKeysPresent() && ws.demo ? demoDeps() : liveDeps();
  // File A says which addresses are the company's deposit addresses (and since when): transfers
  // into them are inbound. No File A: undefined, so deposit rows wait instead of being dropped.
  const depositAddresses = ws.fileA?.rows.map((r) => ({ chain: r.chain, address: r.address, assignedAt: r.assignedAt, retiredAt: r.retiredAt }));
  return refreshMatching(data, deps, ledger, undefined, { depositAddresses, ...progress });
}

/** Re-run matching on what is held, save it, and bring the inbox up to date (inline; the app uses jobs.ts). */
export async function rematch(): Promise<PaymentsData> {
  const next = await rematchInto(paymentsStore(), (d) => rematchData(d));
  await refreshInbox();
  return next;
}

/** The deposit queue's cases (live ones from bulk runs, then the sample cases), as the inbox reads them. */
export async function depositRows(now = new Date()): Promise<DepositCaseRow[]> {
  return [...storedCaseRows(await loadCases(), now), ...caseRows()];
}

export async function refreshInbox(now = new Date()) {
  return syncAll(stores(), { now, cases: await depositRows(now) });
}

/** Who is acting: the name given in the app (self-declared until sign-in) and the caller's IP. */
export function whoFrom(req: Request, actor: unknown): Who {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
  return { actor: typeof actor === "string" ? actor : "", ...(ip ? { ip } : {}) };
}
