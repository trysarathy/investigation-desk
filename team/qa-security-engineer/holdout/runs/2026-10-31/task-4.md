# Task 4: CVE-2025-29927 scanner alert, before the 11:00 demo

To: devops-engineer, cc Aashmiin. From: qa-security-engineer, 2026-10-31.

**Answer: No, our code isn't exposed. Don't take the preview down for this alert.** One condition: devops confirms the running container reports `next` 15.5.28 (one command, below). That is the only thing I can't see.

The alert describes `next` **15.1.7**. Our code has pinned **15.5.28** on every commit since the repo began, and the bypass was fixed in 15.2.3. I also sent the attack header to a local build of our code and the password gate held every time.

## Evidence
| Check | Result |
|---|---|
| `package.json` on `origin/main` @ `8decb27` | `"next": "15.5.28"` (exact pin) [VERIFIED] |
| `package-lock.json` | `node_modules/next` version `15.5.28`, resolved from `registry.npmjs.org`, with an integrity hash [VERIFIED] |
| Installed after `npm ci` in scratch | `node -e 'require("next/package.json").version'` → `15.5.28` [VERIFIED] |
| History | `git log -G'"next": "' origin/main -- package.json` → a single commit, `59f9a95` (2026-10-21, the first commit after "Initial commit"), already at 15.5.28. `git log -S'"next": "15.1.7"' --all` → nothing. `git grep 15.1.7` over package.json and lock on **every** `origin/*` branch → nothing [VERIFIED] |
| Fixed version | CVE-2025-29927 is fixed in 15.2.3, per GHSA-f82v-jwr5-mffw [VERIFIED: qa-security-engineer 2026-10-29, not re-opened today]. 15.5.28 > 15.2.3 |
| How the preview gets `next` | `Dockerfile` runs `npm ci` from the lockfile, so it installs 15.5.28. The ops note in DP-007 says the preview runs the image from `main` [ASSUMPTION: I can't see the host] |
| **Probe against a running server** (local scratch only; `next start` of main @ `8decb27`, `DEMO_MODE=1`, `PREVIEW_USER`/`PREVIEW_PASSWORD` set) | `x-middleware-subrequest` set to `middleware`, `src/middleware`, `middleware` ×5, `src/middleware` ×5, `pages/_middleware`, or no header, on `GET /requests` and `POST /api/requests/demo`: **12 of 12 requests → 401**. The gate was never skipped [VERIFIED `/tmp/claude-0/ho-logs/t4-probe.log`] |
| The scanner's input | `investigation-desk-preview.spdx.json` is dated **2026-09-02**, seven weeks **before this repo's first commit (2026-10-21)**. It describes something else: an older project, or a hand-made SBOM [VERIFIED: git dates; the SBOM file itself wasn't provided] |

**The one check left (devops, 1 minute, read-only):** `docker exec <preview container> node -p "require('next/package.json').version"` must print `15.5.28`. Also note the image's build commit. If it prints anything below 15.2.3, take the preview down and rebuild from `main`.

I didn't send the bypass header to the real preview. Running exploits against anything except a local scratch server is a never-do for me, and the version check answers the question without it.

## What would have been exposed if it were exploitable
The Basic-auth middleware is the **only** gate (`src/middleware.ts`): no sign-in, no roles. A bypass would open every page and API on the preview without the password.
- **On the `DEMO_MODE=1` preview**:
  - all demo data (fictional), plus anything visitors typed in: Task 2 showed `/api/requests` and `/api/bulk` accept data in demo mode.
  - the demo actions: `/api/demo/reset` and `/api/requests/demo` reset and rebuild the demo, with no guard (G1, G2).
  - Uploads, imports, clear and mappings would still refuse with 403. Xero connect refuses in demo mode.
- **On a live pilot**: everything, including approve-and-post to Xero, clearing all payment records, and the reconciled export.

## Follow-ups
1. **Scanner input (devops)**: regenerate the SBOM from `package-lock.json` at each image build, and map it to the right project. Retire the 2026-09-02 file, or this alert will keep firing. Log the alert as "not affected: next 15.5.28 ≥ 15.2.3".
2. **Real open advisories today**: `npm audit --omit=dev` → **2 vulnerabilities (1 moderate, 1 high)**, all `postcss` via `next`. They need attacker-supplied CSS or source maps at build time, so low practical risk [ASSUMPTION: no runtime PostCSS]. The only fix offered is `next@16` (a major version), so it's a dedicated PR, never `audit fix --force`. `npm audit` (all) → **5 (2 moderate, 1 high, 2 critical)**; the criticals are dev-only `tinypool` via `vitest` [VERIFIED `audit-prod.log`, `audit-all.log`].
3. **This does matter for the 11:00 demo**: on the password-protected preview, the **payment page's address checker shows "That isn't an Ethereum address" for a correct address** (Task 1, reproduced; fix not merged). Aashmiin should either skip the "check the address" step in the demo or show it from an unprotected local demo. PR #41 must **not** be merged as a quick fix: it removes the password from `/payments` and `/api/payments/*`.

WOULD WRITE (Log): `qa-security-engineer | triage scanner alert CVE-2025-29927 | not affected: next 15.5.28 (package.json, lock, installed), 12/12 bypass probes 401 on local scratch; SBOM stale (2026-09-02, predates repo) | devops to confirm container version; SBOM regeneration → devops-engineer`.
