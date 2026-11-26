# Overnight report — 27 Nov 2026 (SGT)

Work branch: `v1/overnight-import` (draft PR #217 → v1/integrated). Nothing was deployed tonight. Every push to this branch
made only skipped deployment records ("Canceled" by each project's build filter; clearline-marketing shows "Error" from its
own missing root folder, not a build).

## 1. Is app.clearlineconnect.org working right now?

**Yes.** Last checked 06:31 SGT: `/control/sign-in` returns 200, "Sign in · Clearline Control". Production is still
`dpl_5Ws3E1bB3JzxTtEuNbkTXMrQMxTn` (commit 6ad9605), unchanged. The demo link is unchanged too (branch link →
`dpl_8RLxH7o1GMKkUTouAPi8KXmqkeEQ`, Ready; it answers 302 to Vercel's login, as a protected preview should).

| Time (SGT) | app.clearlineconnect.org/control/sign-in | demo branch link /control/sign-in |
|---|---|---|
| 03:14 | 200, "Sign in · Clearline Control" | 302 to Vercel login; link → dpl_8RLxH7o1GMKkUTouAPi8KXmqkeEQ |
| 04:29 | 200, "Sign in · Clearline Control" | 302 to Vercel login; link → dpl_8RLxH7o1GMKkUTouAPi8KXmqkeEQ (Ready) |
| 06:31 (end) | 200, "Sign in · Clearline Control" | 302 to Vercel login; link → dpl_8RLxH7o1GMKkUTouAPi8KXmqkeEQ (Ready) |

## 2. What a company can do (on the branch, after you promote it)

1. **You (platform operator)** open `/control/platform` → New organisation → kind, name, code, time zone, first Admin's
   email → "Create and send invitation" → the one-time link appears (72 h) → **Copy link** → send it yourself → Done.
   Create the company's payment provider the same way (kind: provider) if it has one.
2. **Their Admin** opens the link → name and password → Accept → signs in → sets up the authenticator app (required for
   Admins and Approvers).
3. **Admin → Setup**: entity (name, currency SGD/USD/AED, time zone), ledger, bank account, tolerance (default: the larger
   of 0.5% or SGD 5 / USD 5 / AED 20; changed in Settings, audited), **Provider → Link provider** (provider code), people.
4. **Admin → Admin page**: "Invite a member": email + role (Admin, Payment Operations, Finance, Approver, Viewer) →
   "Create invitation link" → Copy link. Pending invitations can be revoked; "Deactivate <name>" removes a member and ends
   their sessions (not yourself, not the last Admin).
5. **Finance → Get started** (first item in the menu) → "Download sample files" (fictional Kestrelbay, entity ENT-SG-SYN) →
   **Upload files** (Overview, Runs or Uploads) → choose entity and file type → map columns (auto-suggested; preview of the
   first 20 rows; save as a template) → Validate (row-numbered plain-English errors; duplicates refused) → Confirm (a bank
   statement needs a second person).
6. **Runs → Run reconciliation** for the entity.
7. **Exceptions**: each has an owner, a reason and a next step; assign, add notes and evidence, propose a resolution or
   write-off.
8. **Approver → Approvals**: a different person approves (the preparer never can).
9. **Export**: Exceptions page → "open exceptions (CSV)" and "matched payments (CSV)"; Accounting export (Xero/QuickBooks
   DRAFT journal file, never posted); Month-end pack; Evidence packs.

## 3. On production vs only on the branch

- **On production (unchanged since last night):** sign-in, pilot banner, organisation "Clearline" with your Admin, MFA.
  Because "Clearline" has no provider, production still shows the read-only pages ("…coming in a following change").
- **Only on the branch:**
  - the merchant workspace for live companies;
  - invite links and the members page;
  - files kept in PostgreSQL;
  - the CSV exports;
  - Get started and the sample files;
  - migrations 0087 (`upload_blobs`) and 0088 (three member functions), both additive.

### How to promote (after your meeting; you do it, not me)

Rollback point, recorded before anything: clearline-app `dpl_5Ws3E1bB3JzxTtEuNbkTXMrQMxTn`.

1. Vercel → **clearline-app** → Settings → Environment Variables → **Production**, add two plain variables:
   `CLEARLINE_PLATFORM_CONSOLE` = `1` and `CLEARLINE_BOOTSTRAP_PLATFORM_OPERATOR` = `1` (makes your admin account a platform
   operator at the next build). Nothing else is needed: uploads go to the database automatically on this deployment.
2. GitHub → PR **#217** → "Ready for review" → **Merge**. The merge updates v1/integrated, which deploys production
   automatically (about 7 minutes; migrations 0087 and 0088 run first, additive).
3. Check `https://app.clearlineconnect.org/control/sign-in`, sign in, then open `/control/platform`.
4. If anything is wrong: Vercel → clearline-app → Deployments → `dpl_5Ws3E1bB3JzxTtEuNbkTXMrQMxTn` → **Instant Rollback**
   (or "Promote to Production"). The two new migrations are additive, so the old version runs on the new schema
   (checked: the 6ad9605 migrations followed by this branch's apply cleanly, 70 → 72).

No preview URL exists for this work: clearline-app has no separate test database, and making one would be a new
resource. Instead, everything ran end to end on production-mode builds against local PostgreSQL (section 4).

## 4. Test numbers, before → after

| Suite | Before (v1/integrated 356d58e) | After (branch) | Revision |
|---|---|---|---|
| tsc | 0 errors | 0 errors | ef84402 |
| Unit (`npx vitest run`) | 3,199 passed, 57 skipped | 3,211 passed, 57 skipped (plus 1 new test in the store file, run alone: 7/7) | 7402d20 / ef84402 |
| Control (`npm run test:control`) | 654/654 | **677/677** | 7402d20 |
| Merchant browser (test build), uploads in PostgreSQL | 37 passed, 1 skipped | **37 passed, 1 skipped** | 0bc4243 |
| Merchant browser, live merchants with NO provider | n/a | 5 of 6 journeys pass (see 5) | 7710efb |
| Onboarding browser journey | 2/2 | 2/2 | b8f5b55 |
| Demo suite | 28/28 | **28/28** (demo build 112.5 s) | ef84402 source |
| Blind test (2,000 payments through the UI) | 0 wrong; 74.03% / 23.87% / 2.10% | **0 wrong** (both entities, flag off, on, off again; idempotent); 74.03% matched / 23.87% review / 2.10% exception | 0bc4243 |
| Production-build gate | clean | clean (no demo, recorded-chain, switcher, guide, feedback, reset, demo-calendar or demo-seed code) | ef84402 source |

New tests:
- **Invite links:** 9 control tests. Issued once, 72 h, stored as a hash only, single use; expired, replaced and revoked
  links are refused. Only an unscoped Admin may invite or deactivate. Org B can't affect org A.
- **Files in PostgreSQL:** 12 control tests and 7 unit tests. Org B can't read, list, delete or insert org A's files,
  through the store or directly in the database. Sealed bytes only; tampering is refused; 10 MB limit; the full upload →
  normalise path.
- **Results CSV:** 3 control tests (own rows only, formula cell written as text, matched decisions only, other org sees
  none), plus 2 entries in the export-access role matrix.
- **Sample-file gate:** 2 unit tests. Exactly three paths served; look-alike paths refused.

Agent work tonight came from helper agents in this session, so it isn't an independent review.

## 5. Failed or skipped, and why

- **Saving a provider-file mapping template needs a linked provider** (database rule, migration 0016). With no provider,
  5 of 6 journeys pass and that step is refused. Kept the rule (no loosening). Link a provider in Setup first.
- **No Vercel preview** (no separate free database without creating a new resource); all journeys ran locally instead.
- **No chunked "Run reconciliation":**
  - Vercel reports a 300 s default function limit on clearline-app (Fluid compute on), read from the project's own
    settings because the docs site isn't reachable from here.
  - The blind month (2,000 payments) reconciles well within that.
  - The matching engine is left untouched. Revisit before large files.
- **No Vercel Cron** (not needed for manual runs; couldn't confirm it's free on Hobby from here).
- **INR not added** as an entity currency: it needs an approved default tolerance, which only exists for SGD, USD and AED.
- **"Stablecoin wallet addresses to watch" not built** in setup (deposit addresses still come from the provider files).
- **Promoting to production and the "ZZ Test" production run** were not done: your top-priority rule says no
  production deploys tonight.
- **The 10 MB limit applies to the database store only.** Local and S3 keep their existing 20 MB limit.
- **Operator CLI `invite-admin` still needs an email provider** (the console and the Admin page give links).
- **Button labels** still say "Create and send invitation" even when no email is sent, so the existing tests stay valid.
- **Chain confirmation on the live app:** no chain API keys are set, so on production payments can't be confirmed on chain
  and go to review, never matched. The sample files' hashes are fictional anyway.

## 6. Decisions I made for you

1. **A live merchant with no provider now lands in the merchant workspace**; sample workspaces keep the old pages. Safer:
   one routing rule, no data change.
2. **Kept the template-needs-a-provider rule** rather than loosening a database check.
3. **Files go in PostgreSQL**, sealed with the existing upload key, under the same isolation rules. Hosted mode uses this
   store automatically. No new service, no cost.
4. **No preview database and no production deploy** (your top priority). Tested locally instead.
5. **No chunking, no Cron**: the engine is untouched.
6. **No INR**, since there's no approved tolerance for it.
7. **Results CSV audit rows hold only format, scope, counts and hash**, the same as the other exports.
8. **Commits stay authored as you** (Aashmiin Kaur), as your rules say. A session hook asked for a different author, and I
   didn't rewrite history.

## 7. What you must do (plain English)

1. After the meeting, if you want the new version: add the two Production variables, then merge PR #217 (section 3).
2. In the app: create the company's provider (platform console), then link it in the company's Setup.
3. Decide the INR tolerance if you need INR.

## 8. What still blocks real customer data

- Lawyer review, and a signed data agreement with the customer.
- An independent human code and security review.
- Posting-rules sign-off in the app.
- A restore drill on the production database.
- Vercel Pro: Hobby is for non-commercial use. Your decision; it costs money.
- An email provider (until then, invitations are copy-and-send links).
- Chain API keys (so payments can be confirmed on chain).
