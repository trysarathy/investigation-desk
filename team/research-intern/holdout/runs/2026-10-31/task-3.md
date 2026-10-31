# Task 3: Tallyhash pricing change — brief item, tracker row, Aashmiin's two questions

research-intern · Sat 31 Oct 2026 SGT · for "What changed in our market", week of Mon 26 Oct–Sun 1 Nov 2026

**Limits up front:** nothing about the new pricing was opened this run. tallyhash.example/pricing and
the Wayback Machine both returned 403. The new prices come from a **search-result cache** (cache date
not shown, text truncated) and a changelog **snippet**. The old prices come from revops-crm-agent's
Wayback capture of 14 Aug 2026 (not re-opened). PAUSE not checked (Sheets off in test).

## Brief item (≤200 words)
**Tallyhash drops its free plan and moves Xero sync up a tier** [ASSUMPTION: search]
Older, newly relevant: the changelog snippet dates the change **2 Oct 2026**; we first saw it this week.
Search-cached pricing shows Starter now **US$49/month + US$0.20 + 0.25% per verified payment**, up to
200 payments, **CSV export only** (Xero sync from Growth up), Tron + Ethereum. Before (14 Aug capture):
Starter **free + 0.5%** (min US$0.10), up to 50 payments, Xero sync, Tron only
[VERIFIED: revops-crm-agent 2026-08-14]. Growth's new price is truncated ("US$1…") — **unknown**; it now
lists NetSuite (beta) and SOC 2 Type II on Enterprise. Existing customers keep old plans until
31 Jan 2027 (changelog snippet).
**So what:** for small senders it is a price rise plus a feature cut; for larger payments it can be
cheaper. Accounting sync is now a paid-tier feature — a sign Tallyhash sees sync as what customers pay
for [ASSUMPTION]. Not enough to change Clearline's price.
**Owner + action:** research-intern opens the pricing page when the host allows and confirms the Growth
price; gtm-strategist notes it; no pricing change without Aashmiin.

## Aashmiin's questions
**1. Did they put prices up?** Partly, and for small users yes [ASSUMPTION: search — new prices are
snippet-only].
- Starter is no longer free (US$0 → US$49/month) and loses Xero sync.
- Per-payment cost is lower for larger payments. Worked examples (Starter, per month; my arithmetic):

| Monthly use | Old Starter (free + 0.5%, min $0.10) | New Starter ($49 + $0.20 + 0.25%) | Change |
|---|---|---|---|
| 20 payments × US$500 | $50.00 | $49 + $29.00 = $78.00 | up |
| 50 payments × US$200 | $50.00 | $49 + $35.00 = $84.00 | up |
| 50 payments × US$1,000 | $250.00 | $49 + $135.00 = $184.00 | down |

  At 50 payments/month the break-even average payment is about US$472; below it, the new plan costs more.
  Not comparable for >50 payments (old Starter capped at 50).
- Growth: was US$99 + 0.3%; new price unknown (truncated). I won't guess it.

**2. Does this tell us what to charge?** Not much, and I'd not act on it.
- It is one competitor, snippet-only, cache date unknown; Clearline has 0 customers, so we have no
  willingness-to-pay data of our own.
- The one signal: Tallyhash charges for accounting sync rather than giving it away
  [ASSUMPTION]. It supports testing a flat monthly fee for the approve-then-post-to-Xero step, which is
  what the current offer already is (US$300 pilot for 30 days, then US$200/month).
- Next step: in learning calls ask "What do you pay today to get stablecoin payments into Xero, and who
  does it?" Owner: Aashmiin (prices are hers to decide), with gtm-strategist.

## Tracker row
WOULD WRITE (replaces the 2026-08-14 row; old values kept as "was"):
```csv
competitor,hq,segment,what_they_do,accounting_integrations,licence_status,pricing,funding,customers_claimed,last_checked,source,label
Tallyhash (FICTIONAL),US (Austin),SMB merchants,"Stablecoin payment verification + accounting sync","Starter: CSV export only; Growth+: Xero, QuickBooks, NetSuite (beta) [ASSUMPTION: search]. Was: Xero (all plans), QuickBooks (Growth) until ~2026-10-02",n/a (non-custodial),"Starter US$49/mo + US$0.20 + 0.25% per verified payment, up to 200/mo, Tron+Ethereum; Growth US$1…/mo (truncated, unknown); Enterprise contact us (SOC 2 Type II listed) [ASSUMPTION: search, cache date unknown]. Changed 2 Oct 2026 per changelog snippet; existing customers keep old plan to 31 Jan 2027. Was: Starter free + 0.5% (min $0.10, 50/mo, Xero, Tron); Growth $99 + 0.3% [VERIFIED: revops-crm-agent 2026-08-14]",Unknown,Unknown,2026-10-31,"https://tallyhash.example/pricing (403; search cache) ; https://tallyhash.example/changelog (snippet)","[ASSUMPTION: search] for new pricing; pricing page and Wayback 403 on 2026-10-31; old values [VERIFIED: revops-crm-agent 2026-08-14]"
```

## WOULD WRITE: Log row
| timestamp (SGT) | agent | action | ids | details |
|---|---|---|---|---|
| 2026-10-31 | research-intern | competitor pricing change: Tallyhash | tracker row Tallyhash | Starter free+0.5% → $49 + $0.20 + 0.25%, Xero sync moved to Growth; Growth price unknown (truncated). All new values [ASSUMPTION: search]; pricing page + Wayback 403 (host blocked). Brief item drafted. No change to Clearline pricing recommended. PAUSE not checked. |
