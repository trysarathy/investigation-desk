// POST /api/accounting/import: make payment requests from the open invoices in the connected books.
// JSON: { actor, receivingAddress, token: "USDC" | "USDT" }

import { NextResponse } from "next/server";
import { importOpenInvoices } from "@/lib/accounting/service";

const EVM = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: Request) {
  const b = await req.json().catch(() => undefined) as { actor?: unknown; receivingAddress?: unknown; token?: unknown } | undefined;
  const actor = typeof b?.actor === "string" ? b.actor.trim().slice(0, 60) : "";
  if (!actor) return NextResponse.json({ error: "Set \"Acting as\" first." }, { status: 422 });
  if (typeof b?.receivingAddress !== "string" || !EVM.test(b.receivingAddress.trim())) return NextResponse.json({ error: "Enter the Ethereum address customers pay to." }, { status: 422 });
  const token = b?.token === "USDT" ? "USDT" : "USDC";
  const res = await importOpenInvoices(actor, b.receivingAddress.trim(), token);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ ok: true, ...res });
}
