// Words on the request screens that depend on whether the auto-mark-paid rule is on. The rule is on
// only in demo mode (service.ts: `autoMarkPaid: demo`), so live screens never say "automatically":
// they say what happens today, checked and ready for a person to mark paid. Checked against
// company/PRODUCT_FACTS.md and team/CLAIMS_REVIEW.md row 2. No imports: the client panel uses it too.

export const NOT_UNTIL_YOU_CONFIRM = "nothing is marked paid until you confirm";

export function glanceCopy(demoMode: boolean, g: { paidAuto: number; readyToMark: number; arrived: number }) {
  const base = "Every request tells the sender exactly what to send, where and on which network. When a payment is wrong, Clearline says why in plain English.";
  return demoMode
    ? { heroSub: base, paidTile: { label: "Paid automatically · demo", value: g.paidAuto, sub: `of ${g.arrived} payments that arrived` }, showTimeSaved: true }
    // CLAIMS_REVIEW row 2, true-today wording. Demo requests loaded in live mode keep the demo rule, so
    // the page-level lines stay true for them too; the per-request hint says "nothing until you confirm".
    : { heroSub: `${base} Correct payments are checked and ready to mark paid in one click, with the reasons written down.`,
        paidTile: { label: "Checked and ready to mark paid", value: g.readyToMark, sub: "waiting for you to mark them paid" }, showTimeSaved: false };
}

/** The hint under "I've asked for the balance": automatic only where the request has the demo rule. */
export function requestBalanceHint(autoMarkPaid: boolean): string {
  return autoMarkPaid
    ? "Keeps the invoice open until the rest arrives; then, in the demo, it's marked paid automatically."
    : `Keeps the invoice open until the rest arrives. Checked: ready for you to mark it paid; ${NOT_UNTIL_YOU_CONFIRM}.`;
}
