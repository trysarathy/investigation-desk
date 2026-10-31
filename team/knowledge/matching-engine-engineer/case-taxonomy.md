# Case taxonomy for invoice matching, mapped to the code and the D-catalogue

Code behaviour [VERIFIED: matching-engine-engineer 2026-11-01, files named, main 0c7d9f1]. D-codes from
`src/lib/catalogue.ts:17-37` and `docs/SPEC.md` §2. "Real labelled data" = cases in the existing real
sets that exercise this through the **request/matching** path (not the deposit engine).

| # | Case | What it is | Request path today | Deposit-engine code | Expected action (label) | Real labelled data for matching |
|---|---|---|---|---|---|---|
| 1 | **exact** | one transfer, genuine token, right network, to the one open invoice's address, exactly the amount, confirmed | attributed by System (`lifecycle.ts:138-141`) → `matched` (`:376-379`); marked paid by rule only in demo | D13 (ledger credited) / D12 (not credited) | `auto_match` | none |
| 2 | **partial** (short) | confirmed genuine transfers sum below the amount | `review: "short"`, needs_review (`:380-388`); `shortfallCause` inference | — (D08 is a deposit *minimum*, a different thing) | `review` (person: request balance / accept short) | none |
| 3 | **overpayment** | sum above the amount; or paid twice (`duplicate`) | `review: "over"` (`:389-393`); repeat after paid reopens | — | `review` (refund excess / accept over) | none |
| 4 | **multiple invoices** | ≥ 2 open invoices share the destination; or one transfer meant for several invoices; or a payer who paid a closed invoice at the same address | `ambiguous` (`:134-137`, `:143-146`); one-transfer-pays-many is **not modelled** (a transfer attributes to one request) | — | `review` always; never by amount | none |
| 5 | **wrong token** | non-allowlisted token, or counterfeit with the right symbol | `transferIssue` `wrong_token` / `counterfeit` (`:288-292`) | D05 unsupported / D06 fake | `flag` (never counts) | D05: 2+2, D06: 7+6 cases (deposit path only) |
| 6 | **wrong network** | right token family on another chain (e.g. Tron, Arbitrum for an Ethereum request) | `wrong_network` (`:282-284`); check.ts adds "this request is Ethereum only" (`check.ts:73-75`) | D04 | `flag`; a person may `accept_other_network` if it reached the business's own wallet | D04: 3+3 cases (deposit path only) |
| 7 | **look-alike address** | destination resembles the invoice's address (poisoning or typo) | `wrong_address` only (`:287`); D07b off on this path (`check.ts:61`) | D07 + D07b finding | `flag` + security notice; never `auto_match` | D07b: 2 tuning, **0 held-out** (deposit path) |

Also handled, needed in the dataset as negatives:
| Case | Code | Expected action |
|---|---|---|
| failed transaction | `failed`; D03 | flag |
| not yet confirmed | `confirming`; D02 | wait (not an auto-match yet) |
| issuer-frozen sender | D09 (deposit path only; off on the request path) | flag / escalate |
| mined before the invoice existed | `timing` (`:294-296`) | review |
| same transfer delivered twice | `ingest` "duplicate" | counts once |
| unidentified payment (no invoice uses the address) | `none` + `suggestMatches` | `no_match` with suggestions; a person assigns |
| hash on more than one chain / chain mismatch (three-way) | `resolveChain` review (`match.ts:262-275`) | review |

## Why the per-case breakdown matters
A matcher that auto-matches everything to the only open invoice scores well on "exact" and silently
fails on 4 and 7. Report FMR, recall and abstain rate **per row** with its own n. Rows 4 and 7 should
show 0 auto-matches and 100% abstain/flag; any auto-match there is a false match by definition.
