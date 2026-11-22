/**
 * rc6 public cases demo: the three case slugs and their short names. No engine import, so the console's client
 * navigation (breadcrumbs) can use it without bundling the engine.
 */
export const CASE_SLUGS = ["amount-differences", "one-settlement", "partial-payment"] as const;
export type CaseSlug = (typeof CASE_SLUGS)[number];

export const CASE_SHORT: Readonly<Record<CaseSlug, string>> = {
  "amount-differences": "Case 1 · Amount differences",
  "one-settlement": "Case 2 · One settlement, many payments",
  "partial-payment": "Case 3 · Partial payment across chains",
};

export const CASES_HREF = "/clearline/cases";
export const isCaseSlug = (s: string): s is CaseSlug => (CASE_SLUGS as readonly string[]).includes(s);
