// The live payment records and how matching reaches the chains. Server-only.

import "server-only";
import path from "node:path";
import { liveDeps, liveKeysPresent } from "../chain/live";
import { demoDeps } from "../demo/deps";
import { workspaceStore } from "../workspace/live";
import { FilePaymentsStore, ledgerFromFileB } from "./store";
import { refreshAndSave } from "./refresh";

export const paymentsStore = () => new FilePaymentsStore(path.join(process.cwd(), ".data", "payments.json"));

/** Re-run matching: chain lookups for new hashes, then the matcher. The ledger leg reads File B. */
export async function rematch() {
  const ws = await workspaceStore().load();
  const ledger = ws.fileB ? ledgerFromFileB(ws.fileB.rows, ws.fileB.upload.sha256, ws.fileB.upload.uploadedAt) : [];
  // Without chain keys, the demo workspace replays its recorded chain responses; anything else is looked up live.
  const deps = !liveKeysPresent() && ws.demo ? demoDeps() : liveDeps();
  return refreshAndSave(paymentsStore(), deps, ledger);
}
