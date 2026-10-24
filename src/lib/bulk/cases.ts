// Cases created from a bulk run ("Create cases for non-credited"). Stored under .data/ until the
// database lands; they appear in the queue and open as live investigations.

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileLockKey, withLock, writeAtomic } from "../lock";
import type { Chain, Code, Confidence } from "../types";
import { dataDir } from "../data-dir";

export interface StoredCase {
  id: string;
  txHash: string;
  customerId?: string;
  createdAt: string;
  code?: Code;
  label: string;
  confidence: Confidence | null;
  paused: boolean;
  chain?: Chain;
  token?: string;
  amount?: string;
  fromJob: string;
}

const FILE = () => path.join(dataDir(), "cases.json");

export async function loadCases(): Promise<StoredCase[]> {
  try {
    return JSON.parse(await readFile(FILE(), "utf8")) as StoredCase[];
  } catch {
    return [];
  }
}

/** Adds cases, skipping any hash + customer already open, so repeated clicks don't duplicate. */
export function addCases(cases: StoredCase[]): Promise<number> {
  return withLock(fileLockKey(FILE()), async () => {
    const existing = await loadCases();
    const key = (c: { txHash: string; customerId?: string }) => `${c.txHash.replace(/^0x/i, "").toLowerCase()}|${c.customerId ?? ""}`;
    const seen = new Set(existing.map(key));
    const fresh = cases.filter((c) => !seen.has(key(c)));
    await writeAtomic(FILE(), JSON.stringify([...fresh, ...existing]));
    return fresh.length;
  });
}
