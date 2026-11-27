import { readCookie } from "@/server/control-http";
import { RequestRefused } from "@/server/errors";
import { AccessDenied } from "@/server/tenant";
import { completeLedgerConnect, LEDGER_BROWSER_COOKIE, LEDGER_CALLBACK_PATH } from "@/server/ledger-connect";

export const dynamic = "force-dynamic";

const PAGE = "/control/merchant/ledger";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * v1 phase 2.3: the ledger sends the browser back here. The state and the browser cookie are the proof (the session
 * cookie is SameSite=Strict and is not sent on this cross-site redirect). Answers a small page that moves on to the
 * Ledger page by a same-site navigation, so the session cookie is sent again there. Never echoes the code or state.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = Object.fromEntries(["state", "code", "realmId", "error"].map((k) => [k, u.searchParams.get(k) ?? undefined]).filter(([, v]) => v !== undefined));
  let status = 200, title = "Ledger connected", text = "Returning to the Ledger page…", next = `${PAGE}?connected=1`;
  try {
    const r = await completeLedgerConnect(q as { state: string }, readCookie(req.headers, LEDGER_BROWSER_COOKIE));
    if (r.status === "choose_tenant") { title = "Choose the organisation"; next = `${PAGE}?choose=1`; }
    else if (r.status !== "active") { title = "Ledger not connected"; text = "The connection needs attention on the Ledger page."; next = `${PAGE}?reconnect=1`; }
  } catch (e) {
    status = e instanceof RequestRefused || e instanceof AccessDenied ? e.status : 500;
    title = "Ledger not connected";
    text = e instanceof RequestRefused || e instanceof AccessDenied ? e.message : "Something went wrong; nothing was connected.";
    next = `${PAGE}?failed=1`;
    if (!(e instanceof RequestRefused || e instanceof AccessDenied)) console.error("ledger callback failed", e instanceof Error ? e.name : "error");
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="1;url=${esc(next)}"><title>${esc(title)}</title></head>` +
    `<body><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="${esc(next)}">Go to the Ledger page</a></p></body></html>`;
  return new Response(html, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "Set-Cookie": `${LEDGER_BROWSER_COOKIE}=; Path=${LEDGER_CALLBACK_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`,
  } });
}
