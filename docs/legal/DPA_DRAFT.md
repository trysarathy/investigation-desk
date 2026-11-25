# DRAFT FOR LAWYER REVIEW — not published, not legal advice

# Clearline — Data Processing Agreement (draft)

Working draft only: not in force, not offered to any customer. Written with Singapore's Personal Data Protection Act
2012 (PDPA) and the UAE Federal Decree-Law No. 45 of 2021 (PDPL) in scope, with GDPR-style clauses where they help.
Square brackets mark open choices. It does not claim compliance with any law.

## 1. Parties and roles

1.1 The Customer (a merchant or payment provider) is the controller of the Customer Personal Data. Clearline processes
it on the Customer's behalf as its data intermediary (PDPA) / processor (PDPL). [Lawyer: confirm.]

1.2 "Customer Personal Data" means personal data in records the Customer or its users upload or that Clearline reads for
the Customer (including order and invoice references, ledger contacts, wallet addresses, transaction hashes, bank
statement descriptions, provider payment ids), and its users' names and e-mails as members of the Customer's
organisation.

## 2. Instructions

2.1 Clearline processes Customer Personal Data only to provide the service described in the Terms (reconciliation,
reporting, exports, deletion) and on the Customer's documented instructions, unless the law requires otherwise; it will
tell the Customer of such a requirement unless the law forbids that.

2.2 Clearline will not sell the data, use it for its own purposes, use it to train AI models, or send it to an AI model
provider.

## 3. Details of processing (Annex 1)

| Item | Content |
|---|---|
| Subject matter and duration | The service, for the term plus the export and deletion periods in clause 9 |
| Nature and purpose | Storing, normalising and matching payment records; reading public blockchain data; reporting |
| Data subjects | The Customer's staff; the Customer's customers (payers) |
| Categories | Identifiers and references, amounts, wallet addresses, bank statement descriptions, staff names and e-mails |
| Special categories | None intended. The Customer must not upload them. |

## 4. Confidentiality

Clearline ensures that people authorised to process Customer Personal Data are bound by confidentiality.

## 5. Security (Annex 2)

5.1 Clearline maintains the measures in Annex 2 and may improve them; it will not materially lower them.

Annex 2 (summary; detail in `docs/privacy/RECORDS_OF_PROCESSING.md` §7): per-organisation separation enforced in the
database (forced row-level security); the application's database login cannot bypass it or change the schema; second
factor required for Admins and Approvers; uploaded files encrypted at rest (AES-256-GCM); append-only audit, approval
and evidence records; maker-checker enforced in the database; logs hold identifiers and counts, not contents; exports
encrypted and signed. [To add before signature: hosting, backups, encryption in transit, vulnerability management,
penetration testing, staff access.]

## 6. Sub-processors

6.1 The Customer authorises the sub-processors in Annex 3. Clearline will give [30] days' notice of a new one; the
Customer may object on reasonable grounds and, if no solution is found, end the affected service.

6.2 Clearline imposes data protection terms on each sub-processor no less protective than this agreement and remains
responsible for them.

Annex 3: [hosting provider — to be chosen]; [chain data providers: TronGrid; Ethereum JSON-RPC provider — to be
confirmed]; [e-mail delivery — none yet].

## 7. International transfers

Clearline will transfer Customer Personal Data outside [Singapore / the UAE] only with a safeguard the applicable law
accepts (PDPA Transfer Limitation Obligation and its regulations; PDPL transfer rules; [standard contractual clauses
where GDPR-style clauses are wanted]). [Lawyer: list the mechanism per vendor.]

## 8. Assistance

8.1 Clearline will help the Customer answer requests from individuals (access, correction, erasure, portability) — the
export and deletion functions in clause 9 are the main tools — and will pass on any request it receives directly.

8.2 Clearline will help with security, breach notification and impact assessments, as far as its role allows.

## 9. Retention, export and deletion

9.1 Uploaded files and data derived only from them are deleted after the retention period the Customer sets (default
90 days).

9.2 On request, and at the end of the service, Clearline provides an export of all Customer data (signed and encrypted;
passphrase by a separate channel) and then deletes the Customer's organisation.

9.3 Deletion removes all Customer data except audit events and approvals, which Clearline keeps for [7] years from each
event in a minimal form with no names, e-mail addresses, free text, references or identifiers, to evidence that
controls operated. [Lawyer: confirm the basis — legal obligation, legitimate interest, or Customer instruction.]

9.4 Deletion does not reach backups immediately; backups are kept for [period] and protected the same way, and a
deletion is re-applied if a backup is restored. [To be designed.]

## 10. Personal data breaches

Clearline will notify the Customer without undue delay, and in any case within [24/48] hours, after becoming aware of a
breach affecting Customer Personal Data, with what it knows and what it is doing. [Lawyer: PDPA requires a data
intermediary to notify the organisation without undue delay; align with the Customer's own 3-day PDPC timeline and
the PDPL's notification duty.]

## 11. Audits

Clearline will make available information needed to show it meets this agreement and allow audits by the Customer or
its regulator [frequency, notice, cost]. [Lawyer: outsourcing guidelines for regulated customers.]

## 12. Liability and precedence

Liability under this agreement is subject to the Terms [unless the law forbids a cap]. If this agreement and the Terms
conflict on personal data, this agreement prevails.

---

## Open questions for the lawyer

1. Roles: data intermediary / processor for uploaded records; controller for account data; does a provider customer
   make Clearline a sub-processor of the provider?
2. Does the PDPL apply to UAE customers in DIFC or ADGM, which have their own data protection laws? Are separate DIFC /
   ADGM clauses needed? Does the PDPL's exclusion of some banking and credit data apply?
3. Status of the PDPL executive regulations and what they require of processors (records, DPO, transfers, breach
   timelines).
4. Transfer mechanism per vendor and hosting region under PDPA and PDPL.
5. Basis and length of the 7-year retention of minimal audit and approval records after deletion.
6. Breach notification window to commit to.
7. Audit and outsourcing clauses for licensed payment institutions (MAS outsourcing guidelines; CBUAE).
8. Whether wallet addresses and order references are personal data (docs/LEGAL_QUESTIONS.md question 5).
9. Liability cap and indemnities for data protection breaches.
10. Whether GDPR clauses are needed at all (no EU customers planned [ASSUMPTION]).
