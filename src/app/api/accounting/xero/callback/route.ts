// GET /api/accounting/xero/callback: Xero sends the person back here with a code. Exchange it,
// pick the organisation, keep the tokens server-side, and switch the books to Xero.

import { NextResponse } from "next/server";
import { connectOrgTimeZone } from "@/lib/accounting/engine";
import { XeroAdapter } from "@/lib/accounting/providers/xero";
import { completeConnection } from "@/lib/accounting/providers/xero-auth";
import { accountingStore } from "@/lib/accounting/service";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)xero_oauth_state=([0-9a-f]+)/)?.[1];
  if (!code || !state || state !== cookie) return NextResponse.json({ error: "The Xero connection didn't come from this server. Start again from Books." }, { status: 400 });
  try {
    const t = await completeConnection(code, `${url.origin}/api/accounting/xero/callback`);
    // The organisation's timezone dates every posting (R2): read now, replacing any earlier one.
    const adapter = new XeroAdapter({ tenantId: t.tenantId, accessToken: async () => t.accessToken });
    const at = new Date().toISOString();
    await accountingStore().update(async (a) => [await connectOrgTimeZone(a, adapter, { orgName: t.tenantName, at, by: "Xero OAuth" }), undefined]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const res = NextResponse.redirect(`${url.origin}/books`);
  res.cookies.delete("xero_oauth_state");
  return res;
}
