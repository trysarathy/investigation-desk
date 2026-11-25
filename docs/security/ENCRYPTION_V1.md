# Encryption in Clearline v1 (Phase 5.3)

Status: expand step built and tested; contract step written down here and **not run**. This is a security-control change. The full list of changed controls is at the end.

## 1. At rest: what the hosting proposal provides

[ASSUMPTION: hosting is founder decision 4, which has not been made. Nothing is deployed or priced.] The proposal (`docs/runbooks/DEPLOYMENT_RUNBOOK_RC7.md`, "Phase 4 proposal"; `docs/SPEC.md` §7) asks for:

| Layer | What the proposal asks for | What it protects against | What it does not protect against |
|---|---|---|---|
| Managed PostgreSQL 16 | Storage encryption at rest (provider-managed keys), encrypted backups and point-in-time recovery, TLS in transit | A lost or stolen disk, snapshot or backup medium | Anyone who can query the database: an operator, a leaked database login, a SQL injection, a backup restored by someone with access |
| Object storage for uploads | Encrypted private buckets | The same, for stored files | The same |

Provider storage encryption is transparent: every login that can read a table reads it in the clear. That is why the wallet addresses and customer references below are also encrypted by the application.

[VERIFIED in code] **Uploads are already encrypted by the application** (`src/server/storage/local.ts`): with `CLEARLINE_UPLOAD_KEY` (32 bytes, base64) every stored file is AES-256-GCM with a random 12-byte IV, and the organisation and storage key are the additional authenticated data, so a file moved to another organisation does not open. With `NODE_ENV=production` and no key, uploads are refused (`src/server/storage/index.ts`). Tested by `tests/server/upload-storage.test.ts`. The upload key is one application-wide key; moving it under the KMS below is a follow-up, not part of this phase.

## 2. Application-level encryption of addresses and references

### What is encrypted

| Table.column | Kind | Blind index | Row id bound into the ciphertext |
|---|---|---|---|
| `merchant_quotes.deposit_address` | wallet address | yes (`address`) | quote id |
| `payment_links.deposit_address` | wallet address | yes (`address`) | link id |
| `chain_transfers.from_address`, `to_address` | wallet addresses | yes (`address`) | network, tx hash, log index, source |
| `chain_transfers.prior_hops` | earlier hops (addresses), JSON | no | same |
| `address_facts.address` | wallet address | yes (`address`) | network, fact, blind index |
| `chain_reads.address` | wallet address | yes (`address`) | read id |
| `ledger_invoices.order_ref` | customer order reference | yes (`order_ref`) | entity, invoice number |
| `ledger_invoices.contact` | customer name | no | entity, invoice number |

The list lives in code in `src/server/crypto/fields.ts` (`ENCRYPTED_TABLES`); every read and write path uses it.

### Not sealed yet (must be done before the contract step)

The test `tests/control/field-encryption.test.ts` ("plaintext inventory") scans every text and JSON column for the addresses and references it wrote and fails if the list changes. Besides the plaintext columns the expand step keeps on purpose, it finds:

- `match_records.chain`: the engine's stored record of each payment names the transfers' addresses (and earlier hops, path facts).
- `match_records.explanation`: the explanation text names the sender address ("Sender … recorded as a fact only").

These are derived copies written by `src/server/merchant.ts` and read in about 34 places. Sealing them (a sealed JSON column and opening it wherever a record is read) is the next slice. **Also not in this phase:** `invoices.order_id` and the other `order_id` columns. They are the merchant's order numbers, the primary and foreign key of about 15 tables, and are shown, searched and exported everywhere. Encrypting a key column needs a design decision (a surrogate key, or a keyed index as the key). See "Decisions needed" in the report. The rc5-era tables (`payment_intents.internal_reference`, …) are legacy and out of scope.

### How

- **Envelope encryption.** Each organisation has its own data keys and one blind-index key (table `org_data_keys`, migration 0071). They are stored only *wrapped* by a master key held in a KMS (`src/server/crypto/kms.ts`). Unwrapped keys live only in server memory.
- **Fields.** AES-256-GCM with a random 12-byte IV. The additional authenticated data is `clearline/field/v1|<org>|<table>|<column>|<row id>`, so a ciphertext copied to another row, column, table or organisation does not open. The stored format is `ce1.<data key version>.<base64url(iv|ciphertext|tag)>`, and the version picks the key, so values sealed with a retired key still open.
- **Blind index.** HMAC-SHA256 with the organisation's index key over a domain (`address` or `order_ref`) and the **exact** value, stored as 64 hex characters. Nothing is lower-cased or normalised. Equality on the index is exactly equality on the plaintext: the same uniqueness (`merchant_quotes_deposit_bidx_uq`, `payment_links_deposit_bidx_uq`) and the same joins (tested: the transfer→quote join on the index returns exactly the rows the plaintext join returns). All address columns share the `address` domain, so they can be joined with one another. Indexes differ between organisations by design.
- **Matching is unchanged.** The engine never sees ciphertext. `loadReconcileInput` opens every value before the engine runs, and the engine compares addresses as before (`normAddress`). Proof is below.
- **KMS interface** (`Kms`): `activeKekId()`, `canUnwrap(kekId)`, `wrap(dataKey, context)`, `unwrap(wrapped, context)`. The context is `org:<id>|purpose:<data|index>|v:<n>`.
  - `LocalKms` is the local stand-in. Master keys come from `CLEARLINE_KMS_KEYS="<id>:<32 bytes base64>[,<id>:<key>…]"`, and the first one is active.
  - `HostedKmsAdapter` is the documented shape for a hosted KMS. It takes a client with `encrypt({keyId, plaintext, encryptionContext})` and `decrypt({keyId, ciphertext, encryptionContext})`, which map one to one onto a cloud KMS's Encrypt/Decrypt with an encryption context. The context then appears in the service's own audit log. No hosted service is called or configured anywhere.
- **When it is on.** It is on when a KMS is configured. With `CLEARLINE_DEPLOY_ENV=staging` or `production` and no KMS, every write of these fields is refused (`KMS_REQUIRED`). Local, CI and demo runs without a key store plaintext only, as before.
- **Errors and logs.** Errors name the table and column, a key id or a version, never a value, a ciphertext or a row id. Maintenance output is counts only. This is tested.

### Expand / contract

1. **Expand (migration 0072, done).** Add `<col>_enc` and `<col>_bidx` beside every plaintext column, with format checks, both-or-neither checks, and blind-index indexes. Every plaintext column, constraint, index and trigger stays.
2. **Dual write (done).** Every insert path writes the plaintext and the sealed copy and index: `writeIngested`, normalisation (row-by-row and bulk), chain verification, and ledger normalisation.
3. **Backfill (script, done).** `scripts/crypto/keys.ts backfill`, run as the owner in batches while the app serves. It is idempotent. Then `verify` must report `problems: []` and `unsealed: 0`.
4. **Switch reads (done).** Every read of these columns takes the value from the sealed copy, falls back to the plaintext only where a row is not backfilled yet, and **refuses a row whose two copies disagree** (tamper detection while both exist). The `address_facts` list is still ordered by the plaintext column while it exists.
5. **Contract (documented, NOT run).** Run it only after (a) the derived copies above are sealed, (b) `verify` is clean on every organisation, and (c) a release that reads the sealed copies only has run for a full retention cycle. The SQL is below. It is not in `drizzle/` and is not in the journal:

```sql
-- 00xx_field_encryption_contract.sql (DRAFT; approval required; not run)
ALTER TABLE merchant_quotes ALTER COLUMN deposit_address_enc SET NOT NULL, ALTER COLUMN deposit_address_bidx SET NOT NULL;
DROP INDEX merchant_quotes_deposit_uq; ALTER TABLE merchant_quotes DROP COLUMN deposit_address;
ALTER TABLE payment_links ALTER COLUMN deposit_address_enc SET NOT NULL, ALTER COLUMN deposit_address_bidx SET NOT NULL;
DROP INDEX payment_links_deposit_uq; ALTER TABLE payment_links DROP COLUMN deposit_address;
-- chain_transfers: keep_chain_fact() must first be rewritten to compare the _bidx columns (it names from_address/to_address/prior_hops)
ALTER TABLE chain_transfers ALTER COLUMN from_address_enc SET NOT NULL, ALTER COLUMN to_address_enc SET NOT NULL;
DROP INDEX chain_transfers_to_idx; ALTER TABLE chain_transfers DROP COLUMN from_address, DROP COLUMN to_address, DROP COLUMN prior_hops;
-- address_facts: the primary key moves to the index
ALTER TABLE address_facts DROP CONSTRAINT address_facts_org_id_network_address_fact_pk;
ALTER TABLE address_facts ADD PRIMARY KEY (org_id, network, address_bidx, fact); ALTER TABLE address_facts DROP COLUMN address;
ALTER TABLE chain_reads DROP CONSTRAINT chain_reads_target_chk;
ALTER TABLE chain_reads ADD CONSTRAINT chain_reads_target_chk CHECK ((address_enc IS NULL) <> (tx_hash IS NULL)); ALTER TABLE chain_reads DROP COLUMN address;
ALTER TABLE ledger_invoices DROP COLUMN order_ref, DROP COLUMN contact;
```

The application changes that go with it: the read helpers stop falling back; `address_facts` is ordered after opening, by the same order PostgreSQL gave; `chain_verify`'s issued-address set and `unavailableReads` use the opened values (they already do); and the normalisation key for `address_facts` uses the index.

## 3. Proof that matching is unchanged

- `tests/control/field-encryption.test.ts`: the same synthetic organisation goes through the whole upload pipeline and chain verification (`scripts/bench/e2e-core.ts`: 120 payments, 2 entities) with encryption OFF and ON. Both give the same decisions, the same match records (every part), the same runs, differences and exceptions, and the same reconciliation inputs. Bank line ids are masked: they are row fingerprints that include the organisation's random bank-account id, so they differ between any two organisations. Within one organisation, input hashes are compared **exactly** before and after the backfill, a data-key rotation, the re-encrypt job, the purge and a master-key rotation.
- The whole existing control suite runs with encryption on (`CLEARLINE_TEST_ENCRYPTION=on npm run test:control`) and off (the default). See the report for counts.
- Timing on the demo seed: `scripts/perf/encryption-recon.ts`, with results in the report.

## 4. Changed security controls (complete list)

1. New table `org_data_keys` (0071). RLS is forced. Members read their own organisation's keys, and a provider under a full grant reads them (it already reads those rows). The app may insert only an organisation's first keys (version 1, active). It has no UPDATE or DELETE. A trigger keeps a key's identity immutable, never reactivates a retired key, and requires a re-wrap to be stamped. The runtime role gains SELECT and INSERT on this table (a runtime-grants snapshot change).
2. `chain_reads` (0072): UPDATE was refused for everyone (`refuse_change`). It is now refused for everyone **except the table owner changing only the sealed columns** (backfill or re-encrypt). DELETE keeps `refuse_change`. The runtime role still has no UPDATE privilege.
3. `ledger_invoices` (0072): the same change to `ledger_invoices_no_change`.
4. `chain_transfers`, `merchant_quotes`, `payment_links`, `address_facts` (0072): a new trigger `guard_sealed_update`. Only the table owner may change a sealed value, nobody may remove one, and a blind index never changes once written. `keep_chain_fact` is unchanged.
5. New CHECK constraints on the shape of sealed values and indexes, and new indexes on the blind indexes. The existing unique indexes on the plaintext stay.
6. Reads now refuse a row whose sealed and plaintext copies disagree (new refusal, `FieldCryptoError`).
7. Staging and production refuse to store these fields without a KMS (new refusal).
