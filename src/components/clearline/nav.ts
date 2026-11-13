/** Console navigation (IA v2). Only functional destinations are listed. */
export type NavItem = { href: string; label: string };
export type NavSection = NavItem & {
  /** Sub-pages shown as tabs on the section's pages; the first tab is the section's own href. */
  tabs?: NavItem[];
  /** Other URLs that belong to this section (for the active state and breadcrumbs). */
  also?: string[];
};

/** Public website for this build: resolved from clearline-release.json by next.config.mjs. */
export const MARKETING_URL = process.env.NEXT_PUBLIC_CLEARLINE_MARKETING_URL ?? "https://clearline-marketing.vercel.app";
/**
 * The specialist Funding Desk workflow (advance review, treasury approval, supplier payout and
 * repayment) runs in this same deployment at /mentor-demo. The older separate static site is no
 * longer linked from the console.
 */
export const FUNDING_DESK_HREF = "/mentor-demo";
/** Shown next to every control that switches the simulated person acting in the sandbox. */
export const SIMULATED_ROLE_NOTE = "Simulated role — not sign-in or access control";
export const CONTACT_MAILTO =
  "mailto:aashmiin.k.2025@accountancy.smu.edu.sg?subject=Clearline%20console%20feedback";

/** Daily operations: where a payment-operations person spends the day. */
export const PRIMARY: NavSection[] = [
  { href: "/clearline", label: "Overview" },
  { href: "/clearline/payments", label: "Payments" },
  {
    href: "/clearline/investigations", label: "Investigations",
    tabs: [
      { href: "/clearline/investigations", label: "Cases" },
      { href: "/clearline/exceptions", label: "Exceptions queue" },
    ],
    also: ["/clearline/exceptions"],
  },
  { href: "/clearline/reconciliation", label: "Reconciliation" },
  {
    href: "/clearline/treasury", label: "Treasury & Funding",
    tabs: [
      { href: "/clearline/treasury", label: "Liquidity" },
      { href: "/clearline/treasury/funding", label: "Funding exposure" },
    ],
  },
];

/** Set-up, oversight and reference. */
export const SECONDARY: NavSection[] = [
  {
    href: "/clearline/routes", label: "Routes & Providers",
    tabs: [
      { href: "/clearline/routes", label: "Routes and quotes" },
      { href: "/clearline/routes/activity", label: "Provider activity" },
      { href: "/clearline/routes/new", label: "New payment intent" },
    ],
  },
  { href: "/clearline/holds", label: "Compliance Holds" },
  { href: "/clearline/reports", label: "Reports" },
  { href: "/clearline/docs", label: "Developers" },
  { href: "/clearline/settings", label: "Settings" },
];

export const SECTIONS: NavSection[] = [...PRIMARY, ...SECONDARY];

/** URL of the payment-intent create flow (Routes & Providers › New payment intent). */
export const NEW_INTENT_HREF = "/clearline/routes/new";

/**
 * Moved URLs (IA v1 → v2). Each old page answers with a permanent redirect (308) that keeps its
 * query string; the browser keeps any #fragment. Nothing that used to work 404s.
 */
export const REDIRECTS: Record<string, string> = {
  "/clearline/connect": NEW_INTENT_HREF,
  "/clearline/connect/quotes": "/clearline/routes",
  "/clearline/connect/activity": "/clearline/routes/activity",
  "/clearline/control": "/clearline/reconciliation",
  "/clearline/control/reconciliation": "/clearline/reconciliation",
  "/clearline/control/liquidity": "/clearline/treasury",
  "/clearline/control/funding": "/clearline/treasury/funding",
  "/clearline/control/holds": "/clearline/holds",
  "/clearline/control/reports": "/clearline/reports",
};

const owns = (pathname: string, href: string) => pathname === href || (href !== "/clearline" && pathname.startsWith(href + "/"));

/** The nav section a pathname belongs to (longest match wins). */
export function sectionFor(pathname: string): NavSection | undefined {
  if (pathname === "/clearline") return PRIMARY[0];
  let best: NavSection | undefined;
  let len = 0;
  for (const s of SECTIONS) {
    for (const h of [s.href, ...(s.also ?? []), ...(s.tabs ?? []).map((t) => t.href)]) {
      if (owns(pathname, h) && h.length > len) { best = s; len = h.length; }
    }
  }
  return best;
}

/** Breadcrumb trail: Console › Section [› Tab] [› Detail]. */
export function crumbsFor(pathname: string, detail?: string): NavItem[] {
  const out: NavItem[] = [{ href: "/clearline", label: "Console" }];
  if (pathname === "/clearline") return [...out, { href: "/clearline", label: "Overview" }];
  if (pathname === "/clearline/trial") return [...out, { href: pathname, label: "Guided trial" }];
  const s = sectionFor(pathname);
  if (!s) return out;
  out.push({ href: s.href, label: s.label });
  const tab = s.tabs ? [...s.tabs].sort((a, b) => b.href.length - a.href.length).find((t) => owns(pathname, t.href)) : undefined;
  if (tab && tab.href !== s.href) out.push(tab);
  if (detail) out.push({ href: pathname, label: detail });
  return out;
}

export function isActive(pathname: string, item: NavSection): boolean {
  return sectionFor(pathname)?.href === item.href;
}

/** Tab is current: exact match, or the longest tab prefix of the pathname. */
export function isTabActive(pathname: string, tabs: NavItem[], href: string): boolean {
  const best = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => owns(pathname, t.href));
  return best?.href === href;
}
