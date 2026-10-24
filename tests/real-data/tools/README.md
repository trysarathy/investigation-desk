# Real-data test tools (as used 24–25 Oct 2026)

Reference copies of the scripts behind `demo/REPORT.md`. Python 3, standard library only (plus
Playwright for `demo.py`). They read the public chains and explorers directly, never through the
product, so the expected answers stay independent. Paths at the top of each script assume they are
run from this folder with the app on http://localhost:3210; adjust as needed.

- `chain.py`: small read-only helpers (RPC, Tronscan, Blockscout, TronGrid).
- `scan_evm.py`: scans recent blocks for normal, failed and fake-token transfers.
- `build_cases.py`, `build_holdout.py`: build `tests/real_cases*.json` and the SAMPLE COMPANY DATA files.
- `run_cases.py <label>`: runs every case through the app (paste, bulk, address) and scores it.
- `robust.py`: bad-input checks. `demo.py`: the screenshot and video walkthrough.
