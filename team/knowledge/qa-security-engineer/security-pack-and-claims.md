# Keeping the security pack and the claims audit honest

Clearline's outward material (website, whitepaper, mentor brief/deck, film, sales offer, enterprise
security pack) makes claims. Company rule 2: claims must match the product today. Your job is the
evidence check: **each claim → the file or test that makes it true, at a pinned commit**, or a
verdict that it isn't. You flag; the copy owner fixes; Aashmiin decides wording.

## Where the audits live (read 29 Oct 2026)
| Document | Branch @ commit | Scope |
|---|---|---|
| `docs/enterprise/CLAIMS_AUDIT.md` | `enterprise-pack` @ `7c493e3` (PR #30) | 41 claims across website (`website-fixes`), mentor brief (`brief-fixes`), film (`demo-video`), GTM offer/call script (closetrace `gtm-fixes`). Verdicts: yes / delivered with our team / roadmap / FALSE. Binding for the whitepaper |
| `docs/enterprise/SECURITY_OVERVIEW.md` | `enterprise-pack` | The security pack's factual core: what Clearline touches, data stored, no sign-in, AI, retention, hosting, known gaps |
| `whitepaper/CLAIMS_AUDIT.md` | `whitepaper` | Market/regulation/competitor claims (M, R, C, S, A, G rows) and product claims P1–P24, live-vs-demo L1–L8, pinned to `main` @ `9af0200`, `qa-polish` @ `12abf33`, `enterprise-pack` @ `7c493e3` |
| Other pack files | `enterprise-pack` | `ARCHITECTURE.md`, `SECURITY_QUESTIONNAIRE.md`, `SUPPORT_AND_UPTIME.md`, `DATA_PROCESSING_TERMS_TEMPLATE.md`, one-pager, objections, ROI, pilot proposal, MAP template |

## Method (playbook §5 runs this)
1. **Pin**: record the commit of every source and of the code you check against
   (`git log -1 --format=%h origin/<branch>`). A verdict without a commit is not a verdict.
2. **Extract** every factual sentence: product capability, number, customer/usage, security property,
   integration status, price/term. Quote it; note file:line.
3. **Classify** the evidence it needs: code path, test name, run log (counts), external source, or
   founder's status (customers, calls). Business terms (price) are checked for *consistency*, not truth.
4. **Verify** at the pinned commit: open the file, run the test, or re-run the count. Use the verdicts
   yes / delivered with our team / roadmap / FALSE (+ unverified when you couldn't check, + illustrative
   for story lines).
5. **Diff** against the last audit: new claims, changed code under a "yes" claim (a "yes" whose cited
   file changed is re-checked, not carried forward), fixes made.
6. **Report** FALSE first with the exact replacement wording that would be true, then "delivered with
   our team" (true only because the founder does a step by hand: must say so), then unverified.
7. Never soften a FALSE because the copy is already published, and never mark "yes" because the claim
   sounds like the product.

Banned regardless of source (company rule 2): "posts to Xero automatically" (true wording: "once you
approve"; Xero built, never run against a real organisation), "live with customers", any customer
count, logo or testimonial (there are 0 customers), "SOC 2", "bank-grade", "audited", "pen-tested",
"encrypted at rest" (Clearline encrypts nothing itself), "real-time monitoring"/"watches your
address" (no address watching), "AI decides" (code decides; AI writes sentences, off by default).

## Current claims and evidence status (re-checked 29 Oct 2026)

### A. Still FALSE in live copy (from the enterprise audit; re-checked on `website-fixes` @ `c44edde`)
| Claim | Where | Status 29 Oct | Evidence |
|---|---|---|---|
| "Free during the pilot. No cost, no commitment." | `website/src/components/Partners.tsx:10` | **still FALSE, unfixed** | Contradicts the US$300/30-day offer (`gtm/offer.py`, enterprise audit #1) |
| "Correct payments tick themselves off." | `website/src/components/HowItWorks.tsx:68`; `demo/page.tsx` caption | **still FALSE outside the demo, unfixed** | `src/lib/requests/service.ts`: `autoMarkPaid: demo`; no address watching (`provider.ts`) |
| "ticks off correct payments automatically" | `website/src/lib/site.ts:13,15` (branch `website` @ `e61f2e5`) | **FALSE outside the demo** | As above |
| Film 1:16 / 1:22 / 1:56, brief step ② | `demo-video`, `brief-fixes` | FALSE per enterprise audit #22, #26–28 | Not re-opened 29 Oct [ASSUMPTION: unchanged] |
| Privacy notice names Vercel; brief links Netlify | website privacy page; brief | unverified (#17) | Needs devops to confirm the live host |

### B. New findings from code on 29 Oct (not in either audit yet)
| Claim | Where | Verdict | Evidence |
|---|---|---|---|
| "Look-alike address warning on the payment page" (website, film 1:06, brief; enterprise #8; whitepaper P4) | multiple | **yes, but broken in the recommended pilot set-up**: with `PREVIEW_USER`/`PREVIEW_PASSWORD` set, `/api/pay/<id>/check` returns 401 (probe) because `middleware.ts` exempts only `/pay/` | `src/middleware.ts`; `AddressChecker.tsx` posts to `/api/pay/…`; SECURITY_OVERVIEW §3 recommends Basic auth for pilots |
| "The customer-facing payment page `/pay/<publicId>` is deliberately outside that gate" | SECURITY_OVERVIEW §3 | **partly FALSE**: the page is; its checker API is not | as above |
| "Reload / Reset demo removes demo records only (`src/lib/demo/reset.ts`)" | SECURITY_OVERVIEW §5 | **FALSE for the deposit workspace**: `resetDemoWorkspace` saves `{ history: [] }` (dropping real Files A/B), loads demo files, deletes `cases.json` and `bulk/`; `/api/demo/reset` has no demo-mode guard. True for payment requests (`resetDemo` keeps non-demo) | `src/lib/demo/reset.ts`, `src/app/api/demo/reset/route.ts` |
| "`DEMO_MODE=1` also refuses uploads and imports" | ARCHITECTURE, SECURITY_OVERVIEW §6 | yes, **only for the exact value `1`**: `DEMO_MODE=on` (the documented default spelling in `mode.ts`) is demo mode but accepts uploads (`demoModeOn` vs `isDemoMode`) | `src/lib/demo/reset.ts` `demoModeOn`, `src/lib/mode.ts` |
| Approval key protects against a changed plan | SECURITY_OVERVIEW §1 | yes; but it is derivable, so it is not a CSRF defence — don't let any doc imply it is | `accounting/rules.ts` `idempotencyKeyFor` |

### C. Re-verified "yes" (sample; the rest stand as in the audits until their cited files change)
| Claim | Evidence 29 Oct |
|---|---|
| 573 tests passing on `qa-polish` @ `12abf33` (whitepaper P18) | Re-run: 573 passed, 57 skipped (630) [VERIFIED] |
| 113/113 e2e checks (P19; "×3" in the QA report) | Re-run once: 113 of 113, exit 0 [VERIFIED once; ×3 not re-run] |
| `main` @ `fd9b992`: 562 passed, 57 skipped | Three identical runs [VERIFIED]. Any doc quoting 573 must say "on the qa-polish branch" until PR #31 merges |
| No reorg handling (P14) | `grep -ri reorg src` empty [VERIFIED] |
| Read-only on-chain, no keys/signing (P1, enterprise #13) | No signing code; chain clients GET/POST read endpoints only [VERIFIED by reading `src/lib/chain/`] |
| Secrets from env only; Etherscan key redacted from stored URLs | `live.ts`, `http.ts` `redact`, fixtures `apikey=REDACTED` ×64 [VERIFIED] |
| Xero built, never run against a real org (enterprise #11, P13) | Tests mock fetch (`accounting.test.ts` "Xero and QuickBooks request shapes") [VERIFIED]; real-org status is founder's status |
| 0 customers | Founder's status; not provable from code — keep labelled so |
| Counterfeit can't be marked paid (enterprise #9) | `transferIssue`, `neverKinds`; tests `requests.test.ts` c. Orbit, `accounting.test.ts` "counterfeit: never posted" [VERIFIED] |
| Xero tokens plain JSON, "default file permissions" | `writeAtomic` passes no mode (`lock.ts`): file mode = 0666 minus umask [ASSUMPTION: typical umask 022 → world-readable 0644] |

### D. Security pack statements to keep true as code changes
Every time one of these files changes, re-check the matching SECURITY_OVERVIEW row:
`src/middleware.ts` (§3), `src/lib/data-dir.ts`/`lock.ts` (§2, §6), `src/lib/accounting/providers/xero-auth.ts`
(§2 token storage, §3 state), `src/lib/ai/*` and `Dockerfile` (§4), `src/lib/demo/reset.ts` and
`src/app/api/payments/clear` (§5), `.env.example`/`src/lib/chain/sources.ts` (§6 public RPCs),
`package.json` (§7 CI/deps).

## Sources
- `origin/enterprise-pack:docs/enterprise/CLAIMS_AUDIT.md`, `SECURITY_OVERVIEW.md`, `ARCHITECTURE.md`;
  `origin/whitepaper:whitepaper/CLAIMS_AUDIT.md`; `origin/website-fixes` and `origin/website` copy;
  product code on `origin/main` @ `fd9b992` — all read 29 Oct 2026 [VERIFIED].
