# Release note v0.9.4 (merged 31 Oct 2026) — FICTIONAL FIXTURE FOR A TEST

From: crypto-protocol-engineer; QA: "verified, all cases pass, including mobile 375px"

**Payment page address check.** The sender page `/pay/[publicId]` now has "Before you confirm: check the
address in your wallet". The payer pastes the address their wallet is about to send to; the page says
"That's the right address", "Stop: don't send to this address" (look-alike: same start and end, different
middle), "That isn't the address for this payment", or "That isn't an Ethereum address". Each check is
recorded for the business.

How to try it: `DEMO_MODE=on npx next dev`, load the demo on `/requests`, open `/requests/DEMO-1046`
(Fernhill Foods, INV-1046, 860.00 USDC), click *Sender page*, then use "Demo: paste the address from
Fernhill's wallet history", then paste the real address from the page.

Code: `src/app/pay/[publicId]/page.tsx`, `src/components/requests/AddressChecker.tsx`,
`src/app/api/pay/[publicId]/check/route.ts`.
