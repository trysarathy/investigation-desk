# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **Demo payments and a first invoice-matching check (branch `data/demo-scenarios`).** The 20 demo
  payments now exist as a catalogue: 19 are real public transfers (not Clearline customers), replayed
  offline from recordings, each paired with a clearly labelled sample invoice; the "still confirming"
  slot is a gap (no recorded transfer). A test checks each expected outcome. On these 19 the matcher
  auto-matched 6, none wrongly (a small first set: see docs/MATCHING_EVALS.md §8 for n and intervals).
  Six known differences are recorded as failing-on-purpose tests; no product behaviour changed.
- **CHANGELOG started.** From today every merged pull request adds an entry here.
