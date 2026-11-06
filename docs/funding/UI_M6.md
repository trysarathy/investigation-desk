# Funding desk: provider deployment

The UI is for preparing and recording named treasury decisions, and drilling into exceptions. Open-advance files and the daily digest remain the primary outputs. This is one provider's local deployment, with one Node server process and private persistent files. It is not a shared public demo or a multi-tenant service.

## Synthetic walkthrough

Use Node 22 and a private new absolute directory outside the repository and public web root. Supply your own disposable test password; it is never written to source code.

```sh
npm ci
export CLEARLINE_BOOTSTRAP_PASSWORD='replace-with-your-own-long-test-password'
npm run funding-setup -- --sample --dir /absolute/private/clearline-sample
unset CLEARLINE_BOOTSTRAP_PASSWORD
npm run build
CLEARLINE_FUNDING_DIR=/absolute/private/clearline-sample CLEARLINE_ORIGIN=http://127.0.0.1:3000 npm run funding-start -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. The synthetic accounts are `maker@example.test`, `checker@example.test` and `viewer@example.test`, using the password you supplied. These accounts are only created by explicit `--sample` setup. They are not embedded in the app or created automatically on startup. The simulation banner and explicit UTC clock remain visible.

1. Maker: open advance-1, enter a reason and prepare it.
2. Sign out; checker: open the prepared advance, inspect evidence and record approval or decline with a reason.
3. Maker: advance the simulation clock to 2026-11-10T10:00:00Z, record the synthetic payout file. This records supplied evidence; no bank payment is executed.
4. Move the clock to 2026-11-19T10:00:00Z. Exceptions show the late repayment. Record the synthetic receipt file to allocate SGD 40,000, leaving SGD 60,000 owed.
5. Download the daily digest and open-advances file. Open the advance and download its evidence review ZIP. The outer download contains the evidence ZIP and detached hashes; retain trusted hashes separately.

For a refusal, import a second synthetic advance with a unique ID/invoice, prepare it and ask the checker to decline with a reason. Importing evidence does not create a credit approval.

## Provider setup

Without `--sample`, provide a private users JSON array with `id`, `name`, `email`, `role` and `password` for each named person. Roles are operator, approver and viewer. Run:

```sh
npm run funding-setup -- --users /private/users.json --dir /private/new-provider-desk
```

Keep that plaintext provisioning file private and securely remove it after setup according to your policy. Passwords in `access.json` are salted scrypt hashes. The funding roster and login IDs must agree. User administration is local provisioning; there is no public signup or administrator role in this milestone. Settings displays the current roster.

Configure an exact `CLEARLINE_ORIGIN`, use HTTPS at the host/proxy for external access, and keep `CLEARLINE_FUNDING_DIR` outside any static serving directory. Only one running server process may own the deployment. Sessions are server-memory opaque tokens with an eight-hour absolute expiry; restart signs everyone out. Files persist across restarts. No cloud replication, multi-process session coordination or disaster-recovery service is claimed.

In funding-only mode, the root opens the funding desk and middleware refuses old investigation/stablecoin pages and APIs. Funding routes independently require server authentication, role checks, CSRF tokens and the configured Origin for mutations. A quiet session probe reveals only whether sign-in is required. The server derives the actor and current time; a browser cannot set the credit-decision identity or bypass the checker rule.

## Files and settings

Operators import CSVs and map columns once. Saved mappings prefill the next import. Cash classification appends a complete snapshot; the operator must supply when the bank balance was actually observed. Reclassifying an old balance does not make it fresh. Safeguarding classifications are provider assertions labelled **confirm with your counsel**.

Viewers can inspect all supplied provider records and download review files, including full-source evidence packs. They are trusted internal viewers, not external guests. Do not create viewer accounts for parties who should see only selected customers.

Open-advance CSV/XLSX, exceptions and digests work without accounting mappings. Journal exports require a private `export-settings.json` following M4's documented provider/controller confirmations. They are cumulative snapshots, not an incremental posting queue. Re-import can duplicate entries. Files are downloaded only; no email, Slack message, webhook, ERP import or money movement is sent.

M7 adds the requested audit chain and further security/retention checks. Existing M1–M5 histories and checks remain in force; M6 is not a claim of bank-grade certification.
