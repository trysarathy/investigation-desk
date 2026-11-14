/**
 * The five guided trial cases, as the console's guided trial lists them (rc3/clearline-app,
 * src/components/clearline/pages/Trial.tsx: titles, console areas, starting states and expected responses).
 * Fictional data. Shared by the homepage and /trial.
 */
export const TRIAL_CASES: { n: string; title: string; product: "Control" | "Control · Funding Desk"; area: string; text: string }[] = [
  { n: "01", title: "Successful payment", product: "Control", area: "Payments · Investigation", text: "The provider reports completion, and a separate bank statement line arrives. See execution, settlement evidence and reconciliation as three separate truths, with the statement line matched by trusted reference." },
  { n: "02", title: "Returned payout", product: "Control", area: "Investigations · Exceptions queue", text: "The beneficiary's bank rejected the payout. Read what is known, still unknown and outstanding, assign an owner, and see that the case cannot be resolved until the engine's conditions are met." },
  { n: "03", title: "Compliance hold", product: "Control", area: "Compliance Holds", text: "The partner holds the payout and asks for documents. There is no release button: Clearline records the assigned reviewer's decision, and refuses a decision by anyone else." },
  { n: "04", title: "Base Sepolia finality delay", product: "Control", area: "Payments · Investigation", text: "A synthetic testnet USDC transfer is observed but below the confirmation threshold. Simulate more confirmations and watch settlement evidence move from awaiting finality to verified, by on-chain transfer, never as a bank credit." },
  { n: "05", title: "Funding exposure", product: "Control · Funding Desk", area: "Treasury & Funding · Funding exposure", text: "An SGD 50,000.00 advance paid a supplier before the customer repaid: SGD 30,000.00 repaid by reference, SGD 20,000.00 outstanding, and an unreferenced SGD 20,000.00 receipt kept as an exception." },
];

/** Connect is tried outside the five cases, in the console's "Try your own payment" step. */
export const TRY_CONNECT = "Then try Connect: create a payment intent, compare indicative sandbox routes, approve it as a different person, submit it and simulate the provider's next event, with or without an injected failure.";

/** Console features around the cases (rc3/clearline-app @ 7e521f5; journey steps 18 and 19). Console only: no v1 endpoint. */
export const CONSOLE_TOOLS: { title: string; text: string }[] = [
  { title: "Case report", text: "On any payment's investigation page, view the engine's synthetic case report, marked fictional, and download it as JSON or CSV." },
  { title: "Reset one case", text: "Reset a single case to its starting state; the other cases and anything you created stay. If one of your records depends on that case, the reset is refused with the reason. You can also reset the whole workspace." },
  { title: "Simulated roles", text: "Switch role to act as maker, checker or compliance reviewer. Every switch says \"Simulated role — not sign-in or access control\"." },
];
