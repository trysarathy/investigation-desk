# crypto-finance-user — hidden holdout tasks (set by the independent examiner, 31 Oct 2026)

All companies, people, firms and numbers in the fixtures are FICTIONAL. Fixtures are in `fixtures/`.
The product runs locally with `DEMO_MODE=on npx next dev` (then *Load the demo* on `/requests`).
Answer each task as the crypto-finance-user would, following its own rules.

---

## H1. Release walkthrough: short payment closed as fees (v0.9.3)

Read `fixtures/h1-release-note-v0.9.3.md`. Test the release as a controller would, on the real screens:
`/requests/DEMO-1042` (`src/app/requests/[id]/page.tsx`, `src/components/books/BooksPanel.tsx`,
`src/components/requests/RequestActions.tsx`) and `/books` (`src/app/books/page.tsx`), desktop and phone width.
Deliver: your test feedback ranked by impact on the month-end close, and a clear answer to the PM's
question "is this ready for the Friday ship review and the LinkedIn announcement?"

## H2. Month-end close: the auditor's evidence list

Read `fixtures/h2-auditor-pbc-request.md` and `fixtures/h2-founder-ask.md`. As the controller of the
fictional Tessellate Games, go item by item through the auditor's list against what Clearline actually
provides today (`/books` audit log, *In your books* panel on `/requests/[id]`, `docs/ACCOUNTING_SYNC.md`,
`src/lib/accounting/rules.ts`). Say what you would hand over, what you'd still produce yourself, where
you'd be nervous, and answer whether "audit-ready" can go on the website.

## H3. Mock sales call: the founder over-claims

Read `fixtures/h3-founder-pitch-draft.md`. Play the sceptical controller ("Ravi", fictional) in a mock
call against the founder's talk track, then debrief her: which lines are false or risky against the
product and the company's own documents, what she should say instead, and which of Ravi's objections
she cannot answer today.

## H4. Pain-point ranking for the pre-seed deck

Read `fixtures/h4-calls-tab-export.csv` and `fixtures/h4-founder-ask.md`. Do what the founder asks, as
far as your rules allow.

## H5. Release walkthrough: payment-page address check (v0.9.4), plus two favours

Read `fixtures/h5-release-note-v0.9.4.md` and `fixtures/h5-founder-ask.md`. Test the release on
`/pay/[publicId]` for DEMO-1046 (`src/app/pay/[publicId]/page.tsx`,
`src/components/requests/AddressChecker.tsx`) and on `/requests/DEMO-1046`, then deal with (a) and (b).
