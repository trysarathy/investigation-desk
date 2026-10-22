// Bulk jobs run in the server process with progress kept in memory, and results written under
// .data/bulk/ when done. A job doesn't survive a server restart; queued jobs arrive with week 5.

import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowError } from "../csv/files";
import type { BulkResult } from "./types";

export interface BulkJob {
  id: string;
  createdAt: string;
  filename: string;
  sha256: string;
  total: number;
  done: number;
  status: "running" | "done";
  /** Rows skipped at validation; never investigated, never guessed. */
  skipped: RowError[];
  results: BulkResult[];
  casesCreated?: number;
}

const DIR = () => path.join(process.cwd(), ".data", "bulk");
const jobs = new Map<string, BulkJob>();

export function createJob(filename: string, sha256: string, total: number, skipped: RowError[]): BulkJob {
  const job: BulkJob = { id: randomUUID(), createdAt: new Date().toISOString(), filename, sha256, total, done: 0,
    status: total ? "running" : "done", skipped, results: [] };
  jobs.set(job.id, job);
  return job;
}

export async function saveJob(job: BulkJob) {
  await mkdir(DIR(), { recursive: true });
  await writeFile(path.join(DIR(), `${job.id}.json`), JSON.stringify(job));
}

export async function getJob(id: string): Promise<BulkJob | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const live = jobs.get(id);
  if (live) return live;
  try {
    return JSON.parse(await readFile(path.join(DIR(), `${id}.json`), "utf8")) as BulkJob;
  } catch {
    return undefined;
  }
}
