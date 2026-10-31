# Task 8: Backup restore drill (scratch) + what a Fly pilot needs

**Result: drill passed on a scratch copy. Backed up, deleted, restored: 3/3 files' sha256 match, the app came
back serving the same data (including the drill's own request) in 1.4 s. This proves the mechanism, not a live
host: today no live store exists, and the current Fly preview (if running) keeps data inside the container with
no volume and no backup.**

Run **31 Oct 2026, 14:32–14:34 SGT** (06:32–06:34 UTC; the request is dated 10 Nov, this is the actual run
time). Scratch worktree of `origin/main` @ **8decb27bdcb8caca588eef5b52f45819fde8c227** at
`/tmp/claude-0/devops-eval` (removed after); data in the session scratchpad. Node v22.22.0. FICTIONAL demo data
only; `PREVIEW_USER` and `DESK_DATA_DIR` checked unset (presence test, no values printed).
`npm ci` exit 0 (127 packages); `npx next build` exit 0 (19 static pages).

## Drill (runbooks §4), all [VERIFIED: run this session]
| Step | What I did | Result |
|---|---|---|
| 1 Seed | `DESK_DATA_DIR=<scratch>/drill/live DEMO_MODE=1 LIVE_LOOKUPS=off AI_EXPLANATIONS=off npx next start -p 3471`; `POST /api/requests/demo {"kind":"reset"}`; `POST /api/requests` (FICTIONAL "Drill Co", invoice DRILL-0001, 123.45 USDC, burn address `0x…dEaD`) | `{"ok":true}`; `{"id":"REQ-1001"}`. `/requests/all` 200, shows DRILL-0001. Data dir: `accounting.json` 44,986 B, `requests.json` 101,818 B (20 requests), `workspace.json` 2,776 B. **No `xero-tokens.json`** |
| 2 Back up | Stopped the server (port 3471 → no answer), `sha256sum` manifest, `tar -czf backup-20261031.tgz -C drill live` at 06:33:07 UTC | 17,053 B, sha256 `41ac20c3…09dde8` |
| 3 Lose it | `rm -rf drill/live` | gone |
| 4 Restore | untar into `drill/restored`, start app with `DESK_DATA_DIR=drill/restored` | `/requests/all` 200 |
| 5 Verify | `sha256sum -c` against the manifest; page content; record count | **3/3 OK**; page shows DRILL-0001 and "Northwind"; `requests.json` 20 requests |
| Control | same app on an **empty** data dir | `/requests/all` 200 but DRILL-0001 **absent** (0) → the restored page really came from the backup, not a demo re-seed |

**RTO (scratch): 1.4 s** (1,386 ms from untar start to `/requests/all` 200, app start included).
**RPO (scratch): 0** (backup taken with the server stopped, after the last write).
`Backup drill: done 2026-10-31 (scratch), RTO 0:01.4, RPO 0, files 3/3 match.`

What this does **not** show:
- A live-host restore (none exists). Real RPO = time since the last backup: with a nightly backup, up to 24 h.
- Copies taken while the app is writing: I stopped the server for a consistent copy. On a live host the backup
  must pause writes or stop the Machine [ASSUMPTION: write pattern not audited; files are rewritten whole].
- `xero-tokens.json` handling: absent in the drill (no Xero connection). In a pilot it's a secret inside the backup.
- Restore into a new Fly volume (needs her account; designed below, not run).

## Reply to the chief-of-staff
> **Can we restore the app's data if the host dies?** On a scratch copy, yes: backup → delete → restore took
> 1.4 s and every file matched (main @ 8decb27, FICTIONAL data, 31 Oct). On the hosts we have **today, no**:
> the Fly preview keeps `.data/` inside the container with no volume ("a restart re-seeds it"), and nothing is
> backed up. That's fine for a demo (all FICTIONAL), not for a pilot.
>
> **What a pilot on Fly needs (all Aashmiin's actions; I write the files as a PR, she runs the commands):**
> 1. `fly.toml` with a volume: `[mounts] source = "desk_data"`, `destination = "/data"`,
>    `snapshot_retention = 14`; env `DESK_DATA_DIR=/data`; one Machine (bulk jobs live in one process).
>    Create: `fly volumes create desk_data --size 1 -a <app>` [ASSUMPTION on exact flags; region her choice,
>    e.g. sin]. The Dockerfile runs as user `node`, so the mount must be writable by it [ASSUMPTION: not tested].
> 2. Daily Fly snapshots, retention 14 days [VERIFIED: devops-engineer 31 Oct, superfly/docs `volumes/snapshots.mdx`].
> 3. **Off-host encrypted copy** nightly (Fly: snapshots "shouldn't be your primary backup method" [same
>    source]): stop/pause → `tar` → encrypt → her Google Drive. Never in Git, a PR or a Log.
> 4. Monthly drill: restore a snapshot into a **new** volume on a **staging** app
>    (`fly volumes create … --snapshot-id <id>`), same 5 checks as above.
> 5. Decide with crypto-protocol-engineer: keep `xero-tokens.json` out of backups (re-authorise Xero after a
>    restore) or keep it, encrypted only.
>
> **Cost (monthly):**
> | Item | Price | Label | 1 GB pilot |
> |---|---|---|---|
> | Volume | US$0.15/GB provisioned | [VERIFIED: devops-engineer 31 Oct, superfly/docs `about/pricing.mdx`] | US$0.15 |
> | Snapshots | US$0.08/GB, first 10 GB free | [same] | US$0 (demo data is ~150 KB; real size is a GUESS) |
> | Off-host copy on Google Drive | within her quota | [ASSUMPTION] | US$0 |
> | Fly Machine | not checked | [ASSUMPTION] | already paid if the preview runs |
> | **Total added** | | | **~US$0.15/month** + Machine |
>
> Risk Fly itself names: one volume on one Machine = downtime on every deploy and data loss if that host fails
> [VERIFIED: superfly/docs `volumes/overview.mdx`, via devops-engineer 31 Oct], which is why the off-host copy is
> the real backup. **If she says no:** a pilot's data would exist only on one Fly host (or in a container that
> forgets it on restart); a host failure means telling the pilot customer their data is gone.
> Needs her: approve the Fly setup (approval queue) before the first pilot; confirm whether the Fly preview app
> exists and its name.

## WOULD WRITE: Log row
`2026-10-31 14:35 SGT | devops-engineer | Backup drill (scratch) | main 8decb27; backup-20261031.tgz 17,053 B sha256 41ac20c3… | done (scratch): 3 files, 20 requests incl. REQ-1001 DRILL-0001 (FICTIONAL); restore + start 1.4 s; sha256 3/3 OK; empty-dir control lacks DRILL-0001; RPO 0 (server stopped). Live store: none. Fly pilot plan + cost (~US$0.15/mo + Machine) sent to chief-of-staff for the approval queue.`

Cleanup: drill server stopped (port 3471 no answer), scratch worktree removed; the FICTIONAL backup stays in the
session scratchpad only (contains no secrets).
