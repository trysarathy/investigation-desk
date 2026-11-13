/** Console navigation. Only functional destinations are listed. */
export type NavItem = { href: string; label: string };
export type NavGroup = { title: string; items: NavItem[] };

export const MARKETING_URL = "https://clearline-marketing.vercel.app";
export const CONTACT_MAILTO =
  "mailto:aashmiin.k.2025@accountancy.smu.edu.sg?subject=Clearline%20console%20feedback";

export const NAV: NavGroup[] = [
  {
    title: "Workspace",
    items: [
      { href: "/clearline", label: "Overview" },
      { href: "/clearline/payments", label: "Payments" },
      { href: "/clearline/investigations", label: "Investigations" },
      { href: "/clearline/exceptions", label: "Exceptions" },
    ],
  },
  {
    title: "Connect",
    items: [
      { href: "/clearline/connect", label: "Payment intents" },
      { href: "/clearline/connect/quotes", label: "Quotes and routes" },
      { href: "/clearline/connect/activity", label: "Provider activity" },
      { href: "/clearline/docs", label: "Developer API reference" },
    ],
  },
  {
    title: "Control",
    items: [
      { href: "/clearline/control/reconciliation", label: "Reconciliation" },
      { href: "/clearline/control/liquidity", label: "Liquidity" },
      { href: "/clearline/control/funding", label: "Funding exposure" },
      { href: "/clearline/control/holds", label: "Compliance holds" },
      { href: "/clearline/control/reports", label: "Reports and evidence" },
    ],
  },
  {
    title: "Organization",
    items: [{ href: "/clearline/settings", label: "Settings" }],
  },
];

const LABELS: Record<string, string> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])),
);
LABELS["/clearline/trial"] = "Guided trial";

/** Breadcrumb trail for a pathname: Console › Group › Page [› Detail]. */
export function crumbsFor(pathname: string, detail?: string): NavItem[] {
  const out: NavItem[] = [{ href: "/clearline", label: "Console" }];
  if (pathname === "/clearline") return [...out, { href: "/clearline", label: "Overview" }];
  const group = NAV.find((g) => g.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/")));
  if (group) {
    const item = [...group.items]
      .sort((a, b) => b.href.length - a.href.length)
      .find((i) => pathname === i.href || pathname.startsWith(i.href + "/"))!;
    out.push({ href: group.items[0].href, label: group.title });
    out.push(item);
    if (detail && pathname !== item.href) out.push({ href: pathname, label: detail });
    return out;
  }
  if (LABELS[pathname]) out.push({ href: pathname, label: LABELS[pathname] });
  return out;
}

export function isActive(pathname: string, href: string): boolean {
  if (href === "/clearline") return pathname === "/clearline";
  if (href === "/clearline/connect") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}
