import { REDIRECTS } from "./nav";

/**
 * Route handler for a moved console URL (IA v2, nav.ts REDIRECTS): a real HTTP 308 to the new
 * path, keeping the query string. Browsers keep any #fragment across the redirect.
 */
export function moved(from: string) {
  const to = REDIRECTS[from];
  // A key missing from REDIRECTS answers a plain 404, never `Location: undefined` (review nit).
  if (!to) return () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const handler = (req: Request) => {
    const url = new URL(req.url);
    return new Response(null, { status: 308, headers: { Location: to + url.search, "Cache-Control": "no-store" } });
  };
  return handler;
}
