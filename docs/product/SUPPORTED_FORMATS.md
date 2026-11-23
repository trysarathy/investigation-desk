# Supported file formats (rc7)

Labels: **[VERIFIED]** read in the code or seen in a test run; **[ASSUMPTION]** reasoned, not tested; **[GUESS]** an estimate.

**Short answer to "does it work on any data?"** No file is reconciled without a person. Clearline reads most CSV, XLSX and JSON exports and the two common bank statement standards. A person maps each new layout **once**, and the mapping is reused. Some files cannot be used at all (section C). And a file that reads perfectly can still give **no automatic matches** if it lacks quote terms (section D).

Code: `src/lib/clearline/ingest/` (reading) and `src/lib/clearline/mapping/catalogue.ts` (fields).

## A. Works without mapping, or with suggestions you confirm

| File | What happens | Evidence |
|---|---|---|
| **MT940** bank statement (fields `:20: :25: :28C: :60F/M: :61: :86: :62F/M: :64:`, several statements per file, `{1:}{4:` wrapper) | Read directly. **No mapping.** Opening balance + entries = closing balance is checked; a mismatch is a warning. | [VERIFIED] `ingest/bank/mt940.ts` |
| **camt.053** bank statement, versions `.001.02` and `.001.08` | Read directly. **No mapping.** Only booked entries become lines. Other versions are read with a warning. DOCTYPE/ENTITY refused. | [VERIFIED] `ingest/bank/camt053.ts` |
| A CSV/XLSX/JSON whose column names are close to the catalogue's words (e.g. "Order ID", "Deposit address", "Tx hash", "Value date") | Clearline **suggests** a column for each field, with a reason. A person must still confirm; nothing is auto-confirmed. | [VERIFIED] `mapping/suggest.ts` |
| A file whose header list matches a saved template | The template is offered again automatically. A person still confirms. | [VERIFIED] `src/server/mapping-templates.ts` |

**There are no built-in templates for named providers.** "Shapes A, B and C" are the synthetic generator's test layouts, not provider presets [VERIFIED: the catalogue's synonyms are generic words, never provider names]. In tests, those shapes were mapped through the same generic screens:

- Shape A: CSV with BOM, DD/MM dates, thousand separators and a TOTAL row.
- Shape B: XLSX with MM/DD dates and mixed offsets.
- Shape C: nested JSON, settlement totals only.
- Settlement reports: per-payment lines (with fee lines or a fee column) or batch totals.
- Bank statements: CSV (decimal comma, bracket negatives), MT940, camt.053.

All of these reconciled with zero wrong matches against the generator's truth in 12 variants (PR #152) [VERIFIED].

## B. Works after you map it once

Any of these, as long as it has the required fields (below):

- **CSV or TSV**: comma, semicolon, tab or vertical-bar separated; header row found automatically; UTF-8 (with or without BOM), UTF-16 with a BOM, or windows-1252 (with a warning).
- **XLSX**: the named sheet, or the first sheet with cells. Numbers above 15 significant digits get a warning.
- **Flat JSON**: an array of objects, or an object with one list (`{ "data": [...] }`). Nested objects become dot-path columns (`customer.wallet`).
- **JSON with several top-level lists**: you choose "Which list holds the records?" at upload (PR #156). A template does not remember the list, so you choose again next time.

What the reader handles for you [VERIFIED]:

- **Amounts:** `1,234.56`, `1.234,56`, `1 234,56`, `1'234.56`; negatives as `-1`, `(1)`, `1-`, DR/CR; symbols and codes stripped. If the separator is ambiguous, you are asked. More decimals than the currency allows is an error, never rounded.
- **Dates:** ISO, DD/MM, MM/DD, DD.MM, DD-MMM-YYYY and Excel serial numbers. If no value has a day above 12, you are asked. Times without an offset take the default offset set in the mapping; mixed offsets are converted to UTC.
- **Total rows:** trailing total and subtotal rows are left out with a warning naming the row.
- **Several entities in one file:** map the entity column; rows for another entity are skipped and counted.
- **Status words:** you map each word to a Clearline status. A word you did not map rejects its row.

### Required fields

"Constant" means you may type one value for the whole file instead of picking a column.

| File type | Must have |
|---|---|
| Provider export | Order ID; Currency (constant allowed); Network (constant allowed); Deposit address; Token contract (constant allowed, or the explicit option "work out from the network and token symbol", which you must choose) |
| Settlement report, per-payment lines | Provider day; Settlement currency; Bank account (constant allowed); Batch ID; Order ID; Line amount |
| Settlement report, batch totals | Provider day; Settlement currency; Bank account; Gross; Net |
| Orders / invoices | Order ID; Invoice amount; Currency |
| Bank statement (CSV/XLSX) | Bank account (constant allowed); Value date; Amount; Currency (constant allowed) |
| Ledger invoices (month-end reference only) | Invoice number; Invoice total; Currency |

Quote ID, amounts, rates and quote window are **optional** for a provider export. Leaving them out is allowed, but see section D.

## C. Not supported

| What | Why / what you see | Evidence |
|---|---|---|
| PDF statements or exports | Refused: "This is a PDF. Download the statement as CSV, Excel, MT940 or camt.053 instead." | [VERIFIED] `sniff.ts` |
| Old Excel `.xls` | Refused: save it as `.xlsx` or CSV. | [VERIFIED] |
| XML that is not camt.053 (e.g. camt.052, camt.054, pain files) | Refused as "XML or HTML, but not a camt.053 bank statement". | [VERIFIED] |
| BAI2 and fixed-width text statements | No reader. A BAI2 file would be sniffed as delimited text, but its record layout cannot be mapped to one row per transaction [ASSUMPTION: not tested]. | [VERIFIED] no reader in `ingest/` |
| Records nested deeper than a top-level list (e.g. `{ "data": { "payments": [...] } }`) | Only top-level lists can be chosen. Lists inside each record are flattened to indexed columns (`items.0.sku`), not rows. | [VERIFIED] `tabular.ts` |
| Unix-epoch timestamps | No date format for them; the column has to be left as "Not in this file". | [VERIFIED] blind test finding 5 |
| A provider export without order, currency, network, deposit address and token | Cannot be mapped (required fields above). | [VERIFIED] catalogue |
| Shape B Ethereum rows | Rejected: the layout has no token symbol column, so the token cannot be worked out from network + symbol. | [VERIFIED] PR #152 |
| A provider row whose order is not already in Clearline | "In conflict"; upload the merchant's own order list first. | [VERIFIED] blind test finding 3 |
| Networks other than TRON and Ethereum | Polygon, Solana, Arbitrum One, TON and Base are configured but disabled. Tokens: USDT on TRON, USDC and USDT on Ethereum. | [VERIFIED] migrations 0007, 0022 |
| Over the limits | 20 MiB, 100,000 rows, 200 columns, 10,000 characters per cell. | [VERIFIED] `limits.ts` |

## D. What accuracy to expect

- **Files without a quote rate or quote window → abstain.** The engine suggests such orders for review under `M3.quote.terms_unknown`. It never invents a rate. In the blind test (a format the code had never seen, 2,000 orders) this gave **0 wrong matches and a 0.00% auto-match rate**: 1,911 for review (97.9%), 41 exceptions (2.1%), 1,895 abstained for lack of quote terms [VERIFIED, `docs/release/BLIND_TEST_RC7.md`]. Correct, but not yet useful. Whether to close exact payments without quote terms is an open founder decision.
- **Imported bank lines never verify settlement** (decision 2). Statement lines from CSV, XLSX, MT940 or camt.053 are "imported, not bank-authenticated". With the policy flag off (the default), no settlement batch is verified from them. In the 10,000-payment benchmark this gave 9,627 for review, 133 exceptions and 0 matched [VERIFIED, PR #155].
- **Totals-only settlement reports** link no payment to a batch. A grouping is only proposed, for a person to confirm. The clearing check proves nothing on such data [VERIFIED].
- **Chain data unavailable → exception**, never a match (`M1.chain.unavailable`). Without `CLEARLINE_CHAIN_LIVE=1` and keys, or a recording, every read is unavailable.
- **Mapping suggestions can be wrong.** In the blind test the deposit-address and sender columns were suggested the wrong way round, and the received amount was offered as the quoted amount [VERIFIED]. Check every suggestion against values you know, such as your own deposit addresses.
- **Time for a person [GUESS].** First month with a new layout: roughly 30–60 minutes. Later months with saved templates: about 5–10 minutes.
