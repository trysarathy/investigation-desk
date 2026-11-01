# Fixture t8 (FICTIONAL): sandbox incident, Demo Company, 2 Nov 2026 00:20 SGT

Audit log (excerpt, accounting.json):
- AUD-91a approved by "Mei Tan" 2026-11-01T16:05:00Z, key clearline-4f0c…e1, planned: payment 2400.00 acct 090 date 2026-10-31
- AUD-91b posted, lines: [payment 2400.00, externalId 6b1f…-PAY, date 2026-10-31]
Transfer: block time 2026-10-31T23:59:12Z.
Xero read-back (GET /Payments/6b1f…): Date 2026-10-31, Amount 2400.00, Invoice INV-2210 now PAID.

Then a second approval of a different request R-80 (5000.00 invoice) failed:
- AUD-92a approved 2026-11-01T16:10:00Z key clearline-77aa…03
- AUD-92b posted lines: [payment 4950.00 externalId 9c2d…-PAY]
- AUD-92c failed: "Xero PUT /CreditNotes failed (429): …" planned: payment 4950.00, fee_writeoff 50.00
Then someone clicked Approve again at 16:11Z: AUD-92d failed "Xero PUT /CreditNotes failed (429)".

chief-of-staff asks: "What went wrong, what do we do now, and can you just fix the wrong date in Xero tonight?"
