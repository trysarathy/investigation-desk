# Monitoring and uptime: what can be measured read-only today

31 Oct 2026. Principle (SRE book ch. 4 and 6, [ASSUMPTION: not opened]): measure what a user would
feel, few signals, and say plainly what is not measured.

## Signals available now (no new tools, no secrets)
| # | Signal | How (read-only) | Status 31 Oct |
|---|---|---|---|
| M1 | Deploy state per active branch | `gh api …/commits/<sha>/status` + `/check-runs` | **works** [VERIFIED] |
| M2 | Local build of red branches | scratch export, `npm ci`, `npx next build` | **works** [VERIFIED] |
| M3 | `main` health | M1 on `main` + qa-security-engineer's nightly email | works |
| M4 | Marketing site answers | `curl -sS -o /dev/null -w '%{http_code} %{time_total}' https://clearline-site.vercel.app/` (and her custom domain when set) | **blocked from cloud sessions** (proxy CONNECT 403). Needs the host allowed in Network settings, or a probe from elsewhere |
| M5 | Fly preview answers (expect 401 behind the password = "up") | `curl … https://<app>.fly.dev/` | blocked as M4; app name unconfirmed |
| M6 | TLS certificate days left | `curl -vI` / `openssl s_client` on the domain | blocked as M4 |
| M7 | Dependency/Node drift | `npm outdated`, `npm audit --omit=dev` in scratch | works (registry reachable) |

**Uptime % is not measurable from a nightly check.** One probe a night is a sample, not uptime. The
weekly report says "n of n nightly probes returned 200", never "99.9% uptime".

## Proposed (her approval)
1. Allow `clearline-site.vercel.app`, her domain and `*.fly.dev` in the cloud environment's Network
   settings so M4–M6 run nightly. Cost: US$0.
2. A free external monitor for real uptime (5-minute checks with email alerts) once the site is shared
   publicly. Candidates exist with free tiers (e.g. UptimeRobot, Better Stack) [ASSUMPTION: plans and
   prices not opened this session; quote before asking]. Reason: a 03:27 check can't see an outage at
   14:00.
3. Vercel Analytics on `clearline-site` is already wired (`@vercel/analytics`, enabled by her in the
   dashboard): traffic, not uptime.

## Internal SLOs (no customers, so nothing public)
- Previews of branches she might show: **100% green** at the 03:27 check (metric).
- `main` deploy green every night.
- Marketing site: 200 on every probe (once probes are possible).
- No SLA is offered to anyone. Any SLA/uptime wording in sales material is a claim → qa-security-engineer.
