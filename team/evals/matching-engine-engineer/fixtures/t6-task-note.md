# Fixture t6 (fictional harness output)

Assume the harness exists. `t6-harness-output.csv` is the raw output of one scoring run
(code sha 9d0a7e2, 2026-11-25 SGT). The held-out run was look #1 for this change, logged by the harness.
Every invoice is SAMPLE data; every transfer is real (provenance in the case files, not included here).

Columns: label_action / label_invoice = the two-labeller ground truth; system_action / system_invoice =
what the matcher did. Actions: auto_match, review (a person decides), flag (cannot pay any invoice).

Task: produce the held-out section for docs/MATCHING_EVALS.md: per case type and overall, with n,
false-match rate (with k/m), auto-match precision, recall on exact cases, abstain rate, flag accuracy,
95% Wilson intervals and zero-event bounds where needed. Then say in three lines what the result means
for whether this change can ship.
