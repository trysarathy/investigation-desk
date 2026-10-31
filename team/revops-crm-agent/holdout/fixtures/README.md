# Holdout fixtures: ALL FICTIONAL
Every company, person, email address, wallet address, transaction hash, amount and message in this
folder is invented for testing. Domains end in `.example` (`mail.example` stands in for a free webmail
provider such as Gmail). Nothing here is a real customer, lead or payment. Never send anything to these
addresses, never write these rows into the real Company HQ or Master Sheet.

The `work/` folders are CSV exports in the format `python3 -m gtm.cli` (branch `gtm-os`) reads:
settings.csv, leads.csv, touches.csv, dnc.csv, spot_checks.csv (+ queue.csv / incoming/*.csv).
Run them from a checkout of gtm-os, e.g.
`python3 -m gtm.cli guard --dir <fixture>/work --candidates <copy-of>/queue.csv --today 2026-11-03`
(the guard rewrites the candidates file, so copy the folder first).
