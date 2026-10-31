# Task 7 — S1 positioning from six calls (Dunford canvas + message house, Mon 2 Nov 2026)

SETUP: PAUSE = FALSE (fixture). Everything below is a **proposal from n=5 S1 calls**: a hypothesis, not a validated position. Brightloom (S2, grade D only) is excluded.

**Evidence base:** 5 S1 calls.
- **Strong with A-C evidence, 3 of 5 (CI 23-88%):**
  - Nodewell: grade B (demo dated 12 Nov) and C.
  - Gridlane: C.
  - Pylon: C (accountant intro offered, no date yet).
- **Strong pain but not serviceable today:** Tessellate (Tron). Its "if you do Tron" is grade D for buying.
- **Weak:** Quorra (C evidence of *low* pain).

## Dunford canvas v1 (S1)
| Component | Proposed | Evidence (grade) |
|---|---|---|
| **Competitive alternatives** | (1) Spreadsheet + Etherscan + a person typing into Xero. (2) Chasing the payer by email. (3) The gateway, which covers checkout only. (4) A sub-ledger that doesn't map payments to invoices | (1) Nodewell: Friday, ~3 h (C). (2) Gridlane: 2 weeks chasing 20 USDC (C). Pylon: controller spends "a full day" at month end (C). (3) Pylon: gateway for checkout, but "half our enterprise clients wire USDC straight to our wallet" (C). (4) Tessellate: Cryptio "doesn't tell me which invoice" (C, n=1) |
| **Unique attributes** (built today) | Matches plain transfers to the company's own wallet without a reference; explains short, wrong-network and counterfeit payments in plain English with a drafted payer reply; posts to Xero only after a person approves, with tx hash, token and network on the entry | Product files (one-pager, claims audits). Limits: Ethereum only; live mode needs a pasted hash; Xero is not yet run against a real organisation. Whether a BNB-side payment can be diagnosed live needs checking with crypto-protocol-engineer [ASSUMPTION] |
| **Value** | Month-end close without the manual day; short and wrong payments resolved in hours, not weeks; no mis-posted receipts | Self-reported hours only (C, n=3). **Not measured.** The pilot measures it |
| **Target customers** | S1 B2B SaaS/data/infra firms, ~10-60 staff, **on Xero**, **≥ ~25 receipts/month**, clients paying USDC/USDT **on Ethereum straight to the wallet, often unreferenced** | Fits: 60, 35, 45/mo (all Xero). Excluded: 8/mo (Quorra, QuickBooks, weak); Tron-heavy (Tessellate, 120/mo) until Tron ships |
| **Market category** | Test "stablecoin receivables for Xero" vs "stablecoin payment reconciliation". Avoid "crypto accounting" | **No evidence yet**: no call has given an "oh, it's X for Y" reaction. Ungraded |

## Message house
- **Umbrella:** "Stablecoin payments, matched, explained and in your books." (unchanged)
- **Pillar 1, Matched:** even when clients send straight to your wallet with no reference. Proof true today: per-invoice payment pages and attribution rules (Ethereum USDC/USDT).
- **Pillar 2, Explained:** short, wrong network or counterfeit, in plain English with the reply drafted. Proof: 18 diagnosis rules with tests, run on 52 held-out real transfers (per `OBJECTIONS.md`; internal, not re-checked this run).
- **Pillar 3, In your books, once you approve:** Xero first, QuickBooks next; tx hash, token and network on each entry. Proof: Xero posting built and tested against recorded shapes.
- **Never say:**
  - "Posts automatically" or "watches your wallet" (live mode needs a pasted hash).
  - "Supports Tron" (say "Tron is next on the roadmap").
  - Live with customers, logos, "compliant", SOC 2.
  - Hours-saved figures as facts.
  - "Free pilot".

## What the calls change vs current positioning
1. **Lead with "straight to your wallet, no reference"** over the four-problem list. 2 of 3 Strong calls named it; wrong or short payments came up in 2 of 3.
2. **Narrow the audience line** from "finance teams paid in stablecoins" to Xero-using B2B firms whose clients pay direct, at roughly 25+/month. Proposal to lead-designer/content, after her yes.
3. **Name two alternatives on calls:** the gateway gap and the sub-ledger invoice gap (n=1 each).
4. **Tron:** 1 of 5 S1 calls, with the highest volume, is Tron-blocked. product-manager gets a call count, not a promise.

## Experiment for the riskiest component (Target + Value: is "direct, unreferenced, ≥ 25/mo" common in S1?)
**EXP-20261116-1**
- Variable: the D0 research sentence. Variant B: "client payments that arrive straight to your wallet with no invoice reference". Control: the current four-problem sentence.
- Segment: S1 only. Starts 16 Nov, after EXP-20261028-1 closes, so it can't contaminate that test.
- Primary metric: positive-reply rate per D0. Min n: 150 per arm.
- Secondary: the share of held calls with a grade-C story of an unreferenced transfer.
- Rule: SCALE B only if B's CI lower bound > control's CI upper bound. Otherwise "no detectable difference": keep control.
- Guardrails: bounce < 2%, 0 complaints.
- Cost: 0 extra founder hours.
- Approval needed: it changes the D0 template (RULES.md), so it needs her yes; revops applies.

**D1** Should we run EXP-20261116-1? A: yes. B: test in calls only. C: keep as is.

## WOULD WRITE — Log row
`2026-11-02 11:00 | gtm-strategist | positioning proposal | S1 canvas v1 | n=5 S1 calls (3 Strong A-C, CI 23-88%); EXP-20261116-1 proposed; PENDING D1`
