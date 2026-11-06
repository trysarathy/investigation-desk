# Files for the provider's existing tools

[VERIFIED — implementation] Run this from the repository root after `npm ci`:

```sh
npm run funding-export -- --sample --settings fixtures/funding/export-settings.json --as-of 2026-11-19T10:00:00Z --out /tmp/clearline-review
```

Choose a new output directory. For a stored deployment dataset, replace `--sample` with `--data /path/to/funding.json`. The CLI validates stored history, builds files locally and never connects to a bank, sends a message or imports an ERP entry. Sample settings and data are fictional; their confirmation flags are demonstration inputs, not a real controller's approval.

The sample creates open-advances CSV/XLSX, exceptions CSV, generic journals, Xero and NetSuite review CSVs, email/Slack text, a JSON webhook payload, a review notice and a SHA-256 manifest. The report date and native currency appear in the generic records. Open rows distinguish principal still owed from undisbursed commitments. With no exceptions, email and Slack each contain one line: `All clear in the supplied records.` This is not a claim that missing source records are complete.

## Draft accounting policy

[ASSUMPTION — requires the provider's controller] For recorded supplier principal, debit advance receivable and credit payout clearing. For the matched part of a customer receipt, debit receipt clearing and credit advance receivable. For a named write-off, debit write-off expense and credit advance receivable. Unmatched and excess receipts are held outside this receivable export; the bank-feed workflow still needs to account for the actual cash and any unapplied liability. No tax, fee, interest or FX amount is inferred.

[ASSUMPTION — reconciliation contract] Clearing accounts must be provider-confirmed non-bank accounts reconciled against the provider's existing bank-feed entries. The export does not book bank cash again. Receivable here means a controller-selected advance/holding asset account, not an ERP's restricted system trade-debtors account. Account mappings and the no-tax treatment need confirmation in the target organisation.

[VERIFIED — journal safeguards] Each event has at least two lines that balance in one currency. Generic files can retain separate SGD/USD journals. ERP adapters currently accept only the configured base currency; they do not invent exchange rates. Accounting dates use the event's effective instant in the explicitly mapped IANA timezone. There is no silent UTC fallback, period-lock override or date shift. A controller must review closed periods before import.

## File compatibility and sources

[VERIFIED — official Xero page retrieved in this build] Xero documents Narration, Date, Description, AccountCode, TaxRate and Amount fields; positive debit/negative credit amounts, base-currency manual journals and a 300-line template limit. The adapter uses those fields, `dd/mm/yyyy` dates and the provider's exact confirmed no-tax rate label. Source: https://central.xero.com/0/article/Add-import-and-post-manual-journals-AU . Direct rendering returned no readable lines; the official page's text was retrieved through search.

[VERIFIED — official Xero page retrieved in this build] Xero restricts journals to certain bank/system accounts and describes holding accounts. Source: https://central.xero.com/0/article/Import-manual-journals-using-the-Conversion-Toolbox . This is evidence of format restrictions, not approval of Clearline's proposed accounting treatment.

[VERIFIED — Oracle documentation opened in this build] NetSuite describes repeated header fields and an identifying External ID on each line, balanced journals with at least two lines, and `Journal Entry -Line:` account/debit/credit/memo columns. Source: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1534489651.html . The provider must confirm the target account, currency, subsidiary and date mappings. No intercompany workflow is supported.

[VERIFIED — export limits] Unsupported optional ERP settings produce a `NOT-CREATED` reason file while retaining generic files; no currency is silently dropped. The deterministic XLSX uses literal text cells, never formulas, and numeric amounts only within Excel's 15-digit precision limit. Unsafe amounts retain the exact CSV with a workbook refusal notice. CSV formula prefixes, including hidden-format and full-width variants, are neutralized; account mappings that resemble formulas are rejected rather than silently changed.

## Repeated exports are snapshots

[VERIFIED — current design] Stable source event IDs help comparison but do not make repeated imports idempotent. These files are cumulative as-of snapshots, not an incremental posting queue. Compare against previous exports and the ERP before importing. Changed allocations or newly available source evidence can require a reversal or adjustment; no such entry is generated automatically. Treat the manifest as a byte-integrity check, not proof that the source statement or classifications are true.

[VERIFIED — untested externally] No Xero or NetSuite sandbox/live import was run. Confirm templates and mappings in the provider's own test organisation before any accounting use. Message files and webhook JSON are drafts only; this milestone does not send them.
