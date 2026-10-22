// The live workspace: the company's uploaded Files A and B. Server-only.

import "server-only";
import path from "node:path";
import type { Workspace } from "../chain/investigate";
import { demoModeOn, resetDemoWorkspace } from "../demo/reset";
import { FileWorkspaceStore, type WorkspaceData } from "./store";

export const workspaceStore = () => new FileWorkspaceStore(path.join(process.cwd(), ".data", "workspace.json"));

/** The uploaded files as an investigation workspace, or which file is still missing. */
export async function loadWorkspace(customerId?: string): Promise<{ ws?: Workspace; missing: ("A" | "B")[]; data: WorkspaceData }> {
  let data = await workspaceStore().load();
  // The shared demo preview seeds itself on first use.
  if (demoModeOn() && !data.fileA && !data.fileB) {
    await resetDemoWorkspace(workspaceStore());
    data = await workspaceStore().load();
  }
  const missing = [...(data.fileA ? [] : ["A" as const]), ...(data.fileB ? [] : ["B" as const])];
  if (!data.fileA || !data.fileB) return { missing, data };
  return {
    missing,
    data,
    ws: {
      customerId,
      depositAddresses: data.fileA.rows,
      ledger: data.fileB.rows,
      ledgerUploadedAt: data.fileB.upload.uploadedAt,
      fileARejectedRows: data.fileA.upload.rejectedRows,
      fileBRejectedRows: data.fileB.upload.rejectedRows,
    },
  };
}
