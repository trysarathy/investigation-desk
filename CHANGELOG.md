# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **A payment left stuck at "Confirming" by a leftover copy of the same transfer can now be cleared.**
  Sometimes Ethereum briefly swaps its latest block for another one, and the same payment is then
  found again in a later block. Clearline recorded both sightings, the earlier one never gained
  confirmations, and the request sat at "Confirming" with no way to move it on. Now, once the copy in
  the later block has reached the required confirmations, the request page lets a person mark the
  earlier copy "not a payment" (with a note; it stays on file with its evidence). Only the confirmed
  copy then counts, so the invoice shows the amount once, never as paid twice. Nothing else can be
  set aside this way: not the confirmed copy, not a lone confirming payment, not two copies that are
  both still confirming (look the transaction up again first), and not two transfers in one
  transaction, which are separate payments and both count. Nothing is posted to your books without a
  person marking the request paid, as before.
- **CHANGELOG started.** From today every merged pull request adds an entry here.
