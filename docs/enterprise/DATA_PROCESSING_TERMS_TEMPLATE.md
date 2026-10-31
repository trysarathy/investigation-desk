# Data processing terms (template)

> **Template: have a lawyer review before use.** This is a starting draft written by the founder, not legal
> advice. It has not been reviewed by a lawyer in Singapore, India or the customer's country. Square brackets
> are to be filled in per pilot.

**Between:** [Customer legal name] ("Customer", the controller) and [Proprietorship trade name], a sole
proprietorship registered in India, operating the Clearline service ("Provider", the processor).
**Linked to:** the pilot agreement / order form dated [date] (the "Agreement").

## 1. Roles
The Customer decides what data to share and why (controller). The Provider processes it only to deliver the
Clearline service under the Agreement and the Customer's documented instructions (processor).

## 2. Purpose
To create payment requests for the Customer's invoices, read public blockchain data about payments to the
Customer's receiving addresses, match and check those payments, explain exceptions, and, only on a person's
approval, prepare entries for the Customer's accounting system (during the pilot, a Xero-ready import file the
Customer's accountant reviews and imports; no live posting). No other purpose. No sale of data, no marketing,
no model training.

## 3. Data categories
- Receiving addresses, transaction hashes, amounts, tokens, networks, confirmation counts (largely public).
- Invoice data read from the accounting system: invoice ID and number, contact name, currency, amount due.
- Customer references and notes the Customer enters; names typed into "Acting as".
- IP addresses of users, in the audit log.
- Xero OAuth tokens for the Customer's organisation (a credential, not personal data).

Data subjects: the Customer's staff who use the service, and the Customer's own customers (names on invoices).
The Customer should not upload ID documents, emails or phone numbers of its customers; the file validator
refuses email-like customer IDs.

## 4. Location
Hosted in [region, e.g. Singapore] on [hosting provider], or on the Customer's own infrastructure. Chain lookups
and Xero calls reach those services' servers wherever they operate.

## 5. Subprocessors
| Subprocessor | What it does | Data it sees | Used when |
|---|---|---|---|
| [Fly.io / Render / Google Cloud Run], region [ ] | Hosts the app and its data directory | All data in §3 | Provider-hosted pilots (not when self-hosted) |
| Xero Limited | The Customer's own accounting system | Invoice data, postings | If the Customer connects Xero |
| Google (Gmail / Google Workspace) | Support email; pilot notes | What the Customer writes to support; no bulk exports | Always (support channel) |
| Chain data providers: Etherscan, TronGrid, public RPCs (drpc.org, Arbitrum, BNB Chain, Base, Optimism), Blockscout | Read-only blockchain lookups | Transaction hashes and addresses looked up | Live mode |
| Anthropic PBC | Plain-English explanations | Verdict code and evidence with customer IDs removed | **Only if the Customer opts in in writing**; off by default |
| Cloudflare | Tunnel for a demo link | Traffic to a demo | Demo previews only; never with Customer data |

The Provider will give [14] days' notice by email before adding a subprocessor that sees Customer data; the
Customer may object and end the pilot with a pro-rata refund.

## 6. Security measures
As described in `SECURITY_OVERVIEW.md`, including what is **not yet** in place: no individual sign-in (access is
gated by a shared password and, on request, an IP allow-list), no encryption at rest beyond the host's disk, no
SOC 2 and no penetration test. Read-only blockchain access; no custody; no keys; writes to the accounting system
only on a person's approval; an application-level append-only audit log.

## 7. Deletion and return
On the Agreement ending, or on written request, the Provider deletes all Customer data (data directory, host
volume, Xero tokens) within **10 business days**, asks the Customer to revoke the Clearline app in Xero, and
confirms deletion in writing. Before deletion, the Customer may ask for an export of its records (CSV / JSON).
Deletion is carried out by hand today.

## 8. Breach notice
The Provider will notify the Customer by email within **72 hours** of becoming aware of a personal-data breach
affecting Customer data, with what is known, what is being done and a contact, and will update as facts emerge.

## 9. Assistance and audit
The Provider will help the Customer answer data-subject requests and regulator questions about the service, and
will answer reasonable written security questions. On-site audits: [by agreement].

## 10. Governing law
[To be decided with a lawyer.]

Signed: ____________ (Customer)   ____________ (Provider, Aashmiin Kaur, proprietor)   Date: ________
