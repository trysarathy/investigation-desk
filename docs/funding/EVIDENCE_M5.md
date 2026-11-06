# Per-advance evidence files

[VERIFIED] `npm run funding-evidence` builds a deterministic ZIP and detached hashes from the validated funding store. Nothing is sent. This is a provider-internal review file, not a bank-authenticated record or an auditor's opinion.

## Try the synthetic case

```sh
npm run funding-evidence -- --sample --advance advance-1 --as-of 2026-11-19T10:00:00Z --out /tmp/clearline-evidence
npm run funding-evidence -- --verify /tmp/clearline-evidence/evidence.zip --hashes /tmp/clearline-evidence/evidence-hashes.json
```

The output directory must not exist. For provider-deployment data, replace `--sample` with `--data /provider/funding.json`. Do not upload private records to a public demo. Only synthetic data was exercised here.

## Contents and time

- `advance.json`: supplied advance and state at the selected time.
- `inputs/`: complete retained CSV files, with generated safe filenames. `inputs.json` preserves original names, mappings, hashes, import positions and times.
- `decisions/`: the named actor, original policy version and exact stored check snapshot for each preparation, approval or decline. Separate cash files show the recorded free-cash calculation, classifications, reservations and payout evidence from that event's input prefix.
- `repayment-history.json`: receipts, allocations and human write-offs visible at the selected time. A receipt is not itself a repayment.
- `current-position.json`: amount still owed, undisbursed commitment and exceptions at the selected time.
- `manifest.json`: sorted payload paths, byte lengths and SHA-256 hashes.

[VERIFIED] Decision snapshots are not replaced by current-rule calculations. Their import-count boundary preserves which supplied batches existed when the decision was recorded. Effective and known times filter current positions. Imported times and bank assertions remain provider-supplied evidence, not independently verified facts.

Full source CSVs can contain other customers and later-known rows. This preserves original source bytes, but makes the pack unsuitable for unrestricted sharing. The provider must review scope and use an authorised redaction process before sharing. A redacted file is a different artifact with different hashes. No automatic redaction is claimed.

## Integrity and limits

The manifest hashes every payload; it cannot hash itself. `evidence-hashes.json` contains the manifest hash and complete ZIP hash. Retain those expected hashes in a separately trusted record or channel. Merely receiving a ZIP and its adjacent sidecar from the same untrusted sender does not authenticate either.

[VERIFIED] The verifier requires expected archive and manifest hashes, checks exact member sets, lengths and SHA-256 values, checks ZIP CRCs and header consistency, and refuses duplicate names, traversal paths, compressed/unsupported ZIP structures and unreferenced bytes. It reads in memory and never extracts paths. Limits: 64 MiB archive, 4 MiB per member, 256 members. Larger evidence sets must be split before export. Inputs, advance ID, as-of time and simulation flag determine the bytes; there is no wall-clock export timestamp.

Checksums detect changes relative to trusted hashes. They do not prove source authenticity, completeness, bank acceptance, legal validity, or resistance to an administrator rebuilding both archive and hashes. [ASSUMPTION] Provider access controls and retention policy protect the trusted hash record; M7 supplies further audit controls.

[VERIFIED] No PDF is produced: the requested ZIP option is implemented. Files remain in the provider deployment. No private keys, payment execution, email or webhook delivery are present.
