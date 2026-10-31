# ICP, segments, account scoring and the beachhead hypothesis

Last refreshed 2026-10-31 · owner gtm-strategist. Everything here is **[ASSUMPTION]** until the
Calls and Opportunities tabs clear the thresholds in `experiments-and-decision-rules.md`. Starting
inputs: `clearline-gtm-today.md` §4 (the ICP as written).

## 1. Segment list (working IDs used in experiments and Calls notes)
| ID | Segment | Why it might fit | Why it might not | Motion |
|---|---|---|---|---|
| S1 | Crypto/Web3 SaaS, data, RPC/node, AI-API firms billing in USDT/USDC | Invoice-led B2B receipts to own wallet; often on Xero/QBO [ASSUMPTION] | Crypto-native teams may build it or use a sub-ledger | SMB, founder-led |
| S2 | Web3 agencies, dev studios, audit firms, events/media | Project invoices paid by clients from exchanges/treasuries (no reference) | Low volume per month (may be < break-even) | SMB |
| S3 | Hosting/VPS/proxy/VPN providers | Many USDT payers, real wrong-payment volume | Often on a gateway (NOWPayments/CoinGate) that already reconciles; consumer-ish payers | SMB, self-serve-ish |
| S4 | Prop-trading challenge firms, USDT-priced online services | High volume | Often gateway-led; reputational/regulatory risk; B2C payers | Check carefully before pursuing |
| S5 | PSPs, OTC desks, remitters, exchanges (SPEC's original buyer) | Ops pain at scale, exceptions are the job | Enterprise security bar (SOC 2, SSO) we can't meet; data integration | Enterprise / mid-market, long cycle |
| S6 | Exporters/importers and trading firms in SG/HK/UAE paid in USDT by foreign customers | Non-crypto finance teams, plain transfers, Xero common in SG [ASSUMPTION] | Likely Tron (not supported for payment pages yet); hard to find evidence publicly | SMB / mid-market |
| P1 | Partners: crypto practices at accounting/audit firms, Web3 bookkeepers, company-formation firms | One partner = many SMB clients; they feel the month-end pain | Partners want margin/white-label; slow to refer an unproven tool | Partner |

## 2. Segment health board (rebuilt weekly from the tabs; never typed by hand)
For each segment: D0 sent · replies · positive replies · calls held · Strong / Weak / None ·
evidence grade A/B/C counts · offers made · paid · median `volume_per_month` · accounting system
mix (Q5). Every cell shows its denominator. Example of an honest row (FICTIONAL):
`S1 | sent 120 | positive 4 (3.3%, CI 1-8%) | held 3 | Strong 2/3 (CI 21-94%) | offers 0 | n too small`.

## 3. Proposed account score (overlay on `gtm/score.py`; PROPOSAL, not live)
Account score 0-100 = **Fit 40 + Pain 35 + Reach 25**.
| Part | Signal | Points |
|---|---|---|
| Fit | Receives USDC/USDT directly to own wallet (evidence E1/E2 in research-intern's ladder) | 15 |
| | Uses Xero (10) / QuickBooks (6) / other or unknown (0) | 0-10 |
| | Size 5-200 staff (8); 200-1,000 (5); >1,000 (2: enterprise security bar) | 2-8 |
| | Region where cold email is allowed in lean mode | 0-7 |
| Pain | Estimated >= 25 stablecoin receipts/month (break-even ~22 at ROI defaults) | 0-15 |
| | Public sign of wrong payments (FAQ about wrong network, "include invoice number" instructions) | 0-10 |
| | Trigger in last 90 days (finance hire, new stablecoin acceptance, audit season) | 0-10 |
| Reach | Named finance buyer with verified email (15) / LinkedIn only (8) / none (0) | 0-15 |
| | Warm path via a partner (accountant) | 0-10 |
Tiers: A >= 70, B 50-69, C < 50. Re-weight **only** after >= 10 held calls, using which signals
the Strong calls actually had (decision for Aashmiin; revops-crm-agent implements).

## 4. Beachhead hypothesis (v0, 31 Oct 2026)
**Hypothesis H-B1:** S1 (crypto/Web3 B2B SaaS and infra firms on Xero, 5-200 staff, receiving
USDC/USDT on Ethereum to their own wallet) is the beachhead, because it matches what is built
today (Ethereum payment pages, Xero first) and research finds the most public evidence there.
**Rival H-B2:** S6 (non-crypto SG/HK exporters paid in USDT) feels more pain but is blocked by Tron.
**Rival H-B3:** P1 partners are the real channel into SMBs (beachhead = one accounting firm's clients).

**Confirm H-B1 when** (all of): >= 8 held calls in S1; >= 50% of them Strong with grade A-C
evidence; >= 3 named a past wrong payment in the last 90 days; >= 1 paid pilot. **Kill H-B1 when**
>= 8 held calls and <= 2 Strong, or >= 5 offers and 0 paid. Anything in between: ITERATE (change one
positioning component). Below 8 held calls: **INCONCLUSIVE, keep collecting**.

## 5. Things that must never be inferred from small n
"S1 converts best", "agencies don't care", "price is too high", "Xero is the main system". Each
needs its threshold; until then say "k of n, too few to tell".
