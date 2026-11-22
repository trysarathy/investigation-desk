# Reconstruction data handling (rc6 phase 10)

How we receive, keep, use and delete a payment provider's anonymised data for a **Case Reconstruction**: one day of
their payments rebuilt on a laptop with `scripts/reconstruct/reconstruct.ts`.

**The rule: nothing leaves the laptop.** The tool makes no network call, uses no database and uploads nothing. The
provider's files and the reports stay on the machine of the person running the reconstruction until they are
deleted. They are never committed, never uploaded (not to Drive, Slack, email, an issue, a PR, a CI run or the pilot
server), and never pasted into a chat or an AI tool.

## 1. Receiving the data

1. Ask the provider for **one day** of data, anonymised on their side before it is sent:
   - the payment export (CSV or JSON) and, if they have one, its column list;
   - the settlement report for that day (JSON);
   - the bank statement lines for the settlement credit (CSV, the rc5 statement format: `line_id, account_ref,
     value_date, direction, kind, amount, currency, reference, counterparty`);
   - optionally invoices and quotes (CSV or JSON), the on-chain transfers they recorded (`chain.json`) and FX rates.
2. Anonymised means: no customer names, emails, phone numbers, account holders, IP addresses or free-text notes about a
   person. Order and payment IDs may be replaced by stable pseudonyms, as long as the same ID is replaced the same way
   in every file.
3. Ask for the files through the channel the provider proposes for confidential data (their own secure transfer, or
   an encrypted archive with the password sent separately). Do not ask for them by email attachment or chat.
4. Write down who sent what, when, and the agreed deletion date (section 5). Keep that note outside the data folder.

## 2. Where it lives

Inside a checkout, provider data may live **only** under `reconstruction-data/`, which is git-ignored
(`.gitignore`: `reconstruction-data/`). Anywhere outside a git repository is also accepted.

```
reconstruction-data/
  <provider>/<day>/input/     # the provider's files, as received (renamed to the names below)
  <provider>/<day>/report/    # written by the tool
```

The tool reads these names in `--in` (anything else is listed as not read):

| File | Content |
|---|---|
| `day.json` | provider name, day, the merchant entity (`id`, `name`, `functionalCurrency`, `timeZone`), optional `addressFacts` and tolerance policy |
| `mapping.json` (or `--mapping <file>`) | the provider's column mapping: `{ "provider": "...", "columns": { "<their column>": "<Clearline field>" } }` |
| `provider-export.csv` / `.json` | the payment export |
| `settlement.json` | the settlement report (`batches` + `lines`, or `totals`) |
| `bank-lines.csv` | bank lines, read under the rc5 statement CSV rules (all-or-nothing) |
| `chain.json` | recorded on-chain transfers (optional; no chain is ever queried) |
| `fx.json`, `invoices.*`, `quotes.*` | optional |

The tool **refuses**:
- to run at all when `CI` is set;
- an `--in` or `--out` inside a git repository that is not under that repository's `reconstruction-data/`, or when
  `reconstruction-data/` is missing from its `.gitignore` (the bundled fictional sample under
  `scripts/reconstruct/sample/` is the only exception, for `--in`);
- an `--out` that already holds files it did not write, or whose parent directory does not exist.

It writes only `report.json`, `report.html`, `report.csv` and its manifest `.clearline-reconstruction.json`, only inside
`--out`, with owner-only permissions.

Before you start, check that git ignores the folder (both commands must print the path / nothing to commit):

```bash
git check-ignore -v reconstruction-data/
git status --porcelain --ignored reconstruction-data/   # shows "!! reconstruction-data/" (ignored), never "??"
```

## 3. Running it

```bash
npx tsx scripts/reconstruct/reconstruct.ts \
  --in  reconstruction-data/<provider>/<day>/input \
  --out reconstruction-data/<provider>/<day>/report \
  [--mapping reconstruction-data/<provider>/mapping.json] [--generated-at 2026-11-25T09:00Z]
# or: npm run reconstruct -- --in ... --out ...
```

- Output does not depend on the clock: the same input gives byte-identical files. `--generated-at` is only a label.
- Every output carries **"Reconstruction · anonymised provider data · not for distribution"**. Output from the bundled
  sample carries **"Test mode · illustrative data"** instead.
- Open `report.html` in a browser (it is self-contained: no script, font, image or link is fetched), or open
  `report.json` on the pilot screen `/control/merchant/reconstruct`, which reads the file **in the browser only**; it
  is never sent to the server.
- Try it first on the fictional sample: `--in scripts/reconstruct/sample/case1` (Case 1) or
  `--in scripts/reconstruct/sample/incomplete` (unmappable fields and questions), with `--out` outside the repository
  or under `reconstruction-data/`.

What you may share: the **questions to ask the provider** and the **unmappable fields** list, retyped or copied as text
to the provider who sent the data. Nothing else from a report leaves the laptop. Screenshots of a real report are not
taken.

## 4. Wallet addresses are possibly personal data

Deposit addresses, sender addresses and transaction hashes identify wallets, and a wallet can be linked to a person
through public chain data and exchange records. Treat every address and hash in the provider's files and in a report as
**possibly personal data**, even after anonymisation: they are kept on the laptop, never posted anywhere, never
looked up on an explorer or analytics service from the reconstruction (that would disclose them to a third party),
and deleted with the rest. Sender facts (an exchange hot wallet, an intermediate hop) are recorded facts, never a
judgement about the person.

## 5. Deletion, on request or when done

Delete at the latest on the agreed date, at once when the provider asks, and at the end of the sprint.

```bash
# 1. The reports the tool created (it lists first, deletes only with --yes; only files it wrote and left unchanged):
npx tsx scripts/reconstruct/reconstruct.ts --purge reconstruction-data/<provider>/<day>/report
npx tsx scripts/reconstruct/reconstruct.ts --purge reconstruction-data/<provider>/<day>/report --yes

# 2. The provider's own files (the tool never deletes data it did not create):
rm -rf -- reconstruction-data/<provider>/<day>/input
rmdir reconstruction-data/<provider>/<day> reconstruction-data/<provider> 2>/dev/null || true

# 3. Anything else: the archive you received, any copy in ~/Downloads, the browser's download history.
rm -f -- ~/Downloads/<the archive the provider sent>

# 4. Check nothing is left:
ls -la reconstruction-data/
git status --porcelain --ignored reconstruction-data/
```

`--purge` refuses a directory without the tool's manifest, a manifest that lists anything other than its own three
outputs, and any directory inside the repository but outside `reconstruction-data/`. A report file changed since the
tool wrote it is kept and named, so a person decides. If the laptop has backups (Time Machine or similar), exclude
`reconstruction-data/` from them, or delete the backup copies too. Then confirm the deletion to the provider in
writing, with the date.

## 6. If something goes wrong

- A provider file was committed: do not push. Remove it from the commit (`git reset --soft HEAD~1`, then
  `git restore --staged <file>`), delete it, and tell the founder. If it was pushed, tell the founder at once: the
  history must be rewritten and the provider informed.
- A report or file was uploaded or sent anywhere: delete it there, tell the founder, and inform the provider.
