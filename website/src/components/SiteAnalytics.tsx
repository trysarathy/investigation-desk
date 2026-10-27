"use client";
import { Analytics } from "@vercel/analytics/next";

/** Cookie-free page views via Vercel Web Analytics. Only loads when built on Vercel (its script lives there). */
export function SiteAnalytics() {
  if (process.env.NEXT_PUBLIC_ON_VERCEL !== "1") return null;
  return <Analytics />;
}
