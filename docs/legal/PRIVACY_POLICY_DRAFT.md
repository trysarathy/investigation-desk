# DRAFT FOR LAWYER REVIEW — not published, not legal advice

# Clearline — Privacy Policy (draft)

Working draft only: not in force, not linked from the product, not shown to anyone outside the company. Square brackets
mark facts still to be decided. It does not claim compliance with any law. Its facts come from
`docs/privacy/RECORDS_OF_PROCESSING.md`.

## 1. Who this is about

- **Staff of our customers** (merchants and payment providers) who use Clearline, and people invited to it.
- **Our customers' own customers** (payers), whose details may appear in the records our customers upload, such as an
  order reference, a wallet address, an amount or a bank statement description. For this data our customer decides why
  and how it is processed; we process it on their instructions (see the DPA). [Lawyer: confirm the roles.]

## 2. What we collect and why

| Data | Why | Basis [Lawyer to confirm per law] |
|---|---|---|
| Name, work e-mail, role, organisation | To give you an account | Contract with your employer; legitimate interest |
| Password (stored only as a hash), second-factor and passkey details | To keep your account secure | As above |
| Session times, IP address, browser type, last sign-in | Security and access reviews | Legitimate interest |
| Hashed or keyed traces of failed sign-ins | To stop password guessing (kept about a day) | Legitimate interest |
| Your actions in the product (audit log), approvals | Maker-checker controls and an audit trail | Legitimate interest; [legal obligation?] |
| Records your organisation uploads | Reconciliation for your organisation | On your organisation's instructions |

We do not sell personal data, use it for advertising, or make automated decisions about individuals. The matching
rules decide whether records agree; people decide what to do about it.

## 3. Who receives it

- **Chain data providers** receive wallet addresses and transaction hashes when on-chain checks are switched on
  ([vendors to be named]).
- **Hosting** [provider and region to be named].
- **E-mail delivery** [none connected yet; provider to be named].
- **Your payment provider**, if your organisation grants it access (aggregates by default).
- Authorities, where the law requires.

We do not send customer data to AI model providers.

## 4. Transfers abroad

[To be completed when hosting and vendors are chosen: countries, and the safeguard used for each transfer under
Singapore's PDPA (Transfer Limitation Obligation) and the UAE PDPL (adequacy or approved safeguards).]

## 5. How long we keep it

- Uploaded files and data derived only from them: 90 days by default, or the period your organisation's Admin sets.
- Sign-in failure and rate-limit traces: about one day. Sessions: until they expire or you sign out.
- Audit events and approvals: [7] years from each event.
- If your organisation is deleted: everything is deleted, except audit events and approvals, which are kept for the
  rest of that period in a minimal form with no names, e-mail addresses, free text, references or identifiers.
- Backups: [to be decided].

## 6. Your choices and rights

You can ask to access, correct or delete your personal data, or to receive a copy, at [privacy contact]. If the data
was uploaded by your employer or by a business you paid, we will pass your request to that business, which decides
on it. [Lawyer: response times; rights under PDPA (access, correction, withdrawal of consent, data portability when in
force) and PDPL (access, portability, correction, erasure, restriction, objection).] You can complain to the
Singapore Personal Data Protection Commission or the UAE Data Office [or the DIFC / ADGM commissioner].

## 7. Security

Data of each organisation is separated in the database; staff sign in with a second factor where their role requires
it; uploaded files are encrypted at rest; exports are encrypted and signed. No system is perfectly secure. If a breach
affects you, we will tell you and the regulators as the law requires.

## 8. Contact

[Data protection officer / contact person, address, e-mail]. [Lawyer: PDPA requires a designated DPO contact; does the
PDPL require a DPO for us?]

---

## Open questions for the lawyer

1. Are we a data intermediary (PDPA) / processor (PDPL) for uploaded records and a controller for account data? Does a
   payment provider customer change that?
2. Are wallet addresses and order references personal data under PDPA and PDPL? (docs/LEGAL_QUESTIONS.md, question 5;
   we treat them as personal data meanwhile.)
3. Legal bases under the PDPL for staff account data and audit logs; is consent needed anywhere?
4. Does the PDPL apply to customers in DIFC or ADGM, or do those free-zone laws apply instead? Does the PDPL's exclusion
   of some banking and credit data matter here?
5. The 7-year retention period for audit and approvals: required, permitted, or too long?
6. Cross-border transfer mechanism for each vendor and hosting region.
7. Breach notification: PDPA's notifiable-breach thresholds and timelines; the PDPL's notification duty to the Data
   Office and to individuals.
8. Do we need a DPO, a registration, or a record-of-processing filing in either country?
9. How should requests from payers (our customers' customers) be routed and answered?
10. Children's data: none expected; is a statement needed?
