# Clearline Funding Desk — mentor presentation and five-case replay

This is a **synthetic decision-support prototype** for cross-border payment providers that pay suppliers before business customers reimburse them. Clearline does not move money, issue credit, automate treasury approval or use stablecoins in this product.

## One-command five-case replay

Node 22, from the repository root on the `funding/m8-five-case-replay` branch:

```sh
npm ci
npm run funding-replay-kit -- --sample
```

The runner prints the location of a private temporary directory containing `report.md` and `report.json`. The expected run is under two minutes. The input fixtures are all fictional.

| Synthetic case | Expected evidence |
| --- | --- |
| Repaid on time | Five checks pass; outstanding amount reaches zero before due |
| Declined for insufficient cash | Free cash fails; fictional human treasury decline |
| Late partial repayment | Overdue first, then SGD 40,000 receipt; SGD 60,000 outstanding |
| Duplicate invoice | Same invoice cannot be safely advanced twice |
| Unmatched receipt | Wrong reference must not clear the outstanding advance |

The runner reuses the existing TypeScript import, deterministic advance checks and owed-ledger code. It follows the **as-of evidence** rule from `funding-replay-parity`: only events effective and first known at the original review time influence the original checks. It does not claim to re-run the old Friday/Monday FX timing model.

## Five-minute live mentor walkthrough

Run the actual Funding Desk locally by following `docs/funding/UI_M6.md`. Provide a new private directory and a disposable password. The product launches at `http://127.0.0.1:3000`. Its synthetic logins are `maker@example.test` (operator) and `checker@example.test` (treasury approver); use the password you chose when setting up the fixture.

1. **0:00–0:45:** show one customer, supplier invoice and restricted cash. Cash classification is supplied by the provider and needs counsel.
2. **0:45–1:30:** operator prepares. Sign in as a separate treasury approver to record a named decision. Show that a maker cannot approve their own advance.
3. **1:30–2:15:** record the synthetic supplier payout. The provider is still owed principal even though the supplier payment is recorded.
4. **2:15–3:15:** move the sample clock to 19 Nov 2026, show overdue, record the late SGD 40,000 partial receipt, and show SGD 60,000 still owed.
5. **3:15–4:15:** download the open-advances report and daily exceptions digest, which fit the provider's existing spreadsheets.
6. **4:15–5:00:** download the evidence ZIP and show the five-case replay report, especially a decline and an unmatched receipt.

Use a local deployment, not a public Vercel preview: private persistent data, exact Origin and one server process are required. The browser integration suite runs the same journey on desktop and phone.

## Replaying an authorized provider's five cases

After consent and redaction, create a `cases.json` file using the synthetic manifest's schema and place the canonical CSV inputs beside it. Set original `review_at`, later `reconcile_at`, the **historically reported** treasury decision and actual outcome supplied by the provider. Use the M1 column mapping to turn existing bank, payout and advance exports into the canonical CSVs.

```sh
npm run funding-replay-kit -- --cases /private/cases/cases.json --out /private/new-report-directory
```

Keep the source records and report private. The runner rejects file paths outside the private case directory, includes SHA-256 source hashes and makes no network request. Replay approvals use fictional actors to represent reported decisions, **not** proof of a historical signature. If the original cutoff checks fail, the replay does not manufacture a valid approval.

## Scope and limitations for mentors

- All published fixture cases are synthetic; no real provider installation or willingness-to-pay evidence has been established.
- A matching output proves the code's treatment of supplied facts, not that a bank/payout record is genuine.
- Cash safeguarding, account mappings, retained evidence and counsel-reviewed controls need provider validation.
- M1–M8 are stacked draft PRs and require review before merge. The full repository lint currently has 20 pre-existing errors; do not call the whole repo green.
- No live payouts, ledger postings, automatic messaging, ERP certifications, multi-provider hosting or external security accreditation are established.

**The ask:** Could a treasury/payment-operations owner provide five authorized redacted cases, including a decline and a late repayment, and compare Clearline's flags, timing and setup effort with their existing workflow?
