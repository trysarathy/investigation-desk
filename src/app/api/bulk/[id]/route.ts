import { NextResponse } from "next/server";
import { getJob } from "@/lib/bulk/jobs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = await getJob((await params).id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "No such bulk run." }, { status: 404 });
}
