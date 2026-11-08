# Clearline Funding Desk — interactive mentor demonstration

**Demo entry point:** `/mentor-demo` on the `demo/mentor-funding-desk` branch. This is a separate, self-contained, browser-only, fictional experience. It does **not** require GitHub Codespaces, a password, a private data directory, a database or the `CLEARLINE_ORIGIN` setting. It is safe to run as a public preview *only because no real customer data, actual credentials or payment APIs are used.*

## What the mentor can see

1. **Work queue:** the compact pilot operating desk layout: horizontal navigation, search, grouped status rows and live counts for review, evidence requests, cutoff, overdue, partial repayment, unmatched cash and open cases.
2. **Approvals:** five deterministic rules — invoice uniqueness, exposure limit, existing overdue debt, terms and provider-designated free cash. Operator prepares; simulated treasury approver may approve/decline with a reason. Viewer cannot change records.
3. **Outstanding ledger:** an approved advance can be marked supplier-paid only on/after its payout date. A receipt explicitly allocated to its invoice reduces the still-owed amount. No money moves.
4. **Exceptions:** overdue advances, partial repayments and an unmatched receipt, with a plain-English daily digest.
5. **Evidence:** an event timeline and JSON evidence export with SHA-256 digest of the evidence payload.
6. **Settings:** explanation of provider cash restrictions and CSV / illustrative balanced accounting journal exports.

A simulated **New case** form and **Import sample CSV** button let the mentor create a fictional advance or import a bundled one-row example; there is no real CSV file upload on this public route. All state is held in memory in the user's browser for the current page. **Refreshing resets the example.** The `Reset demo` control does the same intentionally. No user input is sent to a provider, and any actions labeled approval, payout or repayment are fictional. This is a simulation, not a secure multiuser system, audited ledger, signed treasury authorization or legally approved safeguarding method.

### Five-minute guided workflow

At the initial simulated date **9 Nov 2026**, the proposed `ADV-001` amount is SGD 100,000.

- From **Work queue**, click **Open advance review** (or select the `ADV-001` grouped row), inspect all five checks and click **Prepare advance** as the operator.
- Change **Acting as** to `Daniel · Treasury` and click **Approve** with a reason.
- Open **Outstanding ledger**, switch back to `Maya · Operator`, set **Replay date** to **10 Nov 2026**, and click **Record supplier paid**.
- Change **Replay date** to **19 Nov 2026**. Click **Record customer repayment** for the seeded SGD 40,000 amount. The still-owed principal is SGD 60,000.
- Open **Exceptions** to see overdue and partial-repayment flags, and download the daily digest.
- Open **Evidence** for the selected advance and download the synthetic evidence JSON, or **Demo settings** for export samples.

The initial page also includes fictional past advances `ADV-002` and `ADV-003` so that the ledger is not empty. They are samples, not real customers or earnings.

## Technical verification

```sh
npm ci
npx vitest run tests/funding/mentor-demo.test.ts
npx tsc --noEmit
npx next build
```

On GitHub Actions, `mentor-browser.yml` separately tests the public synthetic demonstration on desktop and phone. The private authenticated funding desk retains its own independent browser suite. See the CI check runs attached to the pull request for actual results; do not claim they passed unless they did.

### Limits / next stage

The mentor route demonstrates the workflow but is not connected to the private M1–M8 engine or provider records. Its safeguards are teaching/examples and need independent review before use with real data. A real provider pilot would connect approved file imports and reconciliations to the existing M1–M8 engine, preserve an append-only authenticated audit trail and undergo safeguarding/legal and security review. Merging into main remains founder-approved only. Never show the standalone mentor demo as a production-connected product.
