# Scheduled upload pickup (v1 phase 2.1)

Status: built and tested against local stand-ins only. No real SFTP server or mailbox has been connected.

## What it does

A merchant Admin can add **pickup sources**. Each source reads one location on a schedule and hands every new file to
the same upload pipeline a person uses (`createUpload`). That pipeline applies the allowlist, the hardened parsers and
their limits, the optional malware scan, the duplicate check, encrypted storage and audit. If the Admin chose a mapping
template for the source, the run also maps and validates the file with it, using the same functions a person would.

A source is one of two kinds:

| Kind | Reads | Stand-in used in tests |
|---|---|---|
| `sftp` | files in one folder | a folder under `CLEARLINE_PICKUP_ROOT` |
| `email` | attachments of messages from allowed senders | a Maildir (`new/`, `cur/`) under `CLEARLINE_PICKUP_ROOT` |

Pickup never confirms anything. The upload is recorded for the source's member, who must be a Finance or Payment
Operations member. A picked-up bank statement still needs an Approver who is not that member, and the database
enforces this as it does for every upload. Pickup never deletes or moves files at the customer's end. Each item it has
seen is remembered by a hash of its remote identity (`upload_pickup_items`), so it is read only once.

## Configuring a source

`POST /api/control/merchant/uploads/pickup` (Admin, unscoped). The body contains:

- `kind`, `name`, `entityId`, `fileType`;
- `bankAccountId`, required for a bank statement and refused for every other file type;
- `templateId` (optional);
- `location`, a relative folder or mailbox name (letters, digits, `. _ - /`, no `..`);
- `runAsUserId`, an active Finance or Payment Operations member whose entity scope covers the entity;
- `intervalMinutes`, from 5 to 1440 (default 60);
- for `email`, `allowedSenders`: at least one exact address or `@domain`;
- `credentialRef` (optional): the name of a `CLEARLINE_PICKUP_*` environment variable. It is never the credential
  itself.

`POST /api/control/merchant/uploads/pickup/<id>` with `{ "enabled": false }` switches a source off. Nothing else about a
source can change; to change a source, add a new one. The database checks every rule above again (drizzle/0055).

## Running it

Run `npm run control:admin -- pickup-run` from cron, for example every 5 minutes. It uses the owner connection, as
retention does. Each source runs only once its interval has passed. The command prints counts only.

| Variable | Meaning |
|---|---|
| `CLEARLINE_PICKUP_ROOT` | the directory the stand-ins read; required, or every source reports `PICKUP_NOT_CONFIGURED` |
| `CLEARLINE_PICKUP_MIN_AGE_SECONDS` | a file must be unchanged for this long before it is read (default 60), so half-written files wait |
| `CLEARLINE_PICKUP_<NAME>` | a credential named by a source's `credentialRef` (only real adapters use it; never logged) |

A source that cannot run is audited as `upload_pickup_unavailable` with a code and tried again on the next run. Codes
include a missing folder, a missing credential, and a member who has left. Every run writes `upload_pickup_run` with
counts.

## Email checks

A message is used only when all of these hold:

- the **topmost** `Authentication-Results` header (the one the receiving server adds) says `dkim=pass` or `dmarc=pass`;
- the `From` address is on the source's allowed list;
- it has at least one attachment.

Otherwise the whole message is recorded once as refused (`EMAIL_NOT_AUTHENTICATED`, `EMAIL_SENDER_NOT_ALLOWED`,
`EMAIL_NO_ATTACHMENT`). There are also limits: at most 10 attachments per message, multipart nesting at most 5 deep,
and a message of at most 30 MB. Each attachment must still pass the 20 MB file limit.

## What a deployment needs (not built here)

No SFTP or IMAP client library is installed, and none was added. A real deployment chooses one of these:

1. **A sync agent (no code change).** The operator runs an agent that mirrors the SFTP folder, or delivers the mailbox
   as a Maildir, into `CLEARLINE_PICKUP_ROOT`. The agent might be an SFTP mirror job, or a mail fetcher writing Maildir.
   The existing sources then work unchanged. The agent's credentials stay in the agent.
2. **A native adapter.** Implement `PickupSource` (`src/server/pickup/sources.ts`) over an SFTP or IMAP client library,
   reading the credential with `pickupCredential(credentialRef)`, and choose it in `pickupSourceFor`. This adds a
   dependency and needs the founder's approval. It needs host-key pinning for SFTP and TLS for IMAP.
3. **A provider's inbound-email webhook.** This is not built. It would need a signed webhook route (HMAC secret from the
   environment) that writes each message into the Maildir, or calls the same per-item code. The receiving provider's
   spam and authentication verdict would replace the header check.

Credentials are only ever environment variables or the deployment's secret store. They are never stored in the
database, logs or audit rows.
