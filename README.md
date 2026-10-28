# Clearline GTM OS

Lead data, safety guard and helper scripts for Clearline's go-to-market system. The Google Sheet
"Clearline GTM OS — Master" (personal Drive) is the source of truth; the scheduled agents read it,
run the guard here, and write back. Nothing in this repo sends email or holds secrets.

## Run the tests
```
python3 -m unittest -v
```

## Commands (all read CSV exports of the Sheet tabs from ./work)
| Command | What it does |
|---|---|
| `python -m gtm.cli guard --dir work --candidates work/queue.csv` | ALLOW/BLOCK every planned email with reasons, and says which still need Aashmiin's approval |
| `python -m gtm.cli level --dir work` | Earned autonomy level and any downgrade reasons |
| `python -m gtm.cli score --dir work` | Rescore (0-100) and retier every lead |
| `python -m gtm.cli merge --dir work --incoming new.csv` | Dedupe new leads against the Master by email and company domain |
| `python -m gtm.cli metrics --dir work` | Dashboard numbers |

## Files
- `gtm/guard.py`: PAUSE, caps, Do-not-contact, one company per week, source URL required, strict
  countries, support inboxes, US postal address, follow-up timing and thread rules.
- `gtm/autonomy.py`: Level 1/2/3 rules and automatic downgrades.
- `gtm/score.py`: lead score = fit (40) + evidence (30) + reachability (15) + engagement (15).
- `gtm/merge.py`: one row per company domain; never overwrites the Master.
- `prompts/RULES.md`: the rulebook every scheduled agent reads first.
- `prompts/*.md`: the scheduled task prompts.

## Data
`work/` and `data/` are git-ignored: contact data stays in the Sheet, not in git. Keys (if any are
ever needed) go in `.env`, which is also ignored.
