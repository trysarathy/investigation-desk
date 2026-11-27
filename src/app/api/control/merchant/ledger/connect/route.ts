import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { LEDGER_BROWSER_COOKIE, LEDGER_CALLBACK_PATH, ProviderInput, startLedgerConnect } from "@/server/ledger-connect";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * v1 phase 2.3: start connecting (or reconnecting) a ledger (Admin). Answers where to send the browser, and sets a
 * short-lived, HttpOnly, SameSite=Lax cookie that binds the OAuth state to this browser (the callback requires it).
 */
export const POST = (req: Request) => mutate(req, async (ctx, body) => {
  const v = z.object({ provider: ProviderInput }).strict().parse(body);
  const r = await startLedgerConnect(ctx, v);
  const secure = (process.env.CLEARLINE_ORIGIN ?? "").startsWith("https:") ? "; Secure" : "";
  return json(200, { authorizeUrl: r.authorizeUrl, provider: r.provider, env: r.env },
    { "Set-Cookie": `${LEDGER_BROWSER_COOKIE}=${r.browserBinding}; Path=${LEDGER_CALLBACK_PATH}; Max-Age=600; HttpOnly; SameSite=Lax${secure}` });
});
