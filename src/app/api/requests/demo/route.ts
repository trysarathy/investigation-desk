// POST /api/requests/demo: the demo's simulated provider. Every action changes the same records the
// inbox, detail and sender pages read. "reset" removes demo records only and reseeds the day.
// JSON: { kind: "reset" | "send" (+ scenario) | "send_balance" | "mine" | "advance" (+ blocks) | "redeliver" }

import { NextResponse } from "next/server";
import { demoAction, type DemoAction } from "@/lib/requests/service";

const SCENARIOS = new Set(["routine", "short", "fake"]);

export async function POST(req: Request) {
  const a = await req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const kind = a?.kind;
  if (kind === "send" && !SCENARIOS.has(String(a?.scenario))) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  if (!["reset", "send", "send_balance", "mine", "advance", "redeliver"].includes(String(kind))) return NextResponse.json({ error: "Unknown demo action." }, { status: 400 });
  const res = await demoAction(a as unknown as DemoAction);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
