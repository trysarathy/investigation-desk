# Stablecoin Payment Investigation Desk

Build week 1 of Product Spec v1 (21 Oct 2026): app shell, design tokens, the case queue and the
investigation view, running on **fabricated sample data**. The rules engine (D01–D18 except D15, D07b, D99)
is also in, as pure functions. Week 2 needs it, and the investigation view should show verdicts
the code actually computed.

```
npm install
npm run dev        # http://localhost:3000
npm test           # engine fixture tests
npm run build
```

## Layout

| Path | What |
| --- | --- |
| `src/lib/engine/` | `context.ts` derives facts, `evidence.ts` builds the timeline, `rules.ts` holds one pure function per code, `run.ts` picks the verdict |
| `src/lib/fixtures/` | Sample settings, Files A and B, and 22 sample cases (one per code plus the edge cases) |
| `src/lib/templates.ts` | Approved reply templates from the spec |
| `src/lib/view.ts` | Server-side view models; verdicts are computed on the server only |
| `src/app/` | Queue `/`, investigation `/cases/[id]`, `/investigate?q=`, `/bulk`, `/settings` |
| `tests/engine.test.ts` | Fixture tests from spec section 6 |

## Prototype-only switches

- `/?state=empty` shows the new-workspace empty state; `/?state=stale` shows the stale-ledger bar.
- `/?down=tron` (or any chain) simulates a chain API outage. Affected cases show "Check paused".
- On `CS-1057`, press **R**: the re-check flips D02 to D12 and shows the red contradiction banner.

## Rule precedence (spec 22 Oct, second pass)

Every rule runs (D01–D18 and D07b; D15 memo is out of v1). The verdict is the first High match
in `CATALOGUE_ORDER`, else the first Medium, else D99. Every other match is attached as a
finding: High ones as "Also found", Medium ones as "Likely cause" with a Confirm box. Guards
inside the rules (`src/lib/engine/rules.ts`):

1. D02 matches only a deposit that would otherwise be credited.
2. D05 stands aside only for a token claiming USDT or USDC with a non-official contract (D06).
   Genuine but unaccepted USDT or USDC is D05.
3. D07 always stands; D07b is attached beside it as a Medium finding.
4. A REJECTED ledger row on a valid confirmed deposit is D16, not D99.
5. D12, D13, D14 and D16 are High only on an exact match of chain + tx_hash + transfer index +
   token contract. Without a transfer index, a tx with more than one transfer to company
   addresses caps at Medium. A row matched on address and amount only caps at Medium.
6. Address ownership is read from File A at block time. D12 and D16 need the destination
   assigned to this customer. An address held by another customer is D17; the reply never
   reveals that customer, and neither do the evidence objects. An address retired before the
   transfer, and not reassigned, is D18.

Data-quality guards (spec, 22 Oct, from code review):

- No rule matches on a missing fact. An unknown block height or a non-decimal chain amount
  (e.g. `1e3`) makes that fact unknown, shown as such in the evidence; it is never D02 or D12
  and never a crash.
- Addresses and contracts compare in one canonical form (`src/lib/address.ts`): EVM lowercase
  hex with `0x`; Tron base58, converting `41…` hex first.
- The address-and-amount ledger fallback only considers this customer's rows not dated before
  the transfer (rows without `credited_at` stay candidates and cap at Medium). D13 also
  requires the ledger row's customer to be this case's customer.

Reply templates are word for word from `docs/SPEC.md`, and a test checks each one against it.
No template may promise a future credit; a test fails on "will be credited".

## Company data

- **File B** has two optional columns: `transfer_index` (EVM log index or Tron event index) and
  `reason_code` (shown as evidence for D16 only).
- **Settings** has two text fields: the retired-address policy (D18 next step) and where a credit
  appears in the app (`{where_in_app}` in the D13 reply).

## Payout workflow hedge

`Facts.workflow` (`"deposit" | "payout"`) and `Facts.providerEvents` already hold payout
creation, provider statuses (verbatim) and later returns with their reason, and they render as
evidence with a provider source. A payout workflow would add a provider fetcher that fills
`providerEvents`, a second rule list (P-codes) selected by `workflow` in `run.ts`, and templates
for those codes. The verdict picker, findings, evidence, UI and audit record stay as they are.

## Live chain data (weeks 2–3)

Read-only fetchers in `src/lib/chain/`, one data source per chain (`src/lib/chain/sources.ts`):

| Chain | Source | Why |
| --- | --- | --- |
| Tron | TronGrid V1 (`TRONGRID_API_KEY`, optional: keyless works at 3 requests/s) | Spec |
| Ethereum, Polygon, Arbitrum | Etherscan API V2 with `ETHERSCAN_API_KEY`; without a key, `eth.drpc.org`, `polygon.drpc.org`, `arb1.arbitrum.io/rpc` | Etherscan V2 refuses keyless calls since Oct 2026 |
| BNB Chain | `https://bsc-dataseed.bnbchain.org` (public RPC) | Etherscan's free plan refuses chain ID 56 |
| Base | `https://mainnet.base.org` (public RPC) | Refused by the free plan; URL from Base's docs |
| Optimism | `https://mainnet.optimism.io` (public RPC) | Refused by the free plan; URL confirmed in Optimism's docs |

EVM lookups are by transaction hash only: `eth_getTransactionByHash`, `eth_getTransactionReceipt`
(Transfer events come from its logs), `eth_getBlockByNumber` for the block time, `eth_blockNumber`,
and `eth_call` for token metadata and freeze checks. Public RPCs are shared and rate-limited:
fine for development, demos and a first pilot only.

- **Keys** come only from the two environment variables (see `.env.example`; `.env` is
  git-ignored). Etherscan's key is redacted from every stored URL, and TronGrid's travels in a
  header that is never stored. Public RPCs need no key.
- **Raw responses** are kept with fetch time and SHA-256 in the case's facts and on disk under
  `.data/raw/` (git-ignored; Postgres replaces it in week 5).
- **Rate limits:** each host has its own request spacing. 429, 403, 5xx, Etherscan's "rate
  limit" bodies and JSON-RPC rate-limit errors are retried with exponential backoff (honouring
  `Retry-After`), then reported as a lookup error, so the case shows "Check paused".
- **Cache:** mined transactions, receipts and token metadata are cached forever; "not found",
  "pending", freeze state and the current block are cached for seconds to a minute.
- **D01** fires only when all seven chains answer "not found"; any chain error pauses the case.
- **D09** reads `isBlackListed(address)` (USDT) or `isBlacklisted(address)` (USDC) on the
  issuer's official contract, for sender and destination. Selectors are computed with keccak256
  in the tests, not recalled. A failed call makes freeze status unknown, which blocks D02 and D12.
- **D07b** sender history comes from TronGrid (Tron) and Etherscan's account module (Ethereum), or
  Blockscout's public API v2 on Ethereum when no Etherscan key is set. It is only fetched when the
  look-alike pattern could match (first 3 and last 4 characters). Both poisoning shapes count:
  dust from the look-alike to the sender, or a forged zero-value / counterfeit-token transfer from
  the sender to the look-alike, before the payment. Other public-RPC chains can't list history,
  so there D07b is off and the case says so.
- **Official contracts on BNB Chain stay unset:** neither Tether's nor Circle's own pages list
  one, so D09 doesn't run there. A company can declare its own BNB Chain token in settings; the
  sample settings declare BSC-USD (`0x55d398326f99059ff775485246999027b3197955`), labelled
  "sample setting" wherever it appears. D06 then checks against the company's declaration, not
  an issuer confirmation.
- **D10** is disabled; see `docs/week2-d10-mempool.md`.

Pasting a hash that isn't a sample case runs it live (`/investigate?q=…&customer=…`) against
the uploaded Files A and B (see below); without both files no live verdict is given.

`tests/fixtures/live/` holds real public USDT transfers between labelled wallets, recorded once
and replayed offline by `tests/live.test.ts`. To re-record them:

```
NODE_USE_ENV_PROXY=1 npx vite-node --config vitest.config.mts scripts/record-live.ts
```

(`NODE_USE_ENV_PROXY=1` is only needed behind an HTTPS proxy, on Node 22.21 or later.)

## Uploads, ledger join, AI text and bulk (week 4)

- **Uploads** (Settings → Data, `POST /api/uploads/A|B`): Files A and B are validated by
  `src/lib/csv/files.ts`. A missing required column, invalid UTF-8 or a broken quote rejects
  the file (the previous one stays). A bad row is rejected and listed with its line, column and
  reason; nothing is trimmed, case-folded or guessed. Tron and EIP-55 checksums catch typos,
  overlapping address assignments are rejected, and a customer ID that looks like an email is
  refused (no personal data). An identical re-upload (same SHA-256) is a no-op. Uploads live in
  `.data/workspace.json` until the database lands.
- **Rejected rows are unknown facts:** while any File A row was rejected, D07 caps at Medium;
  while any File B row was rejected, D12 caps at Medium. Either could be the very address or
  credit the verdict depends on.
- **Ledger join D12–D18** runs on the uploaded files. A pasted hash with no customer takes the
  customer from File A (the destination's owner when the transfer was mined), and the case
  says so; with no owner at that time, nothing is inferred.
- **AI explanation** (`src/lib/ai/`): Claude (default `claude-haiku-5-5`, override with
  `AI_MODEL`; official SDK, structured JSON output; server-side refusal fallback only on models
  that support it, which Haiku 5.5 does not) gets only the verdict code, the evidence objects with
  customer IDs scrubbed, and the reply template with company-setting values pre-filled. The
  output is rejected, and template text shown, if a sentence cites no evidence or unknown
  evidence, or contains a number, address, hash, date or token name not in the evidence, or a
  banned word; the reply must keep the approved template wording. No `ANTHROPIC_API_KEY`, an
  outage or a rejection all fall back to template text; `AI_EXPLANATIONS=off` forces it. The
  spec's no-training, zero-retention agreement is an Anthropic organization setting and must be
  in place before real customer data is sent.
- **Bulk** (`/bulk`): a CSV of `tx_hash, chain (optional), customer_id (optional)`, up to 1,000
  rows. Bad rows are skipped and listed; the rest run as a background job with a progress bar.
  "Create cases for non-credited" adds every result not shown as credited (D13) to the queue as
  a live case; "Export results CSV" neutralises cells a spreadsheet would execute.

## Decisions after Week 4

- **AI model:** `claude-haiku-5-5` by default; set `AI_MODEL` to use another.
- **Reporting customer:** the investigate form has an optional "Reporting customer" field
  (`/investigate?q=…&customer=…`), and the case view lets you set or change it. With it, D17
  can fire on a pasted hash; without it, the customer is still taken from File A and labelled.
- **BSC-USD** on BNB Chain is declared in the sample company settings (see above).
- **Demo mode:** Settings → Data → **Load demo workspace** replaces Files A and B with the
  fabricated demo files in `src/lib/demo/files.ts` and clears demo cases and bulk runs; press it
  again to reset. Real transactions in the demo are served from the recorded chain responses in
  `tests/fixtures/live/`, so the demo needs no keys and gives the same answer every time. The
  panel lists the section 10 script steps with a link for each, plus a demo bulk CSV. An
  upload of your own ends demo mode.

## Private preview

A shareable link for a call, with **no real customer data**: set `DEMO_MODE=1`. The server
then seeds the demo workspace on first load, refuses uploads (403), and the reset button stays.
Add `PREVIEW_USER` and `PREVIEW_PASSWORD` to put the whole app behind a browser password
prompt. Leave `ANTHROPIC_API_KEY` unset (the image also sets `AI_EXPLANATIONS=off`): template
text only, so nothing is sent to a model. Chain keys are optional. Without them, only the
recorded demo hashes give verdicts, and any other hash pauses rather than guessing.

Option 1, a quick tunnel from your laptop (the link lives while the command runs):

```
npm ci && npm run build
DEMO_MODE=1 AI_EXPLANATIONS=off PREVIEW_USER=demo PREVIEW_PASSWORD='choose-one' npm start
cloudflared tunnel --url http://localhost:3000     # second terminal; prints https://….trycloudflare.com
```

Option 2, a hosted container (Fly.io shown; Render or Cloud Run work the same way with the
`Dockerfile`):

```
fly launch --no-deploy --internal-port 3000 --name investigation-desk-preview
fly secrets set PREVIEW_USER=demo PREVIEW_PASSWORD='choose-one'
fly deploy
fly scale count 1      # one machine: bulk jobs and the demo workspace live in its process and disk
```

The image already sets `DEMO_MODE=1`. The workspace is on the container's disk, so a restart
re-seeds it, which is fine for a demo. Before sharing, open the link in a private window, check
the password prompt, then run step 1 from Settings → Data.

To build and run the image locally: `docker build -t desk-preview . && docker run -p 3000:3000
-e PREVIEW_USER=demo -e PREVIEW_PASSWORD=choose-one desk-preview`.

## Payment records and three-way matching (product direction, chunk 1)

`/payments`, code in `src/lib/payments/`.

- **Canonical payment:** one payment ID (`PAY-…`, first derived from the instruction ID, or from
  the provider and its payment ID when there is no instruction) links instruction → on-chain
  transfer(s) → provider record → bank record → ledger entry → later returns, plus fee rows.
  Every record keeps its original identifiers (with the column they came from), its event time
  as the source wrote it, its observed time, every source row (file, line, mapping version) or
  explorer link plus raw-response SHA-256, and the original row unchanged.
- **Imports with column mapping:** payment instructions, provider settlement reports and bank
  records. Mappings are saved and versioned: an edit is the next version and every record names
  the version that read it. Validation is the Files A/B code: missing required column rejects
  the file, a bad row is listed with line, column and reason, nothing is trimmed or guessed,
  an ID that looks like an email is refused, and the same file (SHA-256) is a no-op. A row
  already held (same identifier, same content) adds a source to that record: a duplicate record,
  not a second payment. Imports append, since providers send overlapping period reports.
- **Provider status** is kept raw beside a mapped meaning. `COMPLETE` means "provider reports
  complete", never "beneficiary credited". A status not in the mapping shows raw as "unmapped".
- **BVNK** is the first provider format (`src/lib/payments/presets.ts`, with the docs URL for
  each part). Column names are confirmed against help.bvnk.com; reading "Amount" as the settled
  amount (vs Transaction Amount, Paid Actual Amount, Required Amount) is not yet. Another
  provider is another mapping; nothing in the matcher is BVNK specific.
- **Timestamps** are ISO 8601 with an offset, or Unix seconds or milliseconds as the mapping
  says. A Unix time outside 2009–2099 in the mapping's unit is a row error (usually the wrong
  unit). Due and created times compare as instants.
- **Matching** links on exact identifiers only: merchant reference = instruction ID, or the
  instruction names the provider payment ID; chain + tx hash + transfer index; the bank row's
  instruction or provider ID column. A hash with no transfer index links only when that
  transaction carries exactly one token transfer. Several candidates, identifiers that
  disagree, a chain that doesn't match, or a record that arrived with different content go to
  review. Amount, time and address similarity only rank candidates and suggestions. A failed
  chain lookup leaves the leg unknown, never missing. Bank free text is never parsed.
  - A hash found on more than one chain goes to review. Found on one chain while another chain
    didn't answer: unknown, unless the record names the chain it was found on.
  - An instruction that arrived with conflicting content holds its provider and chain legs in
    review too. A bank row naming two payments, or a provider ID no payment has, is reviewed.
    Fee and return rows attach through `relates_to` only where that provider leg is linked, and
    through a merchant reference only where the instruction and provider legs are both linked;
    otherwise they wait in a review on the payment. Amounts compare as decimals.
- **Payment IDs never change once assigned** (kept in `.data/payments.json`, also across "Clear
  records"). An instruction that arrives for a provider-only payment takes that payment's ID.
  An ID always stays with the payment that owns it; another payment can only take over an ID
  nobody is using.
- **Retired payment IDs never vanish.** An ID no payment carries any more redirects: "X merged
  into Y", "X is held in review R on Y", or "X is no longer held" after its records were
  cleared. `/payments/X`, a stale review ID, and `GET /api/payments/resolve?ref=X` all resolve
  to the current payment. Provider records held in a review show their reserved IDs in the
  review queue.
- **Ledger leg** joins File B on the linked transfer (chain + hash + index).

## Exceptions, inbox and exports (product direction, chunk 2)

`/inbox`, code in `src/lib/payments/` (`exceptions.ts`, `inbox.ts`, `workflow.ts`, `export.ts`, `pdf.ts`).

- **Payout ledger** is a fourth mapped import (`payout-ledger-standard`; same strict validation;
  status kept raw beside a meaning: posted, pending, reversed, failed, or unmapped). The ledger
  leg links on the entry's instruction ID, provider payment ID, or the linked transfer's chain +
  hash + index, and still reads File B deposits. Ledger legs follow direction: File B deposit
  rows link only to a transfer into a company deposit address (File A) and that address; payout
  ledger rows only to everything else. Entries are grouped by entry ID, so "posted"
  then "reversed" is a status history; a `reverses` column attaches a reversal to its entry.
- **Exception rules**, computed from the matched payments, each with evidence (and the source of
  every fact), a confidence level and a next step:
  - missing leg by stage: High when a later stage is already there, or the provider reports
    complete with a hash no chain has; Medium when the provider reports complete with no hash,
    or once the route's grace has passed, for the stage the payment is stuck at; nothing while
    in flight. Never High on an unknown: a failed chain lookup makes "overdue" Medium and says so;
  - duplicate record (the same record more than once); v1 never reports a duplicate payment;
  - amount mismatch, exact decimals, between any legs that share an asset (an instruction
    without a token doesn't stop the provider vs on-chain check); a difference is explained
    only by a linked fee record or the route's configured fee rule; fee mismatch when those
    two disagree;
  - overdue against the instruction's `due_by`, else the route's deadline; a leg with no
    records of its kind imported isn't counted;
  - unmatched settlement: a provider record no instruction carries, or a bank, fee or return
    row no identifier ties to a payment; unmatched ledger entry (Medium): a payout-ledger entry
    no identifier ties to a payment;
  - contradiction: after the provider reported complete, a later return, cancellation or
    reversal; or a failed transfer; or a ledger posting later reversed;
  - deposit investigations (D01–D18) from the queue, as one more family.
- **Routes** (Inbox → Routes and deadlines): per provider, chain and token, the deadline, grace,
  expected legs and fee rule. Versioned and audit-logged. The shipped routes are sample settings.
- **Inbox**: filled by every matching run. Status open, awaiting provider, under review,
  closed, reopened; owner, follow-up date, notes; full history. An exception closes by itself
  when its condition goes away, reopens when its evidence changes, and a later contradiction
  reopens the exceptions a person closed on that payment; every item of that payment shows a
  "new contradiction" banner. When a payment ID merges into another, its items move with it
  (status, owner, notes, history, a person's close); the old item ID redirects. While a payment
  waits in a review, its items are held, not closed.
- **Review resolution in the app**: confirm or reject a candidate, with a required reason. The
  decision (who, when, why) is kept, audit-logged and applied on every later run.
- **Audit log** (`.data/audit.jsonl`): append-only, strictly increasing sequence numbers
  (writes are serialised); imports, "clear records", inbox changes, review decisions, route
  changes, system opens/closes/reopens/moves and exports, with actor, time and IP. Imports and
  clearing need an "Acting as" name. The actor is the
  "Acting as" name until sign-in lands (week 5).
- **Exports**: Inbox → Export reconciled CSV (one row per payment, plus one per retired payment
  ID showing where it leads), and an evidence pack PDF per item. Every ID goes through the same
  resolver as `/api/payments/resolve`. Both downloads are audit-logged. The bulk results export
  uses the same CSV writer, so signed amounts stay numbers there too.
- **Payout test data**: `tests/fixtures/live/bsc-payout-*.json` are real BNB Chain transfers
  recorded by `scripts/record-payouts.ts` (no keys needed for the lookups matching makes). None
  goes to a demo deposit address, so the inbox fixtures never reuse a deposit-demo transfer.

## Not built yet (by plan)

Auth, roles, row-level security, audit log, rule versioning and Settings editing (week 5):
until then uploads and bulk runs are open to anyone with the app, and the live checks use the
sample company settings. Bulk jobs live in the server process and don't survive a restart.
Official contracts other than those confirmed on the issuers' pages stay unset; with them
unset, D06 does not run for those pairs.

## Real-data test (24 Oct 2026)

`tests/real_cases.json` holds 59 real public transactions with the correct answer proven by a
source other than this product (Tronscan, Blockscout, a second RPC, the issuer's own blacklist
event, published write-ups). Cases that need company records use **SAMPLE COMPANY DATA**: a
fictional company's Files A and B in `tests/real-data/` that reference the real transactions.
`tests/real_cases_holdout.json` is a second set of 52, built after the fixes. 57 cases replay
offline in `tests/real-cases.test.ts`; re-record with
`RECORD_REAL=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/real-record.test.ts`.
Results and the demo are in `demo/` (`demo/REPORT.md`).

Precedence change from that test: **D09 issuer freeze now comes straight after D03**, ahead of
wrong network, token and address codes. D17 is Medium when the reporting customer has no address
in File A (most likely a mistyped customer ID).

## Payment requests (USDC on Ethereum)

A business requests an exact amount of USDC on Ethereum. The sender gets a payment page, transfers
are matched to the request, and the business acknowledges the payment. Read-only and
non-custodial: nothing here holds keys or moves funds.

**Why Ethereum.** Circle's official USDC contract is already confirmed in the code for Ethereum.
The engine checks fake tokens (D06) and issuer freezes (D09) against it there.

| Page | What |
| --- | --- |
| `/requests` | Inbox: every request with its state, the next action and the owner |
| `/requests/new` | Create a request: customer, invoice, amount, receiving address |
| `/requests/<id>` | Detail page. It shows: requested vs received amounts; each transfer, its source and the engine's check; the evidence; what the data can't tell you; the next action and decisions; the reply draft; the activity history |
| `/pay/<publicId>` | The sender's page: amount, token, network and address, plus an EIP-681 QR code and live status. Customer-facing, so it has no sidebar |

**States** (derived from the records every time, never stored; `src/lib/requests/types.ts`):

| State | Meaning |
| --- | --- |
| Awaiting payment | No valid transfer counts yet, or the business asked for the balance of a short payment |
| Transfer detected | Seen, not yet in a block |
| Confirming | In a block, below the 12 confirmations required |
| Matched | Confirmed, in genuine USDC, for exactly the amount. **Not** completed: the business hasn't said it credited it |
| Needs review | A person must decide: a short or over payment, a flagged transfer (fake token, failed transaction) or an ambiguous match |
| Completed | An operator acknowledged it (or accepted a short or over payment, with a reason). Only this makes a request complete |

**Matching** (`src/lib/requests/lifecycle.ts`) is deterministic and conservative:

- Only open requests paid to the transfer's address are candidates.
- One candidate: the transfer is matched to it.
- Several candidates (a shared address): never decided by amount alone. A person assigns the
  transfer, with a reason.
- A transfer counts only if it is a successful transfer of Circle's contract, and the engine
  found no problem.
- A repeat of the same event (chain + hash + log index) counts once.
- Confirmations never go backwards.
- Amounts are exact decimal strings throughout.

Every transfer is checked by the existing investigation engine (`src/lib/requests/check.ts`).
Each check is appended, never replaced. Decisions and activity are append-only.

**Transfer sources** (`src/lib/requests/provider.ts`) share one small interface, so both feed the
same ingestion:

- `SimulatedProvider`: the demo's chain. Every event is labelled simulated.
- `LiveHashProvider`: a real Ethereum transaction hash, looked up read-only ("Record a real
  transaction" on a request).

**Demo.** "Load the demo day" seeds one sample business (Harbor & Pine Supply Co., synthetic)
with three scenarios: a routine payment, a short payment and a look-alike token. Demo controls
send, mine and confirm simulated transfers through the real records. "Deliver last event again"
shows duplicate handling. "Reset demo" removes demo records only. State lives in
`$DESK_DATA_DIR/requests.json`, so it survives refreshes and restarts. No keys or network needed.

**Not built yet:**

- watching addresses (live detection without pasting a hash);
- networks other than Ethereum, and tokens other than USDC;
- unique address generation per request (the business supplies the address);
- notifications;
- sign-in.
