/** The five guided trial cases (fictional data), shared by the homepage and /trial. */
export const TRIAL_CASES: { n: string; title: string; area: "Connect" | "Control" | "Funding Desk"; text: string }[] = [
  { n: "01", title: "Create an intent", area: "Connect", text: "Create a fictional payment, compare three sandbox quotes and one excluded route, choose a route and follow it to provider-reported completion." },
  { n: "02", title: "Investigate a return", area: "Control", text: "Inspect a returned payout and identify the beneficiary-details correction required, and who owns it." },
  { n: "03", title: "Handle a compliance hold", area: "Control", text: "See the provider's document request and the human owner. Clearline records holds; it does not clear them." },
  { n: "04", title: "Inspect stablecoin finality", area: "Control", text: "Distinguish a synthetic Base Sepolia transaction observation from proof of final settlement." },
  { n: "05", title: "Follow an advance", area: "Funding Desk", text: "Follow an SGD 50,000.00 advance from the supplier payout to treasury approval (maker ≠ checker), SGD 30,000.00 repaid by reference and SGD 20,000.00 outstanding, then open the detailed Funding Desk prototype." },
];
