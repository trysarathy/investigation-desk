# Knowledge pack: qa-security-engineer

Reference material for Clearline's QA and security engineer. Last refreshed **29 Oct 2026** against
`origin/main` @ `fd9b992`, `qa-polish` @ `12abf33`, `enterprise-pack` @ `7c493e3`, `whitepaper`,
`website-fixes` @ `c44edde`. Refresh owner: **qa-security-engineer** (every Sunday review, and the same
night any cited file changes). Labels: [VERIFIED] source opened or command run while writing, with
link/command; [ASSUMPTION] reasonable, not checked; [GUESS] estimate.

| File | Use it for | Refresh when |
|---|---|---|
| `test-map.md` | How to run unit and e2e tests; what each test file covers (per-file counts); the gap list G1–G17 | Any change under `tests/`, `package.json` scripts, or a gap closed |
| `edge-case-catalogue.md` | Payment edge cases E1–E25: expected behaviour, test today (file), proposed test | Change in `src/lib/requests/`, `accounting/rules.ts`, `engine/`, `chain/` |
| `owasp.md` | OWASP Top 10 2021 (+2025 note) and API Security Top 10 2023 mapped to routes and code; route inventory | New/changed route, middleware, upload, export, outbound URL, auth |
| `secrets-and-supply-chain.md` | Grep-based secret scans (tree, history, fixtures), what to do on a find; npm audit results; lockfile and dependency review | Nightly scan results; any `package.json`/lock change; Sunday |
| `security-pack-and-claims.md` | Where the claims audits live, the evidence method, current claim status (FALSE, new findings, re-verified) | Website/whitepaper/deck/film/offer/enterprise-pack change, or a cited file changes |
| `fuzzing.md` | Why and how to add fast-check; probe results; properties P1–P12 | After each property PR |

Our decisions recorded here:
- e2e runs in a scratch export (`git archive`), never the shared worktree (29 Oct).
- `fast-check` is recommended as a dev dependency, not yet added (needs Aashmiin's merge) (29 Oct).
- No paid scanners: grep-based scans now; gitleaks/trufflehog (free, OSS) in CI is devops-engineer's
  call once CI exists (29 Oct).

Network note: on 29 Oct the session could not reach owasp.org, nextjs.org or developer.xero.com
directly; the same documents were read from their official GitHub sources (OWASP, vercel/next.js,
XeroAPI). Ask Aashmiin to allow those hosts if a primary page is ever needed.

Sources opened for this pack (all accessed 2026-10-29): 24 web documents (OWASP x10, Next.js x2, GitHub advisories x3, Xero, gitleaks, trufflehog, npm x2, ethereum.org, TRON, fast-check, vitest) plus npm registry metadata — listed at the bottom of each file.
