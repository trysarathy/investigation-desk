// Cases created from a bulk run ("Create cases for non-credited"). Stored under .data/ until the
// database lands; they appear in the queue and open as live investigations.

import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Chain, Code, Confidence } from "../types";

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

const FILE = () => path.join(process.cwd(), ".data", "cases.json");

export async function loadCases(): Promise<StoredCase[]> {
  try {
    return JSON.parse(await readFile(FILE(), "utf8")) as StoredCase[];
  } catch {
    return [];
  }
}

/** Adds cases, skipping any hash + customer already open, so repeated clicks don't duplicate. */
export async function addCases(cases: StoredCase[]): Promise<number> {
  const existing = await loadCases();
  const key = (c: { txHash: string; customerId?: string }) => `${c.txHash.replace(/^0x/i, "").toLowerCase()}|${c.customerId ?? ""}`;
  const seen = new Set(existing.map(key));
  const fresh = cases.filter((c) => !seen.has(key(c)));
  await mkdir(path.dirname(FILE()), { recursive: true });
  await writeFile(`${FILE()}.tmp`, JSON.stringify([...fresh, ...existing]));
  await rename(`${FILE()}.tmp`, FILE());
  return fresh.length;
}
