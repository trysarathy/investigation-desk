/**
 * The 13 steps of the demo journey, as the presenter guide (demo build only), the demo script
 * (docs/demo/DEMO_SCRIPT.md), the walkthrough recording and the journey test all follow them. Pure data: each step's
 * screen, who must be signed in for it, and two or three plain-English talking points. Every value is fictional
 * (Demo · fictional data). Numbers here are the seeded demo world's (tests/control/demo.test.ts and
 * tests/e2e-demo/cases.spec.ts check them).
 */
export type GuideRole = "finance" | "approver" | "viewer" | "admin" | "ops";

export const GUIDE_LOGINS: Record<GuideRole, { email: string; label: string }> = {
  finance: { email: "finance@northwind.demo", label: "Finance" },
  approver: { email: "approver@northwind.demo", label: "Approver" },
  viewer: { email: "viewer@northwind.demo", label: "Viewer" },
  admin: { email: "admin@northwind.demo", label: "Admin" },
  ops: { email: "ops@providerp.demo", label: "Provider ops" },
};

export interface GuideStep {
  n: number;
  /** Short id, used for screenshot names (docs/demo/screenshots/NN-<slug>.png). */
  slug: string;
  title: string;
  /** Where "Go there" lands. */
  path: string;
  /** Who is signed in for this step ("Go there" switches to them through the demo switcher when needed). */
  as: GuideRole;
  /** Minutes in the 10-minute talk track. */
  minutes: number;
  points: string[];
}

export const GUIDE_STEPS: GuideStep[] = [
  { n: 1, slug: "overview", title: "Overview", path: "/control/merchant/overview", as: "finance", minutes: 0.5, points: [
    "One payment leaves five records: the provider's record, the chain transfer, the order, the settlement batch and the bank line.",
    "Clearline only reads them and shows where they agree. Nothing here holds, sends, converts or settles money.",
    "Everything on screen is fictional: Northwind Travel (demo) and Provider P (demo).",
  ] },
  { n: 2, slug: "daily-report", title: "Finance daily report", path: "/control/merchant?date=2026-12-07", as: "finance", minutes: 0.75, points: [
    "Any of the 30 demo days, per entity, on the merchant's own clock (Singapore or Dubai), not UTC.",
    "Each day says what is done and what still needs a person: exceptions and write-offs awaiting approval.",
    "8 Dec is the demo's today and is only partly in: it is labelled as a partial day, not hidden.",
  ] },
  { n: 3, slug: "payments", title: "Payments list, filters and search", path: "/control/merchant/payments?result=exception&network=tron&token=USDT", as: "finance", minutes: 0.75, points: [
    "Every evaluated payment with its decision: matched, matched with a difference, suggested for review, or exception.",
    "Filter by result, network, token, difference type, age or batch; search by order, transaction hash or deposit address.",
  ] },
  { n: 4, slug: "payment-bk-24823", title: "Payment BK-24823", path: "/control/merchant/payments/BK-24823", as: "finance", minutes: 1, points: [
    "The five records side by side, and the one rule that decided: underpaid beyond the band.",
    "The difference is typed and priced: SGD -324.00 still owed. An amount alone never closes a match.",
    "The evidence timeline and audit history name who did what and when.",
  ] },
  { n: 5, slug: "exception", title: "Exception actions", path: "/control/merchant/exceptions/EX-BK-24823", as: "finance", minutes: 1, points: [
    "Every exception has an owner, a reason and a next step.",
    "Finance assigns it, adds a note and evidence, and proposes a resolution. Proposing is not approving.",
  ] },
  { n: 6, slug: "approval", title: "Role switcher and approval", path: "/control/merchant/approvals", as: "approver", minutes: 1, points: [
    "The switcher signs in as another seeded user: a real session, recorded as that person.",
    "The Approver approves the exact version Finance prepared; its fingerprint is shown.",
    "Finance can never approve her own proposal, through the switcher or a direct call: the server and the database refuse it.",
  ] },
  { n: 7, slug: "batch-b-1125-sgd", title: "Batch B-1125-SGD waterfall", path: "/control/merchant/batches/B-1125-SGD", as: "finance", minutes: 1, points: [
    "From the merchant day's SGD 44,412.30 to the bank's SGD 40,228.68, step by step: timing, the held payment, fee, refunds.",
    "Tied to the cent. BK-24871 is held by the provider and is an exception, not a silent difference.",
    "Each bar opens the payments behind it.",
  ] },
  { n: 8, slug: "case-bk-25102", title: "Case 3: BK-25102, paid in two parts", path: "/control/merchant/payments/BK-25102", as: "finance", minutes: 0.75, points: [
    "Paid in two parts on two chains: USDT on TRON and USDC on Ethereum.",
    "The AED 14.16 left is explained: AED 12.86 underpayment and AED 1.30 rate difference, within the band.",
  ] },
  { n: 9, slug: "month-end", title: "Month-end", path: "/control/merchant/month-end?entity=NW-SG&month=2026-11", as: "finance", minutes: 0.75, points: [
    "What is confirmed but not settled, by batch; open exceptions by age.",
    "Journal proposals wait for sign-off: the posting rules are not signed off yet, so nothing is posted.",
  ] },
  { n: 10, slug: "exports", title: "Exports", path: "/control/merchant/accounting?entity=NW-SG&month=2026-11", as: "finance", minutes: 0.5, points: [
    "Xero and QuickBooks journal drafts, an evidence pack per payment (PDF, CSV, JSON) and a month-end pack.",
    "Drafts only: a person imports them into the ledger. A Viewer cannot download them.",
  ] },
  { n: 11, slug: "upload", title: "Live upload of demo-files", path: "/control/merchant/uploads", as: "finance", minutes: 1, points: [
    "The provider's own layout is mapped once and saved as a template; every row is validated before it counts.",
    "A bank statement needs a second person (the Approver) to confirm it, and it is still 'imported, not bank-authenticated'.",
    "Reconcile now: BK-39021 is an exception; nothing closes on an imported statement.",
  ] },
  { n: 12, slug: "provider-console", title: "Provider console (ops@providerp.demo)", path: "/control/merchant/provider", as: "ops", minutes: 0.5, points: [
    "The provider sees aggregates and pilot metrics only, never a merchant's payments.",
    "'Wrong' is shown as not measured yet: there is no independent review to measure it against.",
  ] },
  { n: 13, slug: "settings", title: "Settings", path: "/control/merchant/settings", as: "finance", minutes: 0.5, points: [
    "The tolerance policy, read-only for Finance: the band is the larger of 50 bps and SGD 5.00.",
    "The provider's white-label theme, with the demo label on every screen.",
  ] },
];
