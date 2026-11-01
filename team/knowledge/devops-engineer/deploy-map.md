# Deploy map: every environment, how it builds, where its config lives

Built 31 Oct 2026 from the real files on `origin/main` @ 8decb27, `origin/website` @ e61f2e5,
`origin/gtm-os` @ 0e5f89c, and the GitHub commit statuses (see `deploy-state-2026-10-31.md`).
[VERIFIED: files read and commands run this session] unless labelled otherwise.

## Summary

| # | Environment | What | Host | Triggered by | Build | Config lives in | Data | Who can change it |
|---|---|---|---|---|---|---|---|---|
| E1 | **Product previews** | the Next.js app (root of the repo) for every pushed branch | Vercel project `investigation-desk`, team scope `sarathyv2` (from status `target_url`) | Every push to any branch (Vercel's GitHub app posts the `Vercel` commit status and the `Vercel Preview Comments` check-run) | Vercel runs the root `next build` (it type-checks the whole repo per `tsconfig.json`) | `package.json`, `next.config.mjs`, `tsconfig.json`; any `vercel.json` on the branch; Vercel project settings (not visible to us) | `.data/` on a serverless filesystem: not persistent [ASSUMPTION: Vercel docs not reachable from this session] | Aashmiin (Vercel dashboard) |
| E2 | **Product "production" on Vercel** | same app, `main` | same project | push/merge to `main` | same | same | same | Aashmiin |
| E3 | **Marketing site (live)** | static site in `website/` | Vercel project `clearline-site` (default URL `https://clearline-site.vercel.app` per `deploy.sh`) | **Manual only**: `bash website/deploy.sh` from Aashmiin's machine. No Git connection, "so nothing goes live by accident" (`website/README.md`) | `cd website && npm ci && next build` → `output: "export"` static files in `website/out/`, copied to `.deploy/clearline-site/`, then `npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"` | `website/next.config.mjs`, `website/package.json`, `website/tsconfig.json`, `investigation-desk/.env` (`VERCEL_TOKEN`, `NEXT_PUBLIC_*`, git-ignored) | none (static) | Aashmiin only (holds the token) |
| E4 | **Private product preview (container)** | the app in demo mode, password-protected | Fly.io app `investigation-desk-preview` **if she ran the README commands** [ASSUMPTION: no `fly.toml` on any branch, and the host could not be probed] | `fly deploy` by hand | `Dockerfile`: `node:22-slim`, `npm ci`, `npm run build`, `npm prune --omit=dev`; runtime `NODE_ENV=production DEMO_MODE=1 AI_EXPLANATIONS=off PORT=3000`, `npx next start -p 3000`, user `node` | `Dockerfile`, `.dockerignore`, `fly secrets` (`PREVIEW_USER`, `PREVIEW_PASSWORD`) | `.data/` **inside the container, no volume**: "a restart re-seeds it, which is fine for a demo" (README "Private preview") | Aashmiin |
| E5 | **Quick tunnel** | the app from her laptop | Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:3000`) | by hand; lives while the command runs | local `npm run build` | her shell env | her laptop's `.data/` | Aashmiin |
| E6 | **GTM code** | `gtm-os` branch | none | — | — | `vercel.json`: `{"git": {"deploymentEnabled": false}, "ignoreCommand": "exit 0"}` | — | — |
| E7 | **CI** | none | GitHub Actions: **0 workflows** [VERIFIED: `gh api .../actions/workflows` → `total_count 0`] | — | — | — | — | — |

## Details that matter when something breaks

**Root app (E1/E2/E4)**
- `package.json` scripts: `dev`, `build` (`next build`), `start`, `test` (`vitest run`), `typecheck`.
  Exact pins: `next 15.5.28`, `react 19.1.10`, `typescript 5.9.3`, `vitest 3.2.7`, `@types/node 22.19.1`.
  No `engines` field, no `.nvmrc` / `.node-version` on any branch → the Node version on Vercel is
  whatever the project setting says (unknown to us); the Dockerfile uses the floating `node:22-slim`.
- `next.config.mjs`: `reactStrictMode`, `experimental.middlewareClientMaxBodySize = 21 MB` (must match
  `REQUEST_MAX_BYTES` in `src/lib/limits.ts`; a test checks it). No `output: "standalone"`.
- `tsconfig.json` on `main`: `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]`,
  `"exclude": ["node_modules"]`. Because `include` is the whole repo, **any sub-project with its own
  dependencies (`website/`, `demo/video/remotion/`) breaks the root build unless excluded**. This is
  the cause of every red preview on 28–31 Oct.
- `.gitignore`: `node_modules`, `.next`, `next-env.d.ts`, `*.tsbuildinfo`, `.env`, `.env.*` (except
  `.env.example`), `.data/`, `*.onnx*`, `website/out/`, `out/`. `.dockerignore`: `node_modules .next .data .env .env.* .git *.tsbuildinfo`.
- Env vars the app reads (names only, from `.env.example`): `TRONGRID_API_KEY`, `ETHERSCAN_API_KEY`,
  `LIVE_LOOKUPS`, `OFFLINE_REPLAY_DIR`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_EXPLANATIONS`, `DEMO_MODE`
  (**on unless set to `off`**), `PREVIEW_USER`, `PREVIEW_PASSWORD`, `NODE_USE_ENV_PROXY`, `DESK_DATA_DIR`.
  Never read or print their values.
- Data directory: `src/lib/data-dir.ts` → `DESK_DATA_DIR || <cwd>/.data`. Files written there (from
  `git grep dataDir()` on `main`): `workspace.json`, `requests.json`, `accounting.json`, `cases.json`,
  `bulk/`, chain response cache (`<sha256>.json`), payments data, and **`xero-tokens.json` (OAuth
  tokens: a secret)**. See `backups.md`.

**Marketing site (E3)**
- `website/next.config.mjs`: `output: "export"`, `trailingSlash: true`, `images.unoptimized`; sets
  `NEXT_PUBLIC_ON_VERCEL` when `VERCEL` or `CLEARLINE_ON_VERCEL` is set (analytics script).
- `website/package.json`: `next 15.5.28`, `@vercel/analytics 2.0.1`, `tailwindcss 4.3.3`.
- `deploy.sh` reads `.env` with `set -a; . "$ENV_FILE"`, never echoes the token, and uses
  `vercel@latest` (unpinned: a supply-chain drift item for the weekly note, see `ci-recommendations.md`).
- **`deploy.sh` is a production deploy.** devops-engineer never runs it, even if a token is present.

**Where `website/` lives**: on `website`, `pitch-deck` and their descendants (`website-fixes`,
`website-books`, `brief-*`), **not on `main`** (merged into `pitch-deck` via PR #22; `pitch-deck` →
`demo-video` (PR #21) → `main` (PR #20) is still open).

## Open questions for Aashmiin (recorded, not blocking)
1. Is the Fly.io preview (E4) actually running, and under which app name? (Needed for the uptime probe.)
2. Which Vercel deployment is "production" for `investigation-desk`, and is it shared with anyone?
3. Is `clearline-site` on a custom domain yet? (`NEXT_PUBLIC_SITE_URL`.)
