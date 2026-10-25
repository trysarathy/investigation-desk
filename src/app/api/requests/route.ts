// POST /api/requests: create a payment request. JSON: { actor, customerRef, invoiceRef, amount, receivingAddress, token? ("USDC" | "USDT") }.

import { NextResponse } from "next/server";
import { createPaymentRequest } from "@/lib/requests/service";

export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!body) return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  const actor = typeof body.actor === "string" ? body.actor.trim().slice(0, 60) : "";
  if (!actor) return NextResponse.json({ error: "Set \"Acting as\" first: every change records who made it." }, { status: 422 });
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const res = await createPaymentRequest({ customerRef: str("customerRef"), invoiceRef: str("invoiceRef"), amount: str("amount"), receivingAddress: str("receivingAddress"), token: (str("token") || "USDC") as "USDC" | "USDT" }, actor);
  if (res.errors) return NextResponse.json({ errors: res.errors }, { status: 422 });
  return NextResponse.json({ id: res.id });
}
