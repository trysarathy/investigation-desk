# Context (FICTIONAL)
- main @ 9e8d7c6 (merged 3 Nov 23:40 SGT, PR #44 "Requests: grouping by customer"). Vercel status on main: success 3 Nov 23:42.
- Previous main deployment: dpl_FICTIONALgood43 at commit 5f4e3d2 (PR #43), success 2 Nov 21:10; no reports of errors.
- Branch hotfix/requests-500 @ 1a2b3c4 (by crypto-protocol-engineer, 4 Nov 02:15): one commit, "Guard empty customer group"; Vercel preview success 4 Nov 02:17; PR #45 hotfix/requests-500 → main open, qa-security-engineer has NOT run on it yet.
- Local repro you ran at 08:01: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/requests` on a scratch build of 9e8d7c6 with the demo day loaded → 500; same on 1a2b3c4 → 200. `npx vitest run` on 1a2b3c4: 571 passed, 57 skipped, 0 failed.
