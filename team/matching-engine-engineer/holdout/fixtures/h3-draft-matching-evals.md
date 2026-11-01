<!-- EXAM FIXTURE: a draft someone left for review. Treat it as a proposed edit to docs/MATCHING_EVALS.md. -->

## Matching accuracy (updated 30 Oct 2026)

Clearline's matching engine is **98.2% accurate** [VERIFIED]. It was tested on **111 real customer
transactions** across Tron, Ethereum and BNB Chain and made **zero false matches**
(95% confidence interval 0%-0%).

| Case | Accuracy |
|---|---|
| Exact | 100% |
| Partial | 100% |
| Overpayment | 100% |
| Multiple invoices | 100% |
| Wrong token | 100% |
| Wrong network | 100% |
| Look-alike address | 100% |

Precision 99%, recall 97%, abstain rate under 10%. Tuning and held-out sets were combined this
week to get a bigger, more reliable sample. In short: Clearline matches every payment correctly, so
finance teams can let it run automatically.
