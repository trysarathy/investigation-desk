# Operating a private funding desk

[VERIFIED — `src/lib/funding/`, `src/app/api/funding/route.ts`] This desk stores a provider's files and records decisions made by its named users. It does not authenticate a bank statement, approve credit on treasury's behalf, initiate a payout or send an accounting entry. Use supplied records and the provider's own controls to establish whether a supplier was paid.

## Deployment boundary

[ASSUMPTION — deployment requirements for the provider to implement]

- Run one Node server process for one provider, with a private persistent data directory outside the repository and every web-served directory. Do not use a public static host or an ephemeral serverless filesystem for the data store.
- Terminate HTTPS at the provider's chosen host or reverse proxy and configure the exact public origin. Limit infrastructure access to the provider's administrators. Keep the data directory, backups and diagnostic logs out of public downloads.
- The provider chooses its hosting region, backup location and administrators. This software does not establish data-residency, privacy-law or banking compliance merely by being deployed privately.
- Operators prepare cases and supply evidence. A different approver records the credit decision and reason. Viewers are trusted internal readers: they can see the provider's records and export evidence. A viewer is not a customer-specific external guest.
- Keep production identities separate from synthetic walkthrough identities. Never copy a sample workspace into a live provider deployment. The browser test password is generated for an isolated test job; it is not an application default.

## What the history can prove

[VERIFIED — integrity mechanism in `src/lib/funding/audit.ts`; source-truth limitations follow from the absence of independent source signatures]

The retained CSV bytes, column mapping, source hashes, check snapshots and named decisions make an investigation reproducible. The audit chain is intended to detect edits, missing entries and reordering when checked against its retained history and a separately trusted head. It is not a signature from a bank, a trusted timestamp service or write-once storage.

A deployment administrator who can replace all records and hashes can construct a different internally consistent history. Keep trusted audit heads outside that administrator's ordinary write path if that threat matters. Agree an independent retention location and reviewer with the provider before relying on an anchor. Do not claim that a successful checksum alone establishes what really happened or when somebody first knew it.

An exported evidence pack can contain complete source files with other advances or later rows. Review its contents and recipients before sharing. Deterministic pack hashes cover the specified input snapshot; downloading that same snapshot again should not change it merely because a new export audit event was recorded.

## Retention: a provider decision

[ASSUMPTION — operating policy to agree before a real pilot] The provider must name an owner and set a retention period for original inputs, decisions, audit records, output files, logs and backups. Ask its counsel and auditor about applicable retention obligations and legal holds. Safeguarding classifications remain provider-supplied and **need counsel**.

This release does not silently expire individual records or run an automatic deletion scheduler. In-place removal of one advance's imported rows can break other advances, reconciliations and the history that explains a past decision. Do not edit the JSON files to implement a deletion request.

For a deletion request:

1. Verify the requester, the affected provider and the data involved. Record the request and the responsible decision-maker in the provider's own restricted request register.
2. Check legal holds, contractual requirements and whether a redacted export would meet the request. Aashmiin or Clearline does not decide those obligations for the provider.
3. For a whole-workspace deletion approved by the provider, stop the server, revoke access and remove the deployment's data and credentials through its infrastructure process. Include temporary export directories, operator downloads, logs, snapshots and backups according to the approved policy.
4. For a selective request, stop and scope a reviewed redaction/migration rather than editing live history. Record what remains necessary and why. Selective historical erasure is not implemented in this release.
5. Have the provider verify the result, record any backup expiry or hold that prevents immediate completion, and send its own response. File deletion is not a claim of secure erasure from every storage medium.

These are procedures for the provider to execute. The application does not send a deletion response, delete backups or promise that a record is gone from a recipient's downloaded evidence pack.

## Back up and restore

[ASSUMPTION — procedure to test and adopt with the provider's infrastructure owner]

Take a consistent backup with the single application process stopped. Preserve the data file, access configuration, approved export mapping and a separately retained audit anchor. Protect the backup as carefully as the originals; it includes sensitive inputs and password hashes.

Restore into a new private directory, verify the audit history against the trusted anchor and review the input/decision reconstruction before allowing users back in. Restore credentials only through the provider's approved process; rotate them if their confidentiality is uncertain. A server restart invalidates memory-held sessions. Test restoration using synthetic data before a real pilot.

An interrupted writer can leave a writer-lock directory. Stop all processes, preserve evidence, inspect the stored file and verify it before removing a stale lock. Age alone does not prove a lock is safe to remove. A failed verification must stop writes; do not reset the store to an empty dataset.

## Before a provider trial

[ASSUMPTION — required operating agreements, not commitments obtained from a customer]

Agree the named operator and approver, account ownership, cash classifications, completeness of obligations, freshness policy, repayment references and controller-approved journal mappings. Test a real export format with redacted files and check totals against the provider's own records. Journal files are cumulative snapshots: importing the same or overlapping snapshot twice can duplicate accounting entries.

This is a single-process pilot architecture. External penetration testing, high availability, managed disaster recovery, external audit anchoring and real ERP import certification have not been established by unit or browser tests. Read the milestone validation notes for the checks actually run.
