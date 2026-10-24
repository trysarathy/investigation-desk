# Real-data test results (24–25 Oct 2026)

All numbers below were produced by `run_cases.py` driving the running app exactly as a user would (paste a hash, optional reporting customer; and one bulk CSV upload). No API keys were set. Cold cache for each full run.

| Set | Cases | Correct | Accuracy | False alarms on normal | Wrong **and** High confidence | Paused | Median time | 90th pct | Slowest |
|---|---|---|---|---|---|---|---|---|---|
| Before fixes (main set) | 59 | 43 | 72.9% | 0 of 12 | 13 | 3 | 17.35 s | 18.9 s | 19.71 s |
| After fixes (main set) | 59 | 59 | 100.0% | 0 of 12 | 0 | 0 | 1.35 s | 2.1 s | 11.69 s |
| Held-out set, after fixes (built after the fixes) | 52 | 52 | 100.0% | 0 of 12 | 0 | 0 | 1.44 s | 2.01 s | 9.76 s |

Bulk CSV (57 rows, one upload): before 57/57 rows returned in 309.8 s, all agreeing with the single lookups; after 57/57 in 54.2 s, 56 agreeing (FAIL-T3 paused in bulk on a TronGrid rate limit; paused, not wrong). Held-out bulk: 52/52 agreeing in 27.1 s.

## Per diagnosis

| Code | Meaning | Before: correct / wrong / needs review | After | Held-out |
|---|---|---|---|---|
| D01 | Not found on any chain | 0/2 · 0 wrong · 2 review | 2/2 · 0 wrong · 0 review | 2/2 · 0 wrong · 0 review |
| D02 | Waiting for confirmations | 0/2 · 2 wrong · 0 review | 2/2 · 0 wrong · 0 review | — |
| D03 | Transaction failed | 11/11 · 0 wrong · 0 review | 11/11 · 0 wrong · 0 review | 10/10 · 0 wrong · 0 review |
| D04 | Wrong network | 2/3 · 0 wrong · 1 review | 3/3 · 0 wrong · 0 review | 3/3 · 0 wrong · 0 review |
| D05 | Unsupported token | 2/2 · 0 wrong · 0 review | 2/2 · 0 wrong · 0 review | 2/2 · 0 wrong · 0 review |
| D06 | Fake token | 1/7 · 6 wrong · 0 review | 7/7 · 0 wrong · 0 review | 6/6 · 0 wrong · 0 review |
| D07 | Wrong address | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review |
| D07b | Look-alike (poisoned) address | 0/2 · 2 wrong · 0 review | 2/2 · 0 wrong · 0 review | — |
| D08 | Below minimum | 3/3 · 0 wrong · 0 review | 3/3 · 0 wrong · 0 review | 3/3 · 0 wrong · 0 review |
| D09 | Issuer freeze | 3/6 · 3 wrong · 0 review | 6/6 · 0 wrong · 0 review | 5/5 · 0 wrong · 0 review |
| D12 | On-chain, not credited | 4/4 · 0 wrong · 0 review | 4/4 · 0 wrong · 0 review | 4/4 · 0 wrong · 0 review |
| D13 | Already credited (normal) | 12/12 · 0 wrong · 0 review | 12/12 · 0 wrong · 0 review | 12/12 · 0 wrong · 0 review |
| D14 | On hold | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review |
| D16 | Rejected | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review |
| D17 | Another customer's address | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review |
| D18 | Retired address | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review | 1/1 · 0 wrong · 0 review |

## Every case (main set)

| Case | Category | Chain | Expected | Before | After | Confidence after | Correct after | Time after | Source |
|---|---|---|---|---|---|---|---|---|---|
| TRN-01 | normal (credited) | tron | D13 | D13 | D13 | High | Y | 3.33 s | [link](https://tronscan.org/#/transaction/5296e24018c9197bbf4e7e844c7152ca494067400a5a06f351c66aad7d3873cb) |
| TRN-02 | normal (credited) | tron | D13 | D13 | D13 | High | Y | 1.61 s | [link](https://tronscan.org/#/transaction/0b3dba069b59e51a1172cc94bdb6c75289ba2fd76ba74d9883b76bde2b104085) |
| TRN-03 | normal (credited) | tron | D13 | D13 | D13 | High | Y | 2.02 s | [link](https://tronscan.org/#/transaction/73725524743c425b09cc4e4ef4937d4fa4f6c05ae288006f403375cc7a988e02) |
| TRN-04 | normal (credited) | tron | D13 | D13 | D13 | High | Y | 1.57 s | [link](https://tronscan.org/#/transaction/69c61d31396152b59c79f22da5da63be5fbe24c6cdb6874c6555ac7e8ab9e7d2) |
| TRN-05 | normal (credited) | tron | D13 | D13 | D13 | High | Y | 2.0 s | [link](https://tronscan.org/#/transaction/4f16489205c3ef79c618feafcc459acb5ca33fdad1c027feeebeea8bbe54b47a) |
| TRN-06 | on-chain, not credited | tron | D12 | D12 | D12 | High | Y | 1.72 s | [link](https://tronscan.org/#/transaction/80f14683768965b813220395fbb0c97673fe238781a6d3ba562dcbc650b7317c) |
| TRN-07 | on-chain, not credited | tron | D12 | D12 | D12 | High | Y | 2.07 s | [link](https://tronscan.org/#/transaction/fb5526c8dfcb19d73cb36eb6d61d5de633f3c6c9b6d082a9c6d4579a52969b00) |
| TRN-08 | on hold | tron | D14 | D14 | D14 | High | Y | 1.58 s | [link](https://tronscan.org/#/transaction/e033be73d5b3990fc1e8532686b851b76431889ac615ab149c00bc036f4667fa) |
| TRN-09 | rejected by company | tron | D16 | D16 | D16 | High | Y | 2.02 s | [link](https://tronscan.org/#/transaction/841c0edf330920b6fe739e6341855238647a1cf0f67ffebc107bb1169c81a584) |
| TRN-10 | another customer's address | tron | D17 | D17 | D17 | High | Y | 10.73 s | [link](https://tronscan.org/#/transaction/22a490fde1913ac11d0d67009732a02208d2f6c779314bd1cbcc53e27240ccb7) |
| TRN-11 | retired address | tron | D18 | D18 | D18 | High | Y | 1.61 s | [link](https://tronscan.org/#/transaction/b6f1000eed96be7b2518dbf27495653ead292a6792907617666a8348fd2d80c8) |
| TRN-12 | below minimum | tron | D08 | D08 | D08 | High | Y | 2.0 s | [link](https://tronscan.org/#/transaction/8964ec180ab72f0c52b1e3291561c0abb9ade9008d0fb3b23d379d1b6e890b5c) |
| ETH-01 | normal (credited) | ethereum | D13 | D13 | D13 | High | Y | 1.35 s | [link](https://etherscan.io/tx/0xf70dab272206053e0e44c35db3891e5d72c3410fc26fcdfc9949193d4ce605da) |
| ETH-02 | normal (credited) | ethereum | D13 | D13 | D13 | High | Y | 0.49 s | [link](https://etherscan.io/tx/0x5dc6d3c4d96add3c2fa7ecaaff2c18fec9ea2ef6dd3279ec7e58370ddfe86ea0) |
| ETH-03 | normal (credited) | ethereum | D13 | D13 | D13 | High | Y | 0.97 s | [link](https://etherscan.io/tx/0xeb2153554f28e07207ee5fac0d41bee3fda2a37aaafc188ffb134339620e2c12) |
| ETH-04 | normal (credited) | ethereum | D13 | D13 | D13 | High | Y | 0.62 s | [link](https://etherscan.io/tx/0x3dfa021933824e325e736b1afbc2831ffa296e7088dce619908d2b266d9a453d) |
| ETH-05 | on-chain, not credited | ethereum | D12 | D12 | D12 | High | Y | 0.99 s | [link](https://etherscan.io/tx/0x386aa675227e9e49f9ab2daa1bde962f76f30e5b6d02a84b0c9d73c36c6c7c96) |
| ETH-06 | wrong address (not ours) | ethereum | D07 | D07 | D07 | High | Y | 0.64 s | [link](https://etherscan.io/tx/0xb72cc77b5d18dacb9891116cec58a3887bdacfc720659382753657ef7424d820) |
| ETH-07 | below minimum | ethereum | D08 | D08 | D08 | High | Y | 0.74 s | [link](https://etherscan.io/tx/0xdfda625b602bf5d4f9e38a72c52fc4e7521e4e276eb56191206eb783c8f67f87) |
| ETH-08 | unsupported token | ethereum | D05 | D05 | D05 | High | Y | 1.01 s | [link](https://etherscan.io/tx/0xd202d1bf3acb3052c1f6bc2690728eaa896dc41445658d57b6b93ada1ceda5de) |
| BSC-01 | normal (credited) | bsc | D13 | D13 | D13 | High | Y | 0.57 s | [link](https://bscscan.com/tx/0x275afee98ebe7d4f0a45d86c3321d8e334572f3ae194be66f8dc88ca51c9cb7a) |
| BSC-02 | normal (credited) | bsc | D13 | D13 | D13 | High | Y | 0.5 s | [link](https://bscscan.com/tx/0x8c0140263ea556c8b8d38dfc287bfd179bfc35d28e3f7021d9ddb508189e5e16) |
| BSC-03 | normal (credited) | bsc | D13 | D13 | D13 | High | Y | 0.56 s | [link](https://bscscan.com/tx/0x4f99331ec9dc81439ecd5942f38bd9daf0ae18fb1e88c052f0542b6de040d723) |
| BSC-04 | on-chain, not credited | bsc | D12 | D12 | D12 | High | Y | 0.63 s | [link](https://bscscan.com/tx/0xdd8baa4abef024b126534902659009535c55480ff69fdf11a07dc13d0ab858aa) |
| BSC-05 | below minimum | bsc | D08 | D08 | D08 | High | Y | 0.42 s | [link](https://bscscan.com/tx/0xec932cb4779d954ca8d4a73c38f7607598d04f6a2c6b2e0e4956a8ed3443319c) |
| BSC-06 | unsupported token | bsc | D05 | D05 | D05 | High | Y | 0.38 s | [link](https://bscscan.com/tx/0x3d4c0415af8c027e5b6e1431791fa8cd1ca90c7c91fc99ac59d0ef222db073a4) |
| NET-POL | wrong network | polygon | D04 | D04 | D04 | High | Y | 1.17 s | [link](https://polygonscan.com/tx/0x5170bfafbd0f1ebe0f401507f8f492846d4d1fb468e5ed2ce1c73c1e99ea9f89) |
| NET-ARB | wrong network | arbitrum | D04 | PAUSED ✗ | D04 | High | Y | 0.84 s | [link](https://arbiscan.io/tx/0x54ab00b5d4440c9ad719f9f5f721d4d18e589352c5beaf6ef9e3c009f3d78495) |
| NET-BAS | wrong network | base | D04 | D04 | D04 | High | Y | 1.09 s | [link](https://basescan.org/tx/0x9ff6bcd0c35a5271c5fa59989816a3ca2203f4b7b7a82b8add7fd6c3c76e095b) |
| FAIL-T1 | failed (out of energy) | tron | D03 | D03 | D03 | High | Y | 1.74 s | [link](https://tronscan.org/#/transaction/66a11764690c76dd85f9147ecf8b9a6c153507190de53bcfd63e20a14f6e898e) |
| FAIL-T2 | failed (out of energy) | tron | D03 | D03 | D03 | High | Y | 1.6 s | [link](https://tronscan.org/#/transaction/676d5c0a444142f5cba377586b7650d20173bb5a628a32268b33c57519c3727f) |
| FAIL-T3 | failed (out of energy) | tron | D03 | D03 | D03 | High | Y | 1.97 s | [link](https://tronscan.org/#/transaction/ddf2072ae288713a837e620b7474c914ebe1c948be4e0639a891d6ea380d4895) |
| FAIL-E1 | failed (reverted) | ethereum | D03 | D03 | D03 | High | Y | 1.14 s | [link](https://etherscan.io/tx/0x05312625892fd7cf7ba5164b81b28a4421ea92faeb9eb5d6d800c9ba759c6c7f) |
| FAIL-E2 | failed (reverted) | ethereum | D03 | D03 | D03 | High | Y | 0.7 s | [link](https://etherscan.io/tx/0xa7ac8e4487522df3012972b378b7c0939c8a9749a1dec41635fa4b79e2561adb) |
| FAIL-E3 | failed (reverted) | ethereum | D03 | D03 | D03 | High | Y | 0.89 s | [link](https://etherscan.io/tx/0x2cf7c97ea7996f12a71b358e8782a2380b163053b62be9609d72092ca0197b0c) |
| FAIL-B1 | failed (reverted) | bsc | D03 | D03 | D03 | High | Y | 8.12 s | [link](https://bscscan.com/tx/0x52a198d6ce3c7fd93c30f9fa6d80965961209b5e2df02e94f3a0164ac89ffd1b) |
| FRZ-TD1 | deposit from a now-frozen sender | tron | D09 | D09 | D09 | High | Y | 2.02 s | [link](https://tronscan.org/#/transaction/241d18a60ab488d03e99405213c51905b9dda4cdefa553a8f87123390b4331f2) |
| FRZ-TF1 | frozen sender, transfer reverted | tron | D03 | D03 | D03 | High | Y | 1.55 s | [link](https://tronscan.org/#/transaction/f6973c9c864818871aa63eceb9ab9098e1cd3588abdaa37d044c764852478abd) |
| FRZ-TD2 | deposit from a now-frozen sender | tron | D09 | D09 | D09 | High | Y | 1.88 s | [link](https://tronscan.org/#/transaction/15376d47ec702e36335bb1d65bce04750ad47f0f40f29adf7b420f51cba3343b) |
| FRZ-TD3 | deposit from a now-frozen sender | tron | D09 | D09 | D09 | High | Y | 1.77 s | [link](https://tronscan.org/#/transaction/64e21b285cfefb2fc23346f541ba0e3d4ca530ca14b17c6f22d5e1a77291554c) |
| FRZ-TF2 | frozen sender, transfer reverted | tron | D03 | D03 | D03 | High | Y | 1.6 s | [link](https://tronscan.org/#/transaction/276ea8e898baf24bbb4f89f8b8baa7960875858a689f0c208d13136a8a1c4881) |
| FRZ-EF1 | frozen sender, transfer reverted | ethereum | D03 | D03 | D03 | High | Y | 0.88 s | [link](https://etherscan.io/tx/0xb914a448d77116304135c4479b66994638ff689e7cb3670d884c93192d4d14be) |
| FRZ-ED1 | deposit from a now-frozen sender | ethereum | D09 | D03 ✗ | D09 | High | Y | 0.83 s | [link](https://etherscan.io/tx/0xf44bd05fff99fe5d87a042a37a23504c86eb986b06566876ac494a6bbc1ebf2e) |
| FRZ-ED2 | deposit from a now-frozen sender | ethereum | D09 | D03 ✗ | D09 | High | Y | 0.71 s | [link](https://etherscan.io/tx/0x9f794188ef40f9e19b583dac657e9a151f2f4484f3b20c89b81716bc63c44b2e) |
| FRZ-EF2 | frozen sender, transfer reverted | ethereum | D03 | D03 | D03 | High | Y | 0.76 s | [link](https://etherscan.io/tx/0x0372c0f9645111b95b5225e168aa6ad737fe2d33f42e9d0ff29c3d425f8eb927) |
| FRZ-EC1 | deposit from a now-frozen sender | ethereum | D09 | D03 ✗ | D09 | High | Y | 0.85 s | [link](https://etherscan.io/tx/0x44b495cfde89e91375e1821e95a717f409583f1edfb1605c85bda6e96e4af218) |
| FAKE-01 | fake token (symbol USDT) | ethereum | D06 | D03 ✗ | D06 | High | Y | 2.3 s | [link](https://etherscan.io/tx/0x8e3741c3b5abe4e31d5c0af94497854515aa255dd1eb2c262c3b6f1f97acd746) |
| FAKE-02 | fake token (symbol USDT) | ethereum | D06 | D03 ✗ | D06 | High | Y | 1.0 s | [link](https://etherscan.io/tx/0x28f178e5dfc0fd580ea96b7c6885f9ad94edda66e81c9727f966d918d4b4082e) |
| FAKE-03 | fake token (symbol USDT) | ethereum | D06 | D03 ✗ | D06 | High | Y | 0.71 s | [link](https://etherscan.io/tx/0x9e00a734adee9ccade4d340077d2e525323437678fcd943ab997dc9f4de19e7b) |
| FAKE-04 | fake token (symbol USDT) | ethereum | D06 | D03 ✗ | D06 | High | Y | 1.67 s | [link](https://etherscan.io/tx/0xf8bb3cb737df43c6836479868c64af75a27b7d5da72d550b6d2492484fe58ed2) |
| FAKE-05 | fake token (symbol USDT) | ethereum | D06 | D03 ✗ | D06 | High | Y | 1.96 s | [link](https://etherscan.io/tx/0xe79ba088cc0c7958bf9bb21e3b2a63a80ecd98f8c4422b7711096457a0867557) |
| FAKE-06 | fake token (symbol USDT) | ethereum | D06 | D06 | D06 | High | Y | 0.88 s | [link](https://etherscan.io/tx/0x909804df7f566cb0fbf3c10d244b49bf6227783c6cba1c520c259092b894dc4b) |
| FAKE-HG | fake token (look-alike symbol) | ethereum | D06 | D03 ✗ | D06 | High | Y | 2.59 s | [link](https://etherscan.io/tx/0xf84dacfeb3a92ae3291120d954b86d89932fe31702103754cad4f8e8ac41a10d) |
| POISON-1 | address poisoning | ethereum | D07b | D03 ✗ | D07 + D07b finding | High | Y | 2.1 s | [link](https://etherscan.io/tx/0xc0514a795f065fce8a3e1238a1ba480e8a792d45f6431ee4ba8d800bedd86a0f) |
| POISON-2 | address poisoning | ethereum | D07b | D03 ✗ | D07 + D07b finding | High | Y | 1.57 s | [link](https://etherscan.io/tx/0x374076fa28ed745227c28f42c5054a0bcd024c51ad7a41c17d52e7c6c24980eb) |
| NF-1 | not found (Bitcoin txid) | bitcoin | D01 | PAUSED ✗ | D01 | High | Y | 0.35 s | [link](https://mempool.space/tx/8d8616dea45e550e40983eb3bad63f950773c5e2871fb4642428dd94e2b513af) |
| NF-2 | not found (Bitcoin txid) | bitcoin | D01 | PAUSED ✗ | D01 | High | Y | 0.35 s | [link](https://mempool.space/tx/9b91a2cea598a14eee1a53fd4d9617eaad34cc9abe34bc07a8f6e18c55ad707a) |
| LIVE-T | waiting for confirmations (live capture) | tron | D02 | D12 ✗ | D02 | High | Y | 1.73 s | [link](https://tronscan.org/#/address/TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf) |
| LIVE-E | waiting for confirmations (live capture) | ethereum | D02 | D05 ✗ | D02 | High | Y | 11.69 s | [link](https://etherscan.io/address/0xbdb3ba9ffe392549e1f8658dd2630c141fdf47b6) |

Offline replay (network cut, `OFFLINE_REPLAY_DIR=tests/fixtures/real`): 57/59 — all 57 recorded cases reproduce; the 2 live-capture D02 cases are new transactions by definition and pause, as they should.
