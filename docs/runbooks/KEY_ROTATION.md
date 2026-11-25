# Key rotation (field encryption, v1 Phase 5.3)

See `docs/security/ENCRYPTION_V1.md` for the design. All commands run as the **schema owner** (never the app's login), while the app keeps serving:

```
export DATABASE_OWNER_URL=<owner login>          # never printed
export CLEARLINE_KMS_KEYS=<id>:<base64 key>[,…]   # the first is active; from the secrets manager, never the repo
npx tsx --conditions=react-server scripts/crypto/keys.ts <command> [--org <uuid>] [--batch N]
```

Commands: `status`, `backfill`, `reencrypt` (the same pass as backfill), `rotate-data-keys`, `rewrap`, `verify`, `purge-retired`. Output is counts, organisation ids and key ids only.

A key is 32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never reuse one, and never put one in a ticket, a log or chat.

## First enablement (expand step)

1. Deploy migrations 0071 and 0072 and the release that writes sealed copies.
2. Set `CLEARLINE_KMS_KEYS=k1:<key>` on every server and the worker, then restart them one at a time. New writes are sealed. An organisation gets its keys on its first sealed write.
3. `backfill`, then `verify`. Expect `"problems":[]` and `"unsealed":0`. `status` shows every value at version 1.

## Data-key rotation (routine, e.g. yearly, or when a data key may be exposed)

1. `rotate-data-keys` (or `--org <uuid>` for one organisation). Each organisation's active data key becomes `retired` and a new version becomes `active` in one transaction. Servers pick it up on their next transaction. Nothing is restarted.
2. `reencrypt`. The lazy re-encrypt job moves every value sealed with a retired version to the active one, in batches of short transactions. Reads keep working throughout, because a retired key still opens its values. It can be stopped and re-run.
3. `status`. Every organisation should show only the new version in `sealedByVersion`.
4. Wait at least one day, so that no long transaction that started before the rotation is still writing with the old version. Then run `reencrypt` and `status` again, and then `purge-retired`. Purging deletes the retired keys that no stored value uses. After that, anything they sealed elsewhere, such as an old backup, cannot be opened with the current keys.
5. `verify`.

The blind-index key is **not** rotated by this, so equality and uniqueness never break. Rotating it means re-indexing every row. That needs a new index column, a backfill and a switch, and is not built.

## Master-key rotation (KMS key; routine, or when the master key may be exposed)

1. Make a new key `k2`. Set `CLEARLINE_KMS_KEYS=k2:<new>,k1:<old>` on every server and the worker (new first), and restart them one at a time. New organisation keys are wrapped under `k2`, and `k1` still unwraps.
2. `rewrap`. Every organisation key is unwrapped with `k1` and wrapped under `k2`. No field value changes. Expect `"remainingOther":0`.
3. Set `CLEARLINE_KMS_KEYS=k2:<new>` everywhere and restart one at a time. `verify`. Then destroy `k1` in the secrets manager.

With a hosted KMS, rotating the hosted key's material is done by the service, which keeps old versions for decryption, so nothing changes here. Moving to a **different** hosted key id follows the same steps as above, with the adapter's key ids in place of `CLEARLINE_KMS_KEYS`.

## If something goes wrong

- **`verify` reports `does_not_open_or_disagrees`.** A sealed value was moved or altered, or its plaintext copy was changed outside the app. Reads of that entity are refused until it is fixed. Find the row from the table name, then compare it with the upload that produced it. Never "fix" it by copying a ciphertext from another row: the AAD binding refuses that.
- **"Master key … is not configured".** A server is running without the key that wraps an organisation's keys. Add the key back. Never remove a master key before `rewrap` reports `remainingOther: 0`.
- **Deleting a merchant** (`delete-merchant`) also deletes its `org_data_keys`. Its sealed values in old backups then cannot be opened (crypto-shredding).

Tested end to end by `tests/control/field-encryption.test.ts` ("key rotation without downtime").
