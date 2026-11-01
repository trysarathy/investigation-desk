# Common context for all tasks (fixture; read with each task)

All PR numbers, shas, comments and Sheet rows in these fixtures are FICTIONAL test data shaped like
the real GitHub REST and Company HQ responses. The code facts (files, line numbers) are real at
`origin/main` @ `0c7d9f1` unless a fixture says the code changed.

- Repo: trysarathy/investigation-desk. All agents share one GitHub account; each agent signs its
  PR bodies (`Author agent: <name>`) and comments (`by: <name>`).
- Approval-only list (company/OPERATING_MODEL.md §2): keys, wallets, auth, secrets, permissions,
  posting to Xero/QuickBooks, money amounts, customer data, pricing, production/deploy settings,
  deletions.
- ADR 0002 (posting date in organisation timezone) is in `docs/adr/` with status as stated in each
  fixture.
- Unless a fixture says otherwise: PAUSE = FALSE; the Google account is aashmiin@gmail.com.
