# Size and scope

## 1. The limit
Aim < 300 changed lines; **> ~300 cannot auto-merge** (`company/COMPANY_RULES.md` code rules;
`company/OPERATING_MODEL.md` §2). Google: "100 lines is usually a reasonable size … 1000 lines is
usually too large", and reviewers may reject a change "for the sole reason of it being too large".
[VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/developer/small-cls.md opened 2026-11-01]

## 2. How to count
`gh api repos/trysarathy/investigation-desk/pulls/<n> --jq '.additions + .deletions'` (what GitHub shows),
or `git diff --shortstat $MB HEAD`. Report the number in the checks block.
- Counts: source, tests, docs, config, CHANGELOG.
- Doesn't count toward the judgement (say so when you exclude it): `package-lock.json` churn that matches a
  justified `package.json` change; generated files the repo already tracks (e.g. regenerated `.pptx`/`.pdf`
  on `pitch-deck`) when the generator change is in the diff; recorded real chain fixtures under
  `tests/fixtures/` added unchanged.
- Never allowed in a diff at all: `.next/`, `website/out/`, `.data/`, `.env*`, `.onnx` (company code rules)
  → `issue (blocking)`.

## 3. Over the limit
> ~300 counted lines → `issue (blocking)`: "split into: (1) … (2) … (3) …", naming a split that makes
each part reviewable and testable on its own (e.g. tests + pure function first; route + UI second). Still
review the whole diff the same night and list every other finding, so the split doesn't cost a round.
Exception: a mechanical change (rename across files) with no behaviour change may be approved with a
`note` explaining why the size is fine; it still can't auto-merge.

## 4. Scope
- One concern per PR. A drive-by refactor, formatting churn in files the fix doesn't need, or an
  unrelated "while I'm here" fix → `issue (blocking)` if it touches money/dates/auth/posting, otherwise
  `suggestion (non-blocking)` to move it out.
- Spec first: the PR description must carry the spec with acceptance criteria, the roadmap row, the
  demo-mode and real-mode checks run (`company/OPERATING_MODEL.md` §2 items 1 and 7). Missing → `issue (blocking)`.
- `CHANGELOG.md` entry: present, plain English, true (checked against `company/PRODUCT_FACTS.md` and
  `team/CLAIMS_REVIEW.md`; no "every", "all", "automatically", "guaranteed" unless literally true).
  Missing or over-claiming → `issue (blocking)`.

## 5. Base branch and stacked PRs
Review the diff against the PR's own base (`pulls/<n>.base.ref`), whatever it is (`main`, `qa-polish`,
`pitch-deck`, `website-fixes`…). Every PR gets reviewed, including copy-only PRs on content branches
(checklist lines 6 and 8 matter most there). For a stacked PR, note in a `note` which PRs it sits on; your
verdict covers only its own diff at its own head sha.

## 6. Approval-only by path (a quick first filter; the diff content decides)
| Path or content | List item |
|---|---|
| `src/lib/accounting/**`, `src/app/api/accounting/**`, `src/app/books/**` | posting to Xero/QuickBooks (and usually money amounts) |
| `src/lib/accounting/providers/xero-auth.ts`, any `*token*`, `process.env.*SECRET*` | secrets, auth, permissions (OAuth scopes are permissions) |
| `src/middleware.ts`, preview/password/CSRF code | auth |
| `src/lib/payments/money.ts`, `decimal.ts`, any amount arithmetic or tolerance | money amounts |
| `src/lib/csv/**`, exports, uploads, `src/lib/workspace/**`, `DESK_DATA_DIR` handling | customer data |
| `api/demo/reset`, anything that deletes files or records | deletions, customer data |
| Prices, "US$", pilot terms in copy | pricing |
| `.github/workflows/**`, `Dockerfile`, `next.config.mjs` deploy-related keys, env defaults | production/deploy settings (security headers alone: **not** approval-only, per `team/SECURITY_GAPS.md` #5) |
| `src/lib/chain/**` write methods, wallets, keys | keys, wallets (and BLOCK if it signs) |
