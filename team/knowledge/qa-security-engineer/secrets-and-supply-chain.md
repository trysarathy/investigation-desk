# Secrets and supply chain

How to find a leaked secret and a dangerous dependency with the tools this session has (git, grep,
npm), what was found on 29 Oct 2026, and the rules. No paid scanner is needed for a repo this size;
gitleaks and trufflehog are free and open source and can be added to CI later (devops-engineer's call).

## 1. Secret scanning without installing anything (gitleaks/trufflehog-style)

gitleaks is a regex-based detector for "passwords, API keys, and tokens in git repos, files, and
whatever else"; it scans history with `gitleaks git` [VERIFIED, gitleaks README]. trufflehog scans git,
filesystems and more, and can **verify** whether a found credential is live (`--results=verified`)
[VERIFIED, trufflehog README]. **We never verify a credential against its service**: that is using a
secret, and rule 4 says stop and flag. Grep gets us the detection half.

### 1a. Working tree (tracked files) — run on every branch you test
```bash
git grep -nIE \
 'sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|xox[abpr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9a-zA-Z]{24,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.' \
 <ref> -- . ':!package-lock.json'
# Generic assignments with a long literal value:
git grep -nIiE '(api[_-]?key|secret|passw(or)?d|token|client[_-]?secret|refresh[_-]?token)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9_./+=-]{16,}["'"'"']' <ref> -- . ':!package-lock.json'
# Clearline-specific: chain keys in URLs, TronGrid header, Xero env names with values
git grep -nIE 'apikey=[A-Za-z0-9]{20,}|TRON-PRO-API-KEY["'"'"']?\s*[:=]\s*["'"'"'][0-9a-f-]{20,}|XERO_CLIENT_SECRET\s*=\s*\S{8,}|ANTHROPIC_API_KEY\s*=\s*\S{8,}' <ref>
```
### 1b. History (new commits since last night, and a full pass weekly)
```bash
git log <base>..<ref> -p --format='%h %s' | grep -nE '<same patterns>'          # nightly, per PR
git log --all -p -G '<patterns>' --format='%h %an %s'                            # Sunday, all branches
```
A secret deleted in a later commit is **still leaked**: it is in history and in every clone. Removing
it from the tip is not a fix; rotation is.

### 1c. Files that must never be tracked
```bash
git ls-files | grep -E '(^|/)\.env($|\.)|\.data/|xero-tokens|\.pem$|\.key$|\.p12$|id_rsa|\.onnx' | grep -v '^\.env\.example$'
```
### 1d. Recorded fixtures (chain responses keep the request URL)
```bash
grep -rhoE 'apikey=[^&"]*' tests/fixtures demo | sort | uniq -c      # expect only apikey=REDACTED
```
### Findings 29 Oct 2026 (origin/main @ fd9b992) [VERIFIED: commands run]
- 1a: no matches outside `package-lock.json`. 1b: full-history `-G` pass over all branches: no
  matches. 1c: only `.env.example` (empty values) is tracked. 1d: `apikey=REDACTED` × 64, no real key.
- `.gitignore` covers `.env`, `.env.*` (except `.env.example`), `.data/`, `.next`, `out/`, `*.onnx*`;
  `.dockerignore` excludes `.env*`, `.data`, `.git`.
- Code paths: keys read only in `src/lib/chain/live.ts`; Etherscan key stripped from stored URLs
  (`ChainClient.redact`, tested); network errors never echo the request; Xero token errors never
  echo the body.

### When you find one
1. **Stop that task.** Do not copy the value anywhere: not the email, PR, Log, Risks row or chat.
   Refer to it as `<type> at <file>:<line> (commit <sha>)`, value `REDACTED`. If a tool printed it to
   your terminal, do not repeat it.
2. Log `RISK: secret exposed — <type>, <location>, first seen <sha>` and put it first in the email.
3. Recommend: rotate at the provider (Aashmiin or devops does it, not you), then remove from the tip;
   history rewrite only if Aashmiin decides (force-push is a never-do for you).
4. Eval fixtures under `team/evals/` contain **fabricated** look-alike secrets on purpose. If a scanner
   is added, allowlist that path only (gitleaks `.gitleaksignore` / config allowlist), never globally.

## 2. Dependencies (npm)

### Rules
- Install with `npm ci` only: it requires `package-lock.json`, errors instead of updating it when it
  disagrees with `package.json`, and never writes either file [VERIFIED, npm ci docs]. A PR that
  changes `package.json` without the lock (or vice versa) is red.
- `npm audit` reports known advisories; `--audit-level` sets the level that fails the command, useful
  in CI; `npm audit signatures` verifies registry signatures and provenance attestations [VERIFIED,
  npm audit docs]. Run `npm audit --omit=dev` (what ships) and `npm audit` (what runs on our machines
  and CI) separately and report both.
- Never run `npm audit fix --force` on a branch you test: it jumps majors (on 29 Oct it proposed
  `next@16` and `vitest@5`). Upgrades are a PR by crypto-protocol-engineer with the full suite.

### Lockfile hygiene check (29 Oct) [VERIFIED]
- `lockfileVersion` 3, 203 packages, every `resolved` on `registry.npmjs.org`, every entry has
  `integrity`. Install scripts only in `esbuild` and `fsevents` (expected).
- `package.json` pins every direct dependency to an exact version (no `^`, `~`, `*`, `latest`).

### npm audit, 29 Oct 2026 (origin/main @ fd9b992) [VERIFIED: run]
| Scope | Package (via) | Severity | Advisory | Our exposure |
|---|---|---|---|---|
| prod | `postcss` (via `next` 15.5.28) | high (npm's rollup; the XSS item is moderate 6.1) | GHSA-qx2v-qp2m-jg93 (CVE-2026-41305): `</style>` not escaped when stringifying, needs **user-supplied CSS** parsed and embedded [VERIFIED, advisory]; plus 3 source-map file-read advisories (GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849) | Build-time CSS only; we never process untrusted CSS → **low practical risk** [ASSUMPTION: no runtime PostCSS]. Fix arrives with a `next` release that bundles patched postcss; npm offers only `next@16` (major) |
| dev | `tinypool` (via `vitest` 3.2.7) | critical | GHSA-5gmw-xhrv-c9v3 (CVE-2026-104848) prototype-pollution gadget → RCE in worker options; needs a prototype-pollution primitive elsewhere; patched 2.1.1 [VERIFIED, advisory]; also GHSA-85c8-ppgw-ccpr | Test runner only, not shipped. Real but narrow: track; upgrade vitest in a dedicated PR |
| dev | `@vitest/mocker` (via `vitest`) | moderate | GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 | Dev only |
Totals printed: prod 2 vulnerabilities (1 moderate, 1 high); all 5 (2 moderate, 1 high, 2 critical).
Report these as "open, accepted with reason" only after Aashmiin accepts; until then they are open.

### Dependency review checklist (any PR touching `package.json` / lock)
1. Why is it needed; could 20 lines of our code do it? (We avoid deps: 11 runtime deps today.)
2. Exact version pinned; lock updated in the same PR; `npm ci` clean in a scratch copy.
3. Maintainer and activity: last release, open security advisories, weekly downloads (npm page);
   typosquat check (name one letter off a popular package?).
4. Install scripts (`hasInstallScript` in the lock) — new ones need a reason.
5. `npm audit` before/after; new advisories block unless dev-only and explained.
6. Licence compatible (MIT/Apache/BSD/ISC fine; anything else → Aashmiin).
7. Runtime vs dev placement correct (a test library in `dependencies` ships to production).

## Sources (accessed 2026-10-29)
- gitleaks README: https://github.com/gitleaks/gitleaks/blob/master/README.md [VERIFIED]
- trufflehog README: https://github.com/trufflesecurity/trufflehog/blob/main/README.md [VERIFIED]
- npm audit docs: https://github.com/npm/cli/blob/latest/docs/lib/content/commands/npm-audit.md [VERIFIED]
- npm ci docs: https://github.com/npm/cli/blob/latest/docs/lib/content/commands/npm-ci.md [VERIFIED]
- GHSA-qx2v-qp2m-jg93 (postcss): https://github.com/advisories/GHSA-qx2v-qp2m-jg93 [VERIFIED]
- GHSA-5gmw-xhrv-c9v3 (tinypool): https://github.com/advisories/GHSA-5gmw-xhrv-c9v3 [VERIFIED]
- OWASP Secrets Management Cheat Sheet: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Secrets_Management_Cheat_Sheet.md [VERIFIED]
- Other advisory IDs as printed by `npm audit` on 29 Oct (pages not opened) [ASSUMPTION: as printed]
