// Demo mode or live mode, set when the server starts.
//
//   DEMO_MODE unset or "on" (the default): the customer demo. Only the payment-requests flow is in
//     the navigation (the older deposit-investigation pages stay in the code, reachable by URL, but
//     hidden), everything runs offline on fictional "Demo data", and no live chain lookups are offered.
//   DEMO_MODE=off: live mode. Every page is in the navigation and real Ethereum lookups by hash work.

export function isDemoMode(): boolean {
  return !/^(off|0|false|no|live)$/i.test((process.env.DEMO_MODE ?? "on").trim());
}

/** Who is acting in the demo when nobody has typed a name: the fictional finance-ops lead. */
export const DEMO_ACTOR = "Mei Tan (Finance ops)";
