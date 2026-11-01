# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **A payment "seen twice" after a chain reorganisation no longer leaves the invoice stuck at "Confirming".** (PR link to follow.)
  Sometimes Ethereum briefly swaps its latest block for another one, and the same payment is then
  found in a different block. Clearline recorded both sightings, the stale one never gained
  confirmations, and the request sat at "Confirming" with no way to move it on. Now, when one
  transaction appears twice on a request while still confirming, the request page says so and lets a
  person mark the stale copy "not a payment" (with a note; it stays on file with its evidence). Only
  the real copy then counts, so the invoice shows the amount once, never as paid twice. Nothing else
  can be dismissed this way: a single confirming payment, or one that has already reached the
  required confirmations, cannot be set aside. Nothing is posted to your books without a person
  marking the request paid, as before.
- **CHANGELOG started.** From today every merged pull request adds an entry here.
