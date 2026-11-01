# Public-repo dependency check: what breaks if trysarathy/investigation-desk goes private?

Checked by devops-engineer, 2026-10-31 (SGT ~03:00 Nov 1 / UTC 18:55-19:10 Oct 31). Read-only.
Repo state now: `public`, owner `trysarathy` is a **User** account (not an org), 0 forks, 0 stars,
0 watchers, GitHub Pages off [VERIFIED: devops-engineer 2026-10-31, `gh api repos/trysarathy/investigation-desk`].
vercel.com and docs.github.com were refused by this session's proxy (HTTP 403), so every plan/pricing
fact below is [ASSUMPTION], not opened.

## Verdict (short)
| Area | Breaks if private? | Label |
|---|---|---|
| Mentor Brief 6 QR code + slide text | **YES**: the QR opens a GitHub blob URL; anyone without repo access gets a 404 | [VERIFIED: devops-engineer 2026-10-31, QR decoded] |
| Vercel previews (`investigation-desk`, scope `sarathyv2`) | Probably not for builds; **risk** on Hobby (commit-author rule, commercial use) | [ASSUMPTION] |
| Website `clearline-site` | No: deployed manually by `website/deploy.sh`, no Git link | [ASSUMPTION: deploy-map E3, devops-engineer 2026-10-31] |
| GitHub Actions CI (#42) | No for function; starts using the free private-minutes quota | [ASSUMPTION] |
| Clearline scheduled tasks (`git clone https://github.com/...`) | Anonymous clone would fail; tasks that call `add_repo` first should keep working | [ASSUMPTION] |
| Images/files served from GitHub on the website, deck, whitepaper, README | None found (other than the QR above) | [VERIFIED: devops-engineer 2026-10-31, git grep] |
| Outside users (forks, stars, watchers) | Nobody: 0 / 0 / 0 | [VERIFIED: devops-engineer 2026-10-31, gh api] |

## Evidence

### 1. Deck / brief links to GitHub (breaks)
- `pitch/assets/illus/demo_qr.png` on `pitch-deck` decodes to
  `https://github.com/trysarathy/investigation-desk/blob/pitch-deck/pitch/demo_live_60s.mp4`
  [VERIFIED: devops-engineer 2026-10-31, decoded with jsQR 1.4.0 in scratch]. It is placed on slide 4 of
  Mentor Brief 6 (`pitch/src/build_brief6.py:128`), and the slide notes (line 100, also on
  `website-fixes`) print `github.com/trysarathy/investigation-desk, pitch/demo_live_60s.mp4`.
- Already sent PDFs/PPTX keep the old QR: if the repo goes private, every mentor who scans it gets
  GitHub's 404. (It also breaks if `pitch-deck` is merged and deleted: `pitch/MENTOR_BRIEF_6_NOTE.md:40`.)
- Fix before going private: host the 60 s video somewhere public (e.g. the website's `/film` asset,
  `website/README.md:60` says a 2.5 MB copy exists) and regenerate the QR. Her decision.
- `git grep` of `origin/main`, `origin/website-fixes`, `origin/pitch-deck`, `origin/whitepaper`,
  `origin/gtm-os` for `github.com/trysarathy`, `raw.githubusercontent`, `githubusercontent.com`,
  `/blob/`, `/raw/`, `github.io`: other hits are internal agent docs and eval fixtures (agents reach the
  repo with credentials) and npm `funding` URLs in lockfiles (other people's repos, unaffected).
  `gtm-os` references a different repo, `trysarathy/clearline-gtm` (not checked here).
  No website page, README, whitepaper or doc embeds an image or file from this repo's GitHub URLs.

### 2. Vercel
- Vercel's GitHub app posts statuses on every branch: `main` 8decb27 `Vercel success`
  (2026-10-31T04:38Z), `pitch-deck` 48fcecc success, `whitepaper` 827a0ec success, `website-fixes`
  c44edde failure; plus the `Vercel Preview Comments` check-run
  [VERIFIED: devops-engineer 2026-10-31, `gh api .../commits/<sha>/status` + `/check-runs`]. Project
  `investigation-desk`, scope `sarathyv2` (from `target_url`).
- Vercel's plan for `sarathyv2` is unknown (no Vercel access) [ASSUMPTION].
- Hobby and private repos [ASSUMPTION: from memory, vercel.com not opened]: Hobby can deploy private
  repos from a **personal** GitHub account (this one is a User account, so allowed); private repos
  owned by a GitHub **org** need Pro. On Hobby, deployments of a private repo can be blocked when the
  commit author is not the Vercel account owner. All commits are authored as Aashmiin Kaur; whether her
  GitHub login is the one linked to `sarathyv2` is unknown, so check one preview after switching.
  Separately, Hobby is for non-commercial use (cost-notes.md: Pro ~US$20/month [ASSUMPTION]).
- Preview URLs themselves stay reachable; going private only changes who can see the code.

### 3. GitHub Actions minutes
- Public repos: Actions on standard runners free. Private repos on GitHub Free: about 2,000
  minutes/month included, per-job rounding up to the minute [ASSUMPTION: docs.github.com refused].
- First CI run (#42, run 41231715977): job `ci` 66 s, job `lint` 33 s, run 70 s
  [VERIFIED: devops-engineer 2026-10-31, `gh api .../runs/41231715977/jobs`] -> about 3 billed minutes
  per run if private. Activity: 44 PRs created and 66 commits on `main` in the last 14 days, so
  roughly 100-300 runs/month -> 300-900 min/month [GUESS]: inside the free quota, but nightly agents
  pushing many branches could push it up. At 0 minutes left, private-repo workflows stop running
  (the `ci` required check would then block merges).

### 4. Clearline scheduled tasks
- Every scheduled task listed (nightly build, QA, deploy check, weekly reports, design review, sales
  prep, research) runs `add_repo trysarathy/investigation-desk` and then
  `git clone https://github.com/trysarathy/investigation-desk` with no credentials in the URL
  [VERIFIED: devops-engineer 2026-10-31, list_triggers].
- Anonymous clone of a private repo fails (GitHub answers 404/auth required) [ASSUMPTION: standard
  GitHub behaviour]. In these cloud sessions the git proxy adds credentials for repos attached by
  `add_repo`, so tasks that call it first should keep working [ASSUMPTION: not tested against a private
  repo]. For a public repo `add_repo` with read access can answer "already available, nothing to
  attach"; once private it must really attach, which needs the Claude GitHub app to cover the repo.
  Tasks that ask for read only (e.g. research brief, sales prep, market brief) are the ones to watch.
  Test: after switching, fire one read-only task and check the clone succeeds.

### 5. Other things that do not depend on public access
- Fly preview (`investigation-desk-preview`, if it exists) is deployed from her machine per README
  [ASSUMPTION: deploy-map E4].
- `clearline-site` (live website) deploys by `website/deploy.sh` from her machine [ASSUMPTION: deploy-map E3].
- No Dependabot/badges/Pages in use found.

## If she decides to go private: order of steps
1. Re-host the 60 s video and regenerate the Mentor Brief 6 QR; tell mentors who have the old PDF.
2. Check the Vercel plan/author rule (one push to a preview branch, see the `Vercel` status).
3. Switch to private; fire one read-only scheduled task to confirm `add_repo` + clone work.
4. Watch Actions minutes in Settings -> Billing after a week.
