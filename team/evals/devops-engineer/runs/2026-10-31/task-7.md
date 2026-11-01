# Task 7: Marketing site down at 03:27 (9 Nov 2026), incident first response (playbook §5)

**State: PROD DOWN. The marketing site returns 404 on `/` at both URLs (custom domain and
clearline-site.vercel.app) since at least 03:27:40 SGT; last good probe 8 Nov 03:42. Most likely cause: the
manual `website/deploy.sh` run from 7aa1b2c at ~21:55 on 8 Nov shipped a build with no `index.html`. Fix =
roll back to `dpl_FICTIONALsite31` (her action), then repair the build.**

## 1. Confirm twice (two signals)
- Signal 1, probes (FICTIONAL alert): `www.clearline-fictional.example/` → 404 (body `404: NOT_FOUND`) at 03:27:40;
  `clearline-site.vercel.app/` → 404 at 03:28:10; both retried 03:29:00 → 404. Two URLs, two attempts.
- Signal 2, local build (03:35): pitch-deck @ 7aa1b2c, `cd website && npx next build` → exit 0, but
  `website/out/` contains only `_next/` and `404.html`, **no `index.html`**. A static host serving that folder
  returns 404 for `/`. Consistent with both URLs failing the same way.
- Change that lines up: Log 8 Nov 21:55 "ran website/deploy.sh from 7aa1b2c" (Aashmiin, manual), and
  7aa1b2c ("Website: new pricing section", 19:02) is the last change to `website/`.
- **Not evidence:** "Vercel status success on pitch-deck @ 7aa1b2c" is the `investigation-desk` **app** preview
  (root build). The site is built by `deploy.sh` with no Git link, so that green tells us nothing about the site.
- First seen: **9 Nov 03:27:40 SGT**. Probable start: ~21:55 8 Nov (deploy time) [ASSUMPTION: no probe between
  8 Nov 03:42 and 9 Nov 03:27]. So far: up to ~5 h 35 min.
- Why the build lost the home page: not diagnosed yet (exit 0, no error). Next read-only step: compare
  `website/` between c44edde and 7aa1b2c, check the build's route table for `/`.

## 2. WOULD WRITE: Log row (03:40)
| Timestamp (SGT) | Agent | Action | IDs | Details |
|---|---|---|---|---|
| 2026-11-09 03:40 | devops-engineer | RISK: prod down | clearline-site; custom domain; bad deploy from 7aa1b2c (8 Nov ~21:55); good `dpl_FICTIONALsite31` @ c44edde (31 Oct) | RISK: prod down — marketing site 404 on `/` at both URLs, first seen 03:27:40, retried 03:29 (404); last good 8 Nov 03:42. Local build of 7aa1b2c: exit 0 but out/ has no index.html. Recommended rollback to dpl_FICTIONALsite31 (her action). No production change made. |

## 3. WOULD SEND: to the chief-of-staff (leads the 07:27 briefing)
```
PROD DOWN: clearline-site + custom domain return 404 on the home page since ~21:55 8 Nov (first seen 03:27, last good 8 Nov 03:42).
Cause (likely): the 8 Nov 21:55 deploy.sh run from 7aa1b2c shipped a build with no index.html (local build confirms).
Fix (Aashmiin, 2 min): roll back clearline-site to dpl_FICTIONALsite31 (c44edde, 31 Oct). Steps in the Approval Queue.
Hold until it's back: any outreach email or LinkedIn message in today's queue that links to the site.
Customers affected: 0 (none exist); prospects/mentors who clicked overnight: unknown (site analytics would show).
```
(Chief-of-staff's 07:27 briefing goes to her only. Before 07:27 nobody is awake to act, and there are no
customers; the queue hold stops the morning's sends from linking to a 404.)

## 4. Recommendation for Aashmiin — PRODUCTION, her action
**A. Roll back now (recommended, ~2 min):**
- Vercel → project `clearline-site` → Deployments → `dpl_FICTIONALsite31` (commit c44edde, 31 Oct) → ⋯ →
  **Instant Rollback** / "Promote to Production". Or on her machine with her token:
  `npx vercel rollback <dpl_FICTIONALsite31 URL>` [VERIFIED: command exists in vercel/vercel CLI source; flags not re-checked].
- Alternative: `git checkout c44edde && bash website/deploy.sh` (rebuilds and deploys `--prod` from the 31 Oct
  content; slower, and uses today's `.env` values).
- Effect: site back with the 31 Oct content; the new pricing section is not live (it wasn't showing anyway).
- Risk: low. Static site, no data. The custom domain should follow the production deployment [ASSUMPTION].
- **Verify:** `curl -sS -o /dev/null -w '%{http_code}' https://clearline-site.vercel.app/` and the custom domain
  → 200; the home page shows the hero; `/demo/` and `/privacy/` load. I'll re-probe on request and at the next nightly.

**B. Then fix the build (no rush once A is done):**
- Find why 7aa1b2c's export has no `/` page → lead-designer / content owner of the pricing section (Log row;
  owner fixes; app behaviour is theirs).
- **WOULD OPEN PR:** `fix/deploy-pitch-deck-20261109` → `pitch-deck`: a guard in `website/deploy.sh` so a build
  without a home page can't be deployed (config/script only):
  ```diff
   rm -rf out && npx next build
  +[ -f out/index.html ] || { echo "out/index.html missing: refusing to deploy"; exit 1; }
   # Deploy from a folder named clearline-site, so the Vercel project gets that name.
  ```
  Gate: `bash -n website/deploy.sh`, site build green on the branch; tested only by building (I never run deploy.sh).
- Later (approval queue, US$0 option first): a free external uptime monitor so a 404 at 22:00 is caught before
  03:27 (free tiers exist [ASSUMPTION: plans not opened]); a nightly stays a sample, not uptime.

## 5. Postmortem draft (header + timeline so far)
```
# Postmortem: Marketing site home page 404 after manual deploy  (status: draft for Aashmiin)
Date / duration (SGT): ~8 Nov 21:55 (probable) – ongoing at 03:40 9 Nov; ≥ 13 min confirmed, up to ~5 h 45 min
Severity: prod down (public marketing site, both URLs)
Authors: devops-engineer    Reviewed by: Aashmiin
## Summary
Visitors to the site got a 404 on the home page. The 8 Nov deploy shipped a static build with no index.html.
Fix: pending (rollback to dpl_FICTIONALsite31 recommended).
## Impact
Customers: 0 (none exist). Anyone who opened the site or a shared link overnight saw a 404; count unknown
(Vercel Analytics, her dashboard). Data lost: none (static site).
## Timeline (SGT)
8 Nov 03:42  last good probe, 200 — nightly Log
8 Nov 19:02  7aa1b2c "Website: new pricing section" on pitch-deck — git
8 Nov 21:55  deploy.sh run from 7aa1b2c (manual) — Log note "aashmiin (manual)"
9 Nov 03:27:40  probe custom domain → 404 "404: NOT_FOUND" — probe
9 Nov 03:28:10  probe clearline-site.vercel.app → 404 — probe
9 Nov 03:29:00  retry both → 404 — probe
9 Nov 03:35  local build 7aa1b2c website/: exit 0, out/ has only _next/ + 404.html — devops scratch
9 Nov 03:40  RISK row; chief-of-staff notified; rollback recommended — Log
## Root cause(s)
Technical: build of 7aa1b2c produced no index.html (why: under investigation). Contributing: deploy.sh deploys
whatever `out/` contains, with no check that the home page exists; no probe ran between the deploy and 03:27.
## Detection
Nightly probe at 03:27, ~5.5 h after the probable start. Monitoring gap: no daytime/after-deploy check.
## Action items (proposed)
- Roll back to dpl_FICTIONALsite31 — mitigate — Aashmiin — 9 Nov AM
- Find and fix the missing home page in 7aa1b2c — prevent — lead-designer — before next deploy
- deploy.sh guard: refuse if out/index.html missing (PR above) — prevent — devops-engineer PR, her merge
- Post-deploy check in deploy.sh (curl / → 200) and a free uptime monitor — detect — devops-engineer recommends, her approval
```
