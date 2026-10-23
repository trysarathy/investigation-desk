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
| Tron | TronGrid V1 (`TRONGRID_API_KEY`) | Spec |
| Ethereum, Polygon, Arbitrum | Etherscan API V2, free key (`ETHERSCAN_API_KEY`) | Every call we need works on chain IDs 1, 137, 42161 |
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
- **D07b** sender history comes from TronGrid (Tron) and Etherscan's account module (Ethereum),
  and is only fetched when the look-alike pattern could match. Public RPCs can't list history,
  so on those chains D07b is off and the case says so.
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

## Not built yet (by plan)

Auth, roles, row-level security, audit log, rule versioning and Settings editing (week 5):
until then uploads and bulk runs are open to anyone with the app, and the live checks use the
sample company settings. Bulk jobs live in the server process and don't survive a restart.
Official contracts other than those confirmed on the issuers' pages stay unset; with them
unset, D06 does not run for those pairs.
