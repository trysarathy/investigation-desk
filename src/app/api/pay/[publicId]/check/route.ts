// POST /api/pay/<publicId>/check: the sender's address checker. JSON: { address }.
// Public like the payment page itself (the link is the key). It records only the verdict, and the
// pasted address only when it is a look-alike of the request's (evidence of a poisoning attempt).

import { NextResponse } from "next/server";
import { checkSenderAddress } from "@/lib/requests/service";

export async function POST(req: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const body = await req.json().catch(() => undefined) as { address?: unknown } | undefined;
  if (typeof body?.address !== "string" || !body.address.trim()) return NextResponse.json({ error: "Paste an address." }, { status: 400 });
  const res = await checkSenderAddress(publicId, body.address);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json({ result: res.result });
}
