SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# Pain-point ranking (P3): stablecoin-receiving finance teams

**Basis:** Calls rows used: 1, of which buyers: **0**. The one row (2026-10-30, MENTOR-ANTOINE) is a fractional CFO introduced via a mentor, scored "Weak (advisor, not a buyer; no clients paying in stablecoins named)". Public sources: 8 opened by the pack on 2026-10-31 (`public-pain-evidence.md` P1–P8), 6 search-level only (S1–S6). None opened this run. Persona B-traits from `persona.md`.

**To product-manager:** **1 conversation, 0 buyer interviews. This ranking is a hypothesis list, not market evidence.** Nothing here measures frequency or cost. Every "frequency" cell is "unknown". Use it to choose which questions to ask in real calls, and order the roadmap cautiously; it isn't a demand ranking.

## Evidence-strength scale used
**Moderate** = several opened vendor/primary pages publish help or settings for it. **Weak-moderate** = one Calls row (advisor) and/or one opened page. **Weak** = search-level or internal-spec only. **Weakest** = `[GUESS: persona judgement]` only. Rank = strength first, then plausible close impact (`[GUESS: persona judgement]`).

## Ranking
| Rank | Pain | Evidence (tagged) | Strength | Frequency | Who feels it | Clearline today | Real-call question (Mom Test) |
|---|---|---|---|---|---|---|---|
| 1 | **Wrong network / wrong asset**, and slow, manual recovery that costs a fee | NOWPayments refund policy: the most common refund case is a deposit on the wrong network; recovery is manual and the customer covers a network fee (P3, P4) [VERIFIED: pack 2026-10-31]; Tether asks integrators to state which protocols they support (P8) [VERIFIED: pack]; BoomFi/OpenNode help pages (S5) [ASSUMPTION: secondary, search] | Moderate (3 opened) | Unknown | Support, treasury, finance | Detects; never posts; Tron detected as wrong network [INTERNAL: clearline-product.md] | "Tell me about the last payment that came in on the wrong network. Who found it, what did it cost, and how was it booked?" |
| 2 | **Short payment after fees**: chase, write off or leave open | NOWPayments "Partially Paid: Do not deliver…" and warning that "Finished" marks wrong amounts as done (P1, P2) [VERIFIED: pack]; Stripe's underpayment margin for bank transfers (P7, fiat analogue) [VERIFIED: pack]; SurferCloud "1 USDT ≠ 1 USDT" notice (S1) [ASSUMPTION: secondary, search] | Moderate (2 opened, one is a fiat analogue) | Unknown | Finance (write-off decision), support | Partial + note, or payment + separate fee write-off once a person approves; no tolerance setting [INTERNAL] | "What did you do with the last short payment? Who decided, and where did the difference go in the books?" |
| 3 | **Exceptions are recurring operational work** (investigate, reconcile manually, refund, update the customer) | NOWPayments exception post (P5) [VERIFIED: pack; vendor marketing, so biased towards making exceptions look costly]; Stripe: refunds are new stablecoin payments, no chargebacks (P6) [VERIFIED: pack] | Weak-moderate (1 opened, biased) | Unknown | Support, finance, treasury | Plain-English cause (labelled inference), reply draft, exceptions inbox [INTERNAL] | "Last month, how many payments needed someone to look at them by hand? Walk me through one." |
| 4 | **Getting receipts into the accounting system** (posting effort, integration over dashboards) | [CALL 2026-10-30 MENTOR-ANTOINE, fractional CFO, advisor not buyer]: "The integration is really important, more than the page you showed me." / "Don't build something where they have to connect themselves." (internal only); S3 manual QuickBooks mark-paid, S2 books missed stablecoin income [ASSUMPTION: secondary, search — weak] | Weak-moderate (1 advisor, 0 buyers + 2 weak search items) | Unknown | Finance / bookkeeper | Xero built and in testing, posts only once a person approves; QuickBooks next; NetSuite designed [INTERNAL] | "After a stablecoin payment lands, what are the exact steps until it shows as paid in your ledger? When did you last do that?" |
| 5 | **Duplicate / repeated payments** | NOWPayments has a dedicated "Repeated Payments" setting and recommends holding them as "Partially Paid" (teardowns T1, from P1/P2 page) [VERIFIED: pack] | Weak (1 opened page, a settings mention) | Unknown | Finance (refund vs credit), support | One payment + one overpayment for refund, never two; repeat events ignored [INTERNAL: ACCOUNTING_SYNC.md] | "Has a customer ever paid the same invoice twice? What did you do with the money?" |

## Below the top 5 (and why)
| Pain | Evidence | Why it ranks lower |
|---|---|---|
| Auditor evidence (existence/ownership, per-receipt trace) | PCAOB 2023 Spotlight, AICPA practice aid (persona A3) | [ASSUMPTION: secondary, search — hosts blocked]. Plausibly high close impact, but no opened source and no call. Also, Clearline gives occurrence evidence, not ownership |
| No visibility / alerts: want to see only exceptions | Calls row: "When things go well they just don't want to [see it]" and "no visibility when payments are blocked" | 1 advisor; the visibility quote is about **traditional bank/SWIFT** payments, not stablecoins |
| Counterfeit / look-alike tokens | Exchange/wallet help centres cited in [INTERNAL: docs/SPEC.md §2] | Internal spec sources, not re-opened this run |
| No reference / no invoice number | None found in a public forum (`public-pain-evidence.md` §C) | [ASSUMPTION] from Clearline's own spec only |
| Approvals / controls on who posts | persona C5 (mixed: secondary + internal design) | Mostly `[GUESS: persona judgement]` |
| Period close / roll-forward per wallet | Cryptio checklist (A1, teardown T3) [ASSUMPTION: secondary, search] | Search-level only; plausibly high close impact; test in calls |

## What this means for the roadmap (hypotheses only)
- The two strongest-evidenced pains (wrong network, short after fees) are also the ones gateways already publish settings and help for. So the open question is **what share of a buyer's payments skip the checkout** [INTERNAL: OBJECTIONS.md]. Ask it in every call.
- The pain that the only real conversation stressed (integration into existing systems) has the weakest *public* evidence and comes from an advisor. It deserves the most call questions, not the most roadmap weight yet.
- High close-impact items (auditor evidence, period roll-forward) are evidence-poor, not proven unimportant. research-intern can open the blocked primary pages; real calls can confirm or kill them.

1 conversation (advisor), 0 buyer interviews: this ranking is a hypothesis list, not market evidence.

Source-tie rate: 5 ranked + 6 below-the-line items = 11; all tie to a labelled source or state their only basis; 1 (approvals) rests mostly on `[GUESS]`. **10/11 ≈ 91%.**

## Log (live tools off)
WOULD WRITE: Log row "SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. pain ranking: calls 1 (buyers 0), sources 14 (8 opened by pack, 6 search), top3 [wrong network, short after fees, exception workload]. Report: team/feedback/crypto-finance-user/2026-10-31-pain-ranking.md".
WOULD WRITE: Log note "for product-manager / gtm-strategist: SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. Pain ranking = hypotheses to test in real calls; Mom-Test question per pain in report."
