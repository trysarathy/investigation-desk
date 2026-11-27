# Field encryption: reconciliation time on the demo seed (v1 Phase 5.3)

`scripts/perf/encryption-recon.ts` seeds the demo world (30 days, three entities, 1,486 chain transfers) twice into one empty test database. The first copy is seeded with field encryption off and the second with it on, using a key made for that run. For each entity the script then times, 15 times each, with the two modes interleaved:

- the input load (`loadReconcileInput`, which with encryption on opens every sealed value);
- the engine (`reconcile`).

Run on 2026-11-25 on the shared development machine while another test suite was running, so the absolute numbers are noisy [VERIFIED for this run only]. Medians in ms:

| Entity | Load, off | Load, on | Engine, off | Engine, on | Same input | Same decisions |
|---|---|---|---|---|---|---|
| NW-SG | 174.7 | 249.6 (+43%) | 121.7 | 128.3 | yes | yes |
| NW-SG-USD | 77.2 | 97.0 (+26%) | 19.0 | 26.7 | yes | yes |
| NW-AE | 121.0 | 151.8 (+25%) | 43.6 | 48.3 | yes | yes |

Seeding the whole demo, which includes 90 reconciliation runs with chain verification, took 139.7 s with encryption off and 127.0 s with it on. That difference is within this machine's noise.

Reading: encryption adds about 20 to 75 ms per entity to the input load. That is the cost of AES-GCM opens, about 6,000 values for NW-SG. The engine does not change, because it sees the same plaintext input. "Same input" compares the input hash after masking bank-line ids, which are row fingerprints that include each organisation's random bank-account id. [ASSUMPTION] On a quieter machine the relative overhead should be similar; re-run before quoting it.

```
CLEARLINE_TEST_OWNER_URL=... CLEARLINE_TEST_RUNTIME_URL=... npx tsx --conditions=react-server scripts/perf/encryption-recon.ts --iterations 15
```
