// POST: reset the demo workspace (sample Files A and B; created cases and bulk runs cleared).

import { NextResponse } from "next/server";
import { resetDemoWorkspace } from "@/lib/demo/reset";
import { workspaceStore } from "@/lib/workspace/live";

export async function POST() {
  await resetDemoWorkspace(workspaceStore());
  return NextResponse.json({ ok: true });
}
