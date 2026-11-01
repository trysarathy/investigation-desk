# State of main (tech-lead-architect notes, 3 Nov 21:12 SGT)

- main @ `0c7d9f1`. Payment requests are **Ethereum only** (`src/lib/requests/check.ts:74`): a payment on another
  network to a request is flagged "this request is Ethereum only". Checking a tx by hash works on Tron, Ethereum, BNB Chain.
- Posting: `PostingLine.date` is "the block time of the transfer, YYYY-MM-DD" and is computed in UTC today
  (`bug/xero-posting-date-timezone`, roadmap order item 1, approval-only per OPERATING_MODEL §2). Branch exists,
  no PR yet. QuickBooks must be fixed the same way.
- Xero: `src/lib/accounting/providers/xero.ts` posts `/Payments`, credit notes (ACCRECCREDIT) and
  RECEIVE-OVERPAYMENT. Live Demo Company test "still to do" (PRODUCT_FACTS).
- Amounts are exact decimal strings (`src/lib/decimal.ts`, `toCents`, `floorCents`).
- Demo mode exists (`src/lib/mode.ts`); the simulated "demo" books provider is separate from a real Xero demo org.
- Security gaps #1 and #2 (demo reset wipes live data; no CSRF + recomputable approval key) are open, approval-only.
- Ruleset on main: pull_request, non_fast_forward, deletion; **no required_status_checks** (as of 1 Nov).
- Engineers available tonight: crypto-protocol-engineer, accounting-integrations-engineer, matching-engine-engineer,
  frontend-product-engineer, devops-engineer, qa-security-engineer, lead-designer. code-reviewer reviews.
- Xero Demo Company OAuth connection: not yet made on the shared preview (needs Aashmiin to click Connect;
  tokens land in `xero-tokens.json`, see SECURITY_GAPS #6).
