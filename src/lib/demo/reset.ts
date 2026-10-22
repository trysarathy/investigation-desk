// Seeds (or re-seeds) the demo workspace: the demo Files A and B go through the same validator
// and store as a real upload, and cases and bulk runs created during a demo are cleared.

import "server-only";
import { rm } from "node:fs/promises";
import path from "node:path";
import { validateFileA, validateFileB } from "../csv/files";
import { applyUpload, type WorkspaceStore } from "../workspace/store";
import { DEMO_FILE_A, DEMO_FILE_B } from "./files";

const enc = (s: string) => new TextEncoder().encode(s);

export async function resetDemoWorkspace(store: WorkspaceStore, now = new Date(),
  dataDir = path.join(process.cwd(), ".data")): Promise<void> {
  await store.save({ history: [] });
  await applyUpload(store, "A", "demo-file-a.csv", validateFileA(enc(DEMO_FILE_A)), now);
  await applyUpload(store, "B", "demo-file-b.csv", validateFileB(enc(DEMO_FILE_B)), now);
  const data = await store.load();
  await store.save({ ...data, demo: true });
  await rm(path.join(dataDir, "cases.json"), { force: true });
  await rm(path.join(dataDir, "bulk"), { recursive: true, force: true });
}

/** DEMO_MODE=1: the shared preview. It seeds itself and refuses uploads, so it never holds real data. */
export const demoModeOn = () => process.env.DEMO_MODE === "1";
