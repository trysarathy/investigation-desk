// View helpers shared by the request pages (server side): sorting, the at-a-glance numbers, and the
// list of what needs a person, each with its reason.

import { add } from "../payments/money";
import { CONFIRMATIONS } from "./check";
import { AUTO_RULE, formatUsdc, suggestMatches, unattributed, type RequestView } from "./lifecycle";
import { verdict, type Tone } from "./present";
import type { Observation, RequestsData, RequestState } from "./types";

export const STATE_ORDER: RequestState[] = ["needs_review", "matched", "confirming", "transfer_detected", "awaiting_payment", "completed"];
const TONE_ORDER: Tone[] = ["blocked", "attention", "progress", "waiting", "paid"];

export function sortViews(views: RequestView[], data: RequestsData): RequestView[] {
  return [...views].sort((a, b) => TONE_ORDER.indexOf(verdict(data, a).tone) - TONE_ORDER.indexOf(verdict(data, b).tone)
    || STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || (a.request.createdAt < b.request.createdAt ? 1 : -1));
}

export const lastActivity = (v: RequestView) => v.request.activity.at(-1)?.at ?? v.request.createdAt;

/** URL of an unidentified payment's page. */
export const paymentHref = (o: Observation) => `/requests/payments/${encodeURIComponent(o.key)}`;

export interface AttentionItem { href: string; who: string; ref: string; amount: string; status: string; tone: Tone; title: string }

/** Demo estimates for "time saved": stated on the page next to the number, never presented as measured. */
export const MINUTES_PER_AUTO_MATCH = 6;
export const MINUTES_PER_EXCEPTION = 20;

export function glance(data: RequestsData, views: RequestView[], now: number) {
  const week = views.filter((v) => now - Date.parse(v.request.createdAt) <= 7 * 24 * 3600_000);
  const auto = week.filter((v) => v.state === "completed" && v.acknowledgedBy?.by === AUTO_RULE);
  const byToken = (pick: (v: RequestView) => string) => {
    const t: Record<string, string> = {};
    for (const v of week) t[v.request.token] = add(t[v.request.token] ?? "0", pick(v));
    return Object.entries(t).sort().map(([k, a]) => `${formatUsdc(a)} ${k}`);
  };
  const attention: AttentionItem[] = [];
  for (const o of unattributed(data).filter((x) => week.some((v) => v.request.demo === x.demo) || !x.demo)) {
    const top = suggestMatches(data, o, CONFIRMATIONS)[0];
    attention.push({ href: paymentHref(o), who: "No reference", ref: "", amount: `${formatUsdc(o.amount)} ${o.tokenSymbol}`, status: "Unidentified", tone: "attention",
      title: top ? `Arrived with no reference. Suggested match: ${top.request.customerRef} ${top.request.invoiceRef} (${top.confidence.toLowerCase()}, ${top.signals.filter((s) => s.ok).length} of ${top.signals.length} signals)` : "Arrived with no reference. No likely match" });
  }
  for (const v of week) {
    const vd = verdict(data, v);
    if (vd.tone !== "attention" && vd.tone !== "blocked") continue;
    if (vd.status === "Suggested match") continue; // listed once, as the unidentified payment
    attention.push({ href: `/requests/${v.request.id}`, who: v.request.customerRef, ref: v.request.invoiceRef, amount: `${formatUsdc(v.request.amount)} ${v.request.token}`, status: vd.status, tone: vd.tone, title: vd.title });
  }
  attention.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone));
  const minutes = auto.length * MINUTES_PER_AUTO_MATCH + attention.length * MINUTES_PER_EXCEPTION;
  // Payments that arrived: requests something was paid toward (counted or not), plus unidentified ones.
  const arrived = week.filter((v) => v.counted.length + v.flagged.length > 0).length + unattributed(data).filter((o) => o.demo === (week[0]?.request.demo ?? o.demo)).length;
  const toRefund = week.filter((v) => v.duplicate && v.state !== "completed").reduce((s, v) => add(s, v.outstanding.replace(/^-/, "")), "0");
  return {
    sent: week.length,
    arrived,
    toRefund,
    paidAuto: auto.length,
    paid: week.filter((v) => v.state === "completed").length,
    attention,
    requested: byToken((v) => v.request.amount),
    received: byToken((v) => v.received),
    minutesSaved: minutes,
  };
}

export const formatMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);

export function demoStatus(data: RequestsData) {
  const sims = Object.values(data.observations).filter((o) => o.source === "simulated");
  return {
    hasDemo: Object.values(data.requests).some((r) => r.demo),
    head: data.demoHead,
    waitingForBlock: sims.filter((o) => o.blockNumber === undefined).length,
    confirming: sims.filter((o) => o.blockNumber !== undefined && o.chain === "ethereum" && o.confirmations < CONFIRMATIONS).length,
  };
}

/** "Today 09:05 SGT", "Yesterday 14:32 SGT", "Mon 11:20 SGT", or "3 Oct 11:20 SGT": the pilot region's time. */
export function friendlyTime(iso: string, now = Date.now()): string {
  const sg = (ms: number) => new Date(ms + 8 * 3600_000);
  const d = sg(Date.parse(iso)), n = sg(now);
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const when = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff > 1 && diff < 7 ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]
    : `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
  return `${when} ${hm} SGT`;
}
