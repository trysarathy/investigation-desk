// Small view helpers shared by the request pages (server side).

import { SCENARIOS } from "./demo";
import { formatUsdc, type RequestView } from "./lifecycle";
import type { RequestsData, RequestState } from "./types";

export const STATE_ORDER: RequestState[] = ["needs_review", "matched", "confirming", "transfer_detected", "awaiting_payment", "completed"];

export function sortViews(views: RequestView[]): RequestView[] {
  return [...views].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || (a.request.createdAt < b.request.createdAt ? 1 : -1));
}

export const lastActivity = (v: RequestView) => v.request.activity.at(-1)?.at ?? v.request.createdAt;

export function demoStatus(data: RequestsData) {
  const sims = Object.values(data.observations).filter((o) => o.source === "simulated");
  const hasDemo = Object.values(data.requests).some((r) => r.demo);
  return {
    hasDemo,
    head: data.demoHead,
    waitingForBlock: sims.filter((o) => o.blockNumber === undefined).length,
    inBlock: sims.filter((o) => o.blockNumber !== undefined).length,
    scenarios: SCENARIOS.map((s) => ({
      key: s.key, id: s.id, title: s.title, blurb: s.blurb,
      sendLabel: `${data.requests[s.id]?.customerRef ?? s.customerRef} sends ${formatUsdc(s.send.amount)} ${s.send.token === "official" ? "USDC" : "look-alike “USDC”"}`,
      sent: sims.some((o) => (o.attribution.kind === "request" && o.attribution.requestId === s.id)),
    })),
  };
}
