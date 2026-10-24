// POST /api/bulk with a multipart "file": validate the CSV, then start a bulk job in the
// background and return its id. Progress: GET /api/bulk/{id}.

import { NextResponse } from "next/server";
import { liveDeps, liveKeysPresent } from "@/lib/chain/live";
import { validateBulk } from "@/lib/csv/files";
import { createJob, saveJob } from "@/lib/bulk/jobs";
import { demoDeps } from "@/lib/demo/deps";
import { runBulk } from "@/lib/bulk/run";
import { SAMPLE_SETTINGS } from "@/lib/fixtures";
import { requestTooLarge } from "@/lib/limits";
import { loadWorkspace } from "@/lib/workspace/live";

const BULK_MAX = 2 * 1024 * 1024;
const BULK_TOO_LARGE = "This file is larger than the 2 MB limit for a bulk check. Split it into smaller files.";

export async function POST(req: Request) {
  if (requestTooLarge(req, BULK_MAX + 64 * 1024)) return NextResponse.json({ error: BULK_TOO_LARGE }, { status: 413 });
  const form = await req.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV file in the \"file\" field." }, { status: 400 });
  if (file.size > BULK_MAX) return NextResponse.json({ error: BULK_TOO_LARGE }, { status: 413 });
  const v = validateBulk(new Uint8Array(await file.arrayBuffer()));
  if (v.fileErrors.length) return NextResponse.json({ error: v.fileErrors.join(" ") }, { status: 422 });
  const { ws, missing, data } = await loadWorkspace();
  if (!ws) return NextResponse.json({ error: `Upload ${missing.map((m) => `File ${m}`).join(" and ")} in Settings → Data first.` }, { status: 409 });
  // The demo workspace answers its hashes from recordings, so it runs without keys.
  if (!liveKeysPresent() && !data.demo) {
    return NextResponse.json({ error: "Live chain lookups need TRONGRID_API_KEY and ETHERSCAN_API_KEY on the server." }, { status: 409 });
  }

  const job = createJob(file.name.slice(0, 200), v.sha256, v.rows.length, v.rowErrors);
  // Runs after the response; progress is read from the job.
  void runBulk(v.rows, ws, data.demo ? demoDeps() : liveDeps(), SAMPLE_SETTINGS, (r) => {
    job.results.push(r);
    job.done++;
  }).then(async () => {
    job.results.sort((a, b) => a.line - b.line);
    job.status = "done";
    await saveJob(job);
  });
  return NextResponse.json({ id: job.id, total: job.total, skipped: job.skipped.length });
}
