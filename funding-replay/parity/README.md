# Parity harness: original vs rebuild

Runs the **same economic facts** through the supplied original engine (read-only reference) and the rebuilt
engine (`engine/replay.py`), then compares the answers a treasurer reads: what was known, per-slot status,
usable cash, required, headroom, cutoff, spendable deadline, the Friday decision, and whether a comparison
is allowed (and its net). Stdlib only; money is `Decimal`. Synthetic replay, no funds move.

## Run

From `funding-replay/`:

    python3 parity/run.py --original-dir <path to the extracted original funding-replay/ folder>

Defaults: `--original-dir` is the scratchpad extraction
(`/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/original-ref/funding-replay`),
`--zip` is the uploaded `1fb78459-Funding_Replay_Experiment.zip` (its SHA-256 is computed at run time and
checked against `7cbab786…24a9d`), and `--out` is `parity/RESULTS.md`.

The original is imported from its own directory by explicit path (`importlib`); it is never copied into this
repo, and no bytecode is written. If `replay.py` is not in `--original-dir`, every original cell reads
**"original not available"**. The harness never makes up original output.

Output: a compact table on stdout, `parity/RESULTS.md` (inputs and digests, run date, every scenario side by side,
a same / differs / n/a flag per field, translation notes, fidelity checks), and the translated CSVs in
`parity/out/<scenario>.original.csv` / `.rebuild.csv`. The exit status is 0 even when the engines disagree.
It is non-zero (2) only for a harness error. An engine exception is a result: the cell shows
`engine error: <type>: <message> (file:line)`.

## Files

- `common.py`: the common scenarios, defined once as plain facts. They start from the original's
  `events.csv` (150,000 settled − 10,000 reserved, balances at 14:00), then apply one edit per scenario.
- `to_original.py`, `to_rebuild.py`: explicit translators. Each returns the records it wrote, a map from
  records back to fact ids, and a `notes` list of every translation choice. The notes are printed and also
  written to RESULTS.md. A fact one engine cannot hold raises `NotExpressible`, and its cells read
  **"not expressible"**. The translators never quietly add evidence to make the two engines agree. When the
  rebuild needs a record for a rule the original applies in code (a weekday is open; there is no cash floor),
  the record is labelled `XL-…` and has a note.
- `run.py`: runs every scenario at Fri 13 15:00, Mon 16 15:00 and Thu 19 09:00 SGT. Thu 19 09:00 is the
  rebuild's fixed retro time; the run also checks that the original gives the same answers at its default
  as-of, Wed 18 15:00. It also checks translation fidelity: for every scenario that the original has as a
  built-in `--case`, the original's output on our translation must match its output on its own case.

## What "differs" means

"Differs" means the two engines give different **normalised** answers to the same facts. It is a prompt to
look, not a verdict on which engine is right. Each difference is reviewed and classified in
`docs/PARITY_REVIEW.md` as one of:

- **code**: a bug in one engine.
- **fixture or translation**: the inputs did not mean the same thing.
- **policy**: a deliberate rule difference, such as the 24 h balance rule, an unknown versus infeasible
  verdict, or the Monday counterfactual.
- **wording / reporting**: the same verdict, but one engine reports a number or field the other leaves out.

"n/a" means the cell could not be compared: the original is not available, the fact is not expressible in
that engine, or the engine raised an error.

Normalisation rules:
- Slot status is reduced to feasible / infeasible / unknown / not-yet. The rebuild's `passed` (the cutoff was
  already gone at this as-of) is kept as its own value.
- Rebuild usable cash is derived as required + headroom.
- The Friday decision is put into one of three categories: KEEP_BASELINE, MANUAL_REVIEW or ESCALATE.
- The "known" sets compare only facts that both translators date with the same `known_at`.

