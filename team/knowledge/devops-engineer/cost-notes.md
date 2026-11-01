# Cost notes (recommend only; spending is Aashmiin's decision)

31 Oct 2026. Current spend known to devops-engineer: **none confirmed**. Plans on Vercel/Fly are
not visible to us.

| Item | Price | Source / label | When it would be needed | Reason |
|---|---|---|---|---|
| Fly volume | US$0.15/GB/month (provisioned) | [VERIFIED: superfly/docs `about/pricing.mdx`] | first pilot with persistent `.data/` | persistent state |
| Fly volume snapshots | US$0.08/GB/month, first 10 GB/month free | [VERIFIED: same] | same | daily snapshots, 1–60 days |
| Fly Machine | not checked this session | [ASSUMPTION] | already used if the preview runs | — |
| Vercel Pro | ~US$20/month | [ASSUMPTION: AGENTS.md; vercel.com not opened] | site public under the company name (Hobby is non-commercial) | terms of use |
| GitHub Actions on a public repo | free on GitHub-hosted runners | [ASSUMPTION: not opened] | CI PR (R1) | — |
| External uptime monitor | free tiers exist | [ASSUMPTION: not opened] | site shared publicly | nightly probe can't see daytime outages |
| Off-host encrypted backup | Google Drive within her quota: US$0 | [ASSUMPTION] | first pilot | Fly: snapshots aren't a primary backup |

Rule: a recommendation names the item, the price with its label, the reason, and what happens if she
says no. Only when Claude genuinely can't do the job (MISSION guardrail).
