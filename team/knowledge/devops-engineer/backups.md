# Backups: what can honestly be said today

Checked 31 Oct 2026 against `origin/main` @ 8decb27 and README "Private preview" [VERIFIED: files read].

## What data exists and where
| Store | Where | Persistent? | Backed up? | Notes |
|---|---|---|---|---|
| Source code, docs, team files | GitHub `trysarathy/investigation-desk` (public) | yes | GitHub + every clone; `main` unprotected → a force-push could rewrite it | Recommend branch protection (her setting) |
| App data (`.data/`: `workspace.json`, `requests.json`, `accounting.json`, `cases.json`, `bulk/`, chain cache, payments data, **`xero-tokens.json`**) | Wherever the server runs: her laptop, the Fly container, Vercel functions | Laptop: yes. **Fly preview: no volume in the Dockerfile; README: "a restart re-seeds it"**. Vercel: no [ASSUMPTION] | **No** | Demo mode only, FICTIONAL Northwind Pay data; nothing of value is lost today |
| Marketing site | `website/` in Git + `website/out/` build + the Vercel deployment | yes | Git is the backup; any commit can be rebuilt | Zip "on your Desktop" per website README |
| Company HQ Sheet, Gmail | Google | yes | Google's version history [ASSUMPTION] | Not devops' scope |
| Secrets (`.env`: `VERCEL_TOKEN`, chain keys, `ANTHROPIC_API_KEY`) | Her laptop; Vercel/Fly settings | — | **Never copied by us** | She should keep them in a password manager |

**Honest statement for the weekly report:** "No customer data exists and no persistent app data is
hosted. There is nothing to back up yet except Git. Backup restore drill: designed, not run on a live
store (none exists); scratch drill status: <done/not done>."

## When it starts to matter (trigger: first pilot or first real data in `.data/`)
The app keeps all state as JSON files under `DESK_DATA_DIR` until the database lands (week 5 per
`data-dir.ts`). Then:
1. Host on Fly with a **volume mounted at `DESK_DATA_DIR`** (e.g. `/data`), **one Machine** (the
   README's `fly scale count 1`: bulk jobs and state live in one process). Fly warns a single volume
   means downtime on deploys and data loss on host failure [VERIFIED: superfly/docs `volumes/overview.mdx`].
   With JSON files and one writer, two volumes don't help without replication; accept the single
   Machine **and** keep off-host backups.
2. Fly daily snapshots (default 5 days; set `snapshot_retention = 14` under `[mounts]`)
   [VERIFIED: superfly/docs `volumes/snapshots.mdx`]. Cost: US$0.08/GB/month after 10 GB free; a demo
   `.data/` is well under 10 GB → about US$0 [VERIFIED price; size is a GUESS].
3. **Off-host copy** (Fly: snapshots "shouldn't be your primary backup method"): nightly `tar` of the
   data dir, **encrypted** (it contains `xero-tokens.json`), to storage she owns. Options for her
   decision: Google Drive (her account, encrypted archive; free within quota) or an object store
   (cost to be quoted when needed). Never unencrypted, never in Git, never in a PR or Log.
4. Monthly restore drill (runbooks §4) into a **new** volume on a **staging** app. Metric: drill done
   y/n, RTO, RPO.
5. `xero-tokens.json` in a backup is a secret at rest. Alternative to consider with
   crypto-protocol-engineer: exclude it from backups (re-authorise Xero after a restore) to keep secrets
   out of archives.

## Scratch drill, 31 Oct 2026 (runbooks §4) [VERIFIED: run this session]
Scratch export of `main` @ 8decb27, `npm ci` + `next build` exit 0, `DESK_DATA_DIR=<scratch>/live
npx next start -p 3471`, `POST /api/requests/demo {"kind":"reset"}` → `{"ok":true}` (FICTIONAL
Northwind Pay demo day). Data dir held 2 files (`accounting.json` 44,986 B, `requests.json` 101,248 B;
19 requests; no `xero-tokens.json`). Server stopped → `tar -czf` (16,079 B) → data dir deleted →
restored to a new dir → `sha256sum -c`: 2/2 OK → app started on the restored dir: `/requests/all`
HTTP 200, page shows "Northwind"; `requests.json` still holds 19 requests (page count not checked). **Restore + start: 6.9 s. RPO = time since the last
backup (here 0: backup taken after the last write).**
Result: **drill done (scratch) = yes**. Live store drill: not applicable (no live store exists).
Lesson: the server must be stopped (or writes paused) for a consistent copy; the files are rewritten
whole by the app, so a copy mid-write could be torn [ASSUMPTION: write pattern not audited].

None of 1–5 is done by devops-engineer on a live host: each is a recommendation with cost for her.
devops-engineer may run the drill on a scratch copy with FICTIONAL data at any time.
