// POST: "Create cases for non-credited". Every result not shown as credited (D13) becomes a case.

import { NextResponse } from "next/server";
import { addCases } from "@/lib/bulk/cases";
import { getJob, saveJob } from "@/lib/bulk/jobs";
import { isNonCredited } from "@/lib/bulk/run";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = await getJob((await params).id);
  if (!job) return NextResponse.json({ error: "No such bulk run." }, { status: 404 });
  if (job.status !== "done") return NextResponse.json({ error: "Wait for the run to finish." }, { status: 409 });
  const now = new Date().toISOString();
  const created = await addCases(job.results.filter(isNonCredited).map((r) => ({
    id: `BK-${r.txHash.replace(/^0x/i, "").slice(0, 8)}-${r.line}`,
    txHash: r.txHash, customerId: r.customerId, createdAt: now, code: r.code, label: r.label, confidence: r.confidence,
    paused: r.state !== "verdict", chain: r.foundChain, token: r.token, amount: r.amount, fromJob: job.id,
  })));
  job.casesCreated = (job.casesCreated ?? 0) + created;
  await saveJob(job);
  return NextResponse.json({ created });
}
