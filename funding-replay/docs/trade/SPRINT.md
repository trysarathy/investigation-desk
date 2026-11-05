# Clearline documentary operations — implementation and runbook
This extension to the private funding pilot lets an operator record an instrument and a reviewer decide how to handle presentation or collection evidence. It does not purport to issue a real bank undertaking. The public synthetic funding demo and funding facilities are separate. No external message is sent and accepting a credit does not honor, negotiate, discount, or settle it.

## Run the private synthetic pilot
From funding-replay/ in a Python 3.9+ environment:
```sh
export PILOT_ENV=dev
export PILOT_DB="$(mktemp -d)/pilot.sqlite"
export PILOT_SECRET=local-synthetic-only
python3 -m pilot.cli migrate
python3 -m pilot.cli seed
python3 -m pilot.cli serve --port 8765
```
Visit http://127.0.0.1:8765/ ; the existing dev-only accounts are in ../pilot/README.md relative to this file. Sign in as operator; select **Documentary credits** or **Collections & eBL**. Use another browser context for the reviewer. Keep the same database path across restarts. For a durable trial use an authorized encrypted volume and TLS, environment-provided secrets, no default test accounts and approved backup storage. These local commands are not public-production configuration.

## Concrete walkthrough
1. Operator creates a draft for USD 10,000, an applicant, beneficiary, issuing/advising banks, invoice and bill of lading requirements. Supply a future presentation cutoff and expiry as zoned timestamps.
2. Reviewer issues the simulated credit. Operator presents USD 9,500 against it with only an invoice. Reviewer runs the structural checks: missing transport document and amount mismatch. The reviewer may append an examination observation. An on-time assertion typed after the cutoff cannot erase server receipt time.
3. Reviewer requests waiver; operator records an applicant response reference. The reviewer may still refuse. Alternatively, accept with rationale: exactly one financing review task is created. An operator may hand this off; no funding case, advance, discount, facility draw or payment is created just by acceptance. Record-only refusal is not the formal transmission of a notice.
4. In Collections, create a D/A instruction with the prior-arrangement reference, agreed format and presentation place. Present, attest acceptance and then record external release. The drawee still has not paid. Full matching payment evidence is a separate event. Contrast D/P, where payment evidence precedes release. In the eBL panel record external platform observations; surrender ends this local observation workflow, not title in law.
5. Preview an MT700 tag body or archived pacs.008.001.08 XML using samples in tests/pilot/test_trade_messages.py. No preview has side effects. Never relabel the XML as an LC issuance message.

## Architecture and data model
Browser → same-origin authenticated pilot API → org-scoped command service → SQLite transaction → event history plus read model. The credit and records modules have separate lifecycles. Use integer minor units and explicit currency. Terms pin exact full drawing, document kinds, deadline and expiry; partial drawings, tolerance schedules, amendments, instalments, re-presentation and negotiated discrepancy treatment are outside the supported profile. Reject unsupported operations rather than inventing favorable outcomes.

| Source | Responsibility |
| --- | --- |
| pilot/migrations/0110_trade.sql; pilot/trade.py | Credit terms and four actor roles, presentations, per-document metadata and optional digest, versioned decisions, findings, automatic financing-review task and retry records. |
| pilot/migrations/0111_trade_records.sql; pilot/trade_records.py | Electronic-collection instructions and external eBL observations; versioned, organization-scoped evidence history. |
| pilot/trade_messages.py | Size-bounded MT700 profile and independent archived pacs.008 payment preview. A successfully parsed message is not authenticated, validated against all network rules or served as proof of payment. |
| pilot/trade_calendar.py | Independent planning tool using an explicit bank place, time zone, coverage and closing times. Unknown coverage → review; no generic Monday–Friday assumption. |
| pilot/trade_bank.py | Signed sandbox bank-to-corporate observation inbox; known simulated credits only. Bank observations never promote instrument or payment status. |

Session routes under /api/trade: GET/POST /instruments or /records; GET /{resource}/{id}; POST /{resource}/{id}/commands; POST /messages/preview and /calendar/preview. Every mutation requires current session and CSRF header. Creating sends idempotency_key; state changes send {action,payload,version,idempotency_key}. Signed bank inbox is the separate machine-authenticated exception. Neither broker simulation nor uploaded text can grant a user a banking role.

## Standards and boundaries
- [ICC UCP 600](https://library.iccwbo.org/content/tfb/RULES/tfb-ucp600-rules.htm), articles 14 and 16: examination and refusal have distinct rules. An applicant response is not a bank acceptance; a waiver request does not reset the examination period. Our structural checks are a narrow fixed-terms simulation. A real reviewer must review the documents and applicable terms and serve any required notice.
- [ICC ISBP 821](https://library.iccwbo.org/content/tfb/RULES/tfb-isbp-2023-rules.htm) is practice for document examination under UCP 600. No licensed ICC rulebook has been copied or encoded in full. Manual observations are evidence of the user's examination, not automated ISBP certification.
- [ICC eUCP 2.1](https://iccwbo.org/news-publications/policies-reports/eucp-version-2-1-icc-uniform-customs-and-practice-for-documentary-credits/) concerns electronic credit presentations. [ICC eURC 1.1](https://iccwbo.org/wp-content/uploads/sites/3/2019/06/825E_eURC_Final.pdf) supplements collections under URC 522; it is not a substitute for eUCP, and electronic storage alone does not make it applicable.
- [ISO 20022 catalogue](https://www.iso20022.org/iso-20022-message-definitions) and [Swift Category 7 reference](https://www2.swift.com/knowledgecentre/rest/v1/publications/us7m_20230720/2.0/us7m_20230720.pdf): the implemented MT700 tag vocabulary is a restricted simulation. pacs.008 is a payment instruction, not an MX equivalent of issuance. Neither parser is a Swift gateway or a complete FIN/XSD validator.
- [UNCITRAL MLETR articles 10–11](https://uncitral.un.org/sites/uncitral.un.org/files/media-documents/uncitral/en/mletr_ebook_e.pdf): reliable identification, integrity and exclusive control matter. A reported controller, hash or reference does not establish exclusive control, possession or entitlement. No registry or carrier integration is claimed.

## Security and operational boundaries
Keep references and synthetic records here. Bank-ready operation would need authentication of the external document and issuer, actual banking-day calendars/cutoffs, jurisdiction- and product-approved rule profiles, operational segregation and formal communication channels. The audit history is append-protected at the application/database boundary, not tamper-proof against a privileged host operator. No tamper-evident external archive, production SSO or network certification is claimed. The SQLite database is not encrypted by this code.

Document approved region for application, database, backup, logs and subprocessors before real records are used. A hosting region flag alone is not evidence of residency. Confirm retention, legal holds, authorized erasure or pseudonymization and backups with the controller before taking live data. [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and [Singapore PDPC guidance](https://www.pdpc.gov.sg/guidelines-and-consultation) depend on the processing context. No blanket compliance or residency claim.

## Verification
Run from funding-replay/: `python3 -m unittest discover -s tests/pilot` for pilot/API tests and `python3 -m unittest discover -s tests` for the earlier simulation suite. New trade-specific tests can be run with `python3 -m unittest discover -s tests/pilot -p 'test_trade*.py'`. Existing recovery instructions: docs/pilot/RECOVERY.md. Never seed an existing customer database to run a test.
