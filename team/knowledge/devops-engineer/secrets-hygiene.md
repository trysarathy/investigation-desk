# Secrets hygiene (devops view)

Complements `team/knowledge/qa-security-engineer/secrets-and-supply-chain.md` (the scan commands).
31 Oct 2026.

## Where secrets live (names only; never values)
| Secret | Where | Owner | Used by |
|---|---|---|---|
| `VERCEL_TOKEN` | `investigation-desk/.env` on her laptop (git-ignored) | Aashmiin | `website/deploy.sh` (prod deploy) |
| `TRONGRID_API_KEY`, `ETHERSCAN_API_KEY` | `.env` / host env; optional | Aashmiin | `src/lib/chain/live.ts` |
| `ANTHROPIC_API_KEY` | `.env`; optional; unset on previews | Aashmiin | explanations |
| `PREVIEW_USER` / `PREVIEW_PASSWORD` | `fly secrets` | Aashmiin | Basic auth on the preview |
| Xero OAuth tokens | `.data/xero-tokens.json` at runtime | the app | accounting sync |
| `NEXT_PUBLIC_*` (website) | `.env` | Aashmiin | **public by design** (inlined into the static site): never put a secret in a `NEXT_PUBLIC_` var |

## Rules for devops-engineer
1. **Never hold, use, echo or store a token**, even one pasted into a task or chat "to save time".
   Don't run a command with it, don't put it in a file, don't repeat it in the reply (not even the
   first characters). Reply: "A token was pasted in this message. I didn't use it. Please revoke it at
   <provider page> and make a new one; then set the variable yourself in <click path>."
   A pasted token is exposed: treat it as compromised (log `RISK:`; she rotates).
2. Env var and secret changes in Vercel/Fly/GitHub are **her** actions. devops-engineer writes the
   exact click path and the variable **name**, never the value.
3. Printing env: never `env`, `printenv`, `set`, `cat .env`, `vercel env pull`, `fly secrets list`
   output beyond names. To check presence: `[ -n "${VAR:-}" ] && echo "VAR is set"`.
4. Logs and PR bodies: redact anything matching the qa scan patterns; deployment ids (`dpl_…`) and
   commit shas are not secrets.
5. The repo is **public**: anything committed is published. 12-factor litmus test: "could the codebase
   be made open source at any moment, without compromising any credentials" [VERIFIED: heroku/12factor
   `config.md`] — here it already is.
6. CI (when added): no secrets in the workflow at all; `permissions: contents: read`; actions pinned
   by SHA (tj-actions lesson, `benchmark.md` Teardown B).
7. Backups containing `xero-tokens.json` are secrets at rest: encrypted only (`backups.md`).
