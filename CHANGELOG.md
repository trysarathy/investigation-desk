# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **Demo payments and a first invoice-matching check (branch `data/demo-scenarios`).** The 20 demo
  payments now exist as a catalogue: all 20 are real public transfers (not Clearline customers),
  replayed offline from recordings, each paired with a clearly labelled sample invoice; a 21st "still
  confirming" slot is a gap (no recorded transfer). A test checks each expected outcome. On these 20
  the matcher auto-matched 6, none wrongly, but 6 is far too few to rule out a high error rate: up to
  about 4 in 10 auto-matches being wrong is not ruled out (95% Wilson 0%-39%; docs/MATCHING_EVALS.md §8).
  Six known differences are recorded as failing-on-purpose tests; no product behaviour changed.
- **CHANGELOG started.** From today every merged pull request adds an entry here.
