// GET /api/accounting/xero/callback: Xero sends the person back here with a code. Exchange it,
// pick the organisation, keep the tokens server-side, and switch the books to Xero.

import { NextResponse } from "next/server";
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
    const at = new Date().toISOString();
    // The organisation's timezone dates every posting (R2). Unreadable → none stored, so plans are blocked, never UTC.
    const tz = await new XeroAdapter({ tenantId: t.tenantId, accessToken: async () => t.accessToken }).readOrgTimeZone(at).catch(() => undefined);
    const zone = tz?.ianaTimeZone ? `timezone ${tz.source} (${tz.ianaTimeZone})` : `timezone ${tz ? `"${tz.source}" not recognised` : "couldn't be read"}: nothing will post until it is`;
    await accountingStore().update((a) => [{ ...a, provider: "xero", orgTimeZone: tz, audit: [...a.audit, { id: `AUD-xero-${Date.now()}`, at, kind: "connected", by: "Xero OAuth", provider: "xero", reason: `Connected to the Xero organisation "${t.tenantName}", ${zone}.`, demo: false }] }, undefined]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const res = NextResponse.redirect(`${url.origin}/books`);
  res.cookies.delete("xero_oauth_state");
  return res;
}
