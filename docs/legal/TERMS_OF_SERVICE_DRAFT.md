# DRAFT FOR LAWYER REVIEW — not published, not legal advice

# Clearline — Terms of Service (draft)

This is a working draft for a lawyer to review and rewrite. It is not in force, is not linked from the product and
must not be shown to customers. Square brackets mark choices or facts still to be decided. Nothing here claims that
Clearline complies with any law or holds any licence.

## 1. Who we are and what this covers

1.1 These terms are between [Clearline legal entity, registered address] ("Clearline", "we") and the organisation that
signs up ("Customer", "you"): a merchant, or a payment provider acting for merchants.

1.2 They cover Clearline Control, the reconciliation software, and any related support.

## 2. What the service does — and does not do

2.1 Clearline reads the records you give it (invoices, provider exports, settlement reports, bank statements, ledger
exports) and public blockchain data, and reports whether each payment matches across them.

2.2 Clearline is read-only. It never holds, sends, converts or settles money or tokens, never holds private keys, and
makes no compliance, screening, sanctions or credit decision. Any such decision stays with you. [Lawyer: question 1
and 3 in docs/LEGAL_QUESTIONS.md]

2.3 A report is evidence, not a guarantee. A payment shown as "matched" means the records agreed under the rules
described in the product documentation at that time; "completed" in a provider's record is treated as that provider's
claim. Imported bank statements are shown as "imported, not bank-authenticated".

2.4 You decide what to approve. The service enforces that the person who prepares a write-off or resolution cannot
approve it; the decision itself is yours.

## 3. Accounts

3.1 You are responsible for who you invite, for their roles, and for keeping sign-in details secret. Admins and
Approvers must use a second factor.

3.2 Tell us promptly at [security contact] if you believe an account is compromised.

## 4. Your data

4.1 You keep all rights in the data you upload. You give us the rights needed to run the service for you.

4.2 Personal data is processed under the Data Processing Agreement (`DPA_DRAFT.md`), which forms part of these terms.

4.3 Uploaded files and data derived only from them are deleted after 90 days by default; your Admin can change the
period for new uploads (1 to 3650 days).

4.4 You may ask for an export of everything we hold for your organisation at any time during the term and for
[30] days after it ends. Exports are encrypted and signed; the passphrase is sent separately.

4.5 You may ask us to delete your organisation. We delete it and its members who belong to no other organisation,
except audit events and approvals, which we keep for [7] years in a minimal form that holds no names, e-mail addresses,
free text, references or identifiers (see the Privacy Policy). [Lawyer: confirm the period and the legal basis]

4.6 You must have the right to give us the data you upload, including any notice to or consent of the people it is
about (for example your customers whose wallet addresses or references appear in it).

## 5. Acceptable use

You will not use the service to break the law, to process data you have no right to process, to probe or attack the
service, to reverse-engineer it except as the law allows, or to give access to anyone outside your organisation
except your provider under a grant you choose.

## 6. Fees

[No in-app payments. Fees, invoicing and taxes under a separate order form — to be drafted.]

## 7. Availability and changes

7.1 We aim to keep the service available but do not promise uninterrupted operation [service levels to be decided].

7.2 Matching rules may change. A rule change never re-decides a payment a person already closed; it raises a notice.

## 8. Confidentiality and security

Each party keeps the other's confidential information confidential. Our security measures are summarised in the DPA
annex. [Lawyer: whether customers that are licensed payment institutions need outsourcing clauses — audit rights,
data location, incident notice; question 2.]

## 9. Liability

9.1 [Cap to be decided, e.g. fees paid in the previous 12 months.]

9.2 Neither party is liable for indirect or consequential loss [subject to what the governing law allows].

9.3 Clearline is not liable for decisions you take on the basis of a report, including payments, refunds, write-offs,
regulatory filings or decisions about your customers. [Lawyer: question 6.]

## 10. Term and ending

Either party may end these terms on [30] days' notice, or at once for material breach not fixed within [30] days.
On ending, clauses 4.4 and 4.5 apply.

## 11. Law and disputes

[Governing law and forum to be decided: Singapore law / courts or SIAC; for UAE customers possibly DIFC or ADGM.]

---

## Open questions for the lawyer

1. Which Clearline entity contracts, and in which jurisdiction?
2. Does the read-only description in 2.2 keep Clearline outside payment services licensing in Singapore (PS Act) and
   the UAE (CBUAE, VARA, DIFC, ADGM)? (docs/LEGAL_QUESTIONS.md, questions 1 and 3)
3. Are outsourcing clauses (audit rights, data location, incident notice, exit) needed for regulated customers?
4. Is the 7-year retention of minimal audit and approval records after deletion justified, and on which basis, in each
   jurisdiction? Is a shorter or longer period required?
5. Liability cap and exclusions enforceable under the chosen law?
6. Wording of the "matched" and "completed" disclaimers in 2.3 — sufficient, or should they be in the order form?
7. Governing law and dispute forum per customer region.
8. Do consumer-protection rules apply to any customer (sole traders)?
9. How should changes to these terms be notified and accepted?
