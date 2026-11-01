# Task 5: Claims-audit check of the draft homepage (content-marketer, 29 Oct 2026)

Copy: `fixtures/task5/website-copy.md` (draft, not yet on a branch, so there's no commit to pin; quoted by section).
Code checked against: `origin/main` @ **fd9b992**, read and run in a scratch worktree tonight.

**Summary: 17 claims → FALSE 10 · yes 4 · yes-with-caveat 1 · unverified 1 · illustrative 1.**
The copy can't go live as written. **Top flag (playbook §5 stop): it names a customer count ("50 finance teams") and customers
("live with customers in Singapore and Hong Kong"), plus a certification ("SOC 2 Type II in
progress"). All FALSE unless Aashmiin confirms in writing, and Clearline has 0 customers.**

## FALSE (first), with true replacement wording

| # | Claim (section) | Verdict | Evidence @ fd9b992 | True replacement |
|---|---|---|---|---|
| 1 | "Trusted by 50 finance teams across Asia." (Hero) | **FALSE** | Company rules: 0 customers. No written confirmation from Aashmiin. Banned (customer count) | Delete. If social proof is needed: "Now taking our first pilot customers." |
| 2 | "Is it live? Yes, with customers in Singapore and Hong Kong." (FAQ) | **FALSE** | 0 customers; "live with customers" is banned (rule 2) | "Clearline is a working product and we're starting our first pilots. Ask us for a demo." |
| 3 | "Clearline watches your wallets in real time" (Hero) | **FALSE** | No polling or address watching: `src/lib/requests/provider.ts` header ("No polling or address watching yet"). Live mode looks up a transaction hash someone supplies | "Clearline checks each payment on-chain, from the transaction your customer sends." |
| 4 | "…and posts to Xero automatically." (Hero) | **FALSE** | Banned wording. Posting needs a person's approval of the exact plan (`api/accounting/[id]` requires actor + plan key; `accounting.test.ts`). Xero is built but has never run against a real organisation (tests mock fetch) | "…and, once you approve, prepares the entry in Xero. Xero first, QuickBooks next." |
| 5 | "matches every USDC and USDT payment to its invoice" (Hero) | **FALSE** ("every") | Matching is by receiving address; several open requests on one address → `ambiguous`, a person decides, never by amount (`requests.test.ts` "two open requests on one address…"); unknown/short/over wait for a person | "matches USDC and USDT payments to their invoices, and asks a person when it isn't sure." |
| 6 | "USDC and USDT, on Ethereum and Tron." (How it works 1) | **FALSE** (Tron) | Payment requests are Ethereum only: `src/lib/requests/types.ts:8` `REQUEST_CHAIN = "ethereum"`. A Tron payment is flagged `wrong_network` (`requests.test.ts` "d. Meridian"). Tron is only in the older deposit-investigation engine | "USDC and USDT on Ethereum. Payments sent on another network, such as Tron, are caught and explained." |
| 7 | "Bank-grade encryption for all your data, at rest and in transit." (Security) | **FALSE** | Banned ("bank-grade", "encrypted at rest"). Data is plain JSON files (`writeAtomic`, `src/lib/lock.ts:29`); tonight a live-mode scratch server wrote `requests.json`/`accounting.json` as `-rw-r--r--`. The app serves HTTP; TLS comes from the host | "Data is sent over HTTPS (provided by the host). Stored data is not encrypted by Clearline today; see our security overview." |
| 8 | "SOC 2 Type II in progress." (Security) | **FALSE** unless Aashmiin confirms in writing | Banned ("SOC 2"); no audit engagement anywhere in the repo or company docs [ASSUMPTION: none exists; certification status is the founder's to confirm] | Delete. Optional: "Security overview and questionnaire answers available on request." |
| 9 | "Tested: 573 automated tests pass on every release." (Security) | **FALSE** | `main` @ fd9b992 tonight: **562 passed, 57 skipped** (619), 3/3 identical [VERIFIED: run this session, task 1]. 573 is the `qa-polish` branch (PR #31, not merged). "Every release": there's no CI/release gate today (pack: CI is "once CI exists") [ASSUMPTION] | "Over 550 automated tests run before every change we merge." Only once that's true in CI. Today: "562 automated tests pass on our main branch (29 Oct 2026)." |
| 10 | "Our AI decides which invoice each payment belongs to." (FAQ) | **FALSE** | Banned ("AI decides"). Attribution is deterministic code (`lifecycle.ts` `attribute`); AI only writes explanation sentences, off by default (`AI_EXPLANATIONS`), validated against evidence (`ai.test.ts`) | "No: fixed rules match each payment, and a person decides when it's unclear. Optional AI only words the explanation, and every number in it is checked against the evidence." |

## Unverified / delivered with our team

| # | Claim | Verdict | Evidence | Wording |
|---|---|---|---|---|
| 11 | "How long does set-up take? About 5 minutes." | **unverified** (likely "delivered with our team") | No timing measured. Set-up needs host deploy, env vars, Xero app credentials and OAuth connect, and a receiving address: devops does that today | "We set it up with you, usually in one call." Or measure it, then state it |

## Yes

| # | Claim | Verdict | Evidence @ fd9b992 |
|---|---|---|---|
| 12 | "Each invoice gets its own page with a QR code." | **yes** | `src/app/pay/[publicId]/page.tsx` (imports `qrcode`); EIP-681 link in base units (`requests.test.ts` "…builds an EIP-681 link in base units"); e2e "b. Brightline … sender" page passed tonight |
| 13 | "Clearline checks the token is the real one from the issuer's own contract, so a counterfeit can't be marked paid by mistake." | **yes** | `lifecycle.ts` `transferIssue` (contract ≠ official → counterfeit/wrong_token, never counts); `accounting/rules.ts` `neverKinds`; tests `requests.test.ts` "c. Orbit…", `accounting.test.ts` "counterfeit: never posted", and tonight's `requests-edge.test.ts` (exact amount + auto-mark on → never paid) [VERIFIED: run] |
| 14 | "Nothing is written to your books until a person approves." | **yes** | `api/accounting/[id]` needs actor + plan key; engine refuses changed plan (`accounting.test.ts` idempotency/plan-key tests). Caveat for the security pack, not the homepage: there is no sign-in, so "a person" means whoever has access |
| 15 | "Read-only: Clearline never holds, moves or has access to your funds, and never asks for wallet keys." | **yes** | No signing/private-key code in `src/` (grep `privateKey|signTransaction|eth_sendRawTransaction|mnemonic`: 0 hits tonight); chain clients are read endpoints only |

## Yes with caveat / illustrative

| # | Claim | Verdict | Note |
|---|---|---|---|
| 16 | "Every posting is kept in an audit log." | **yes, with caveat** | Postings and refusals are appended to `acct.audit` (`accounting/engine.ts:12-16`). It's app-level, not tamper-evident (owasp.md A08). OK on the homepage, but don't let anyone upgrade it to "immutable". |
| 17 | "Stablecoin payments, reconciled for you." (headline) | **illustrative** | Fine as a tagline if the hero line beneath it is fixed (claims 3–5) |

## WOULD WRITE: Log rows (one per FALSE claim, handed to the copy owner)

| agent | action | ids | details |
|---|---|---|---|
| qa-security-engineer | claims check | homepage draft 29 Oct | RISK: FALSE customer claim "Trusted by 50 finance teams" → content-marketer; 0 customers; replacement in task-5 |
| qa-security-engineer | claims check | homepage draft 29 Oct | RISK: FALSE "live, with customers in Singapore and Hong Kong" → content-marketer |
| qa-security-engineer | claims check | homepage draft 29 Oct | RISK: FALSE certification "SOC 2 Type II in progress" → content-marketer; Aashmiin to confirm or delete |
| qa-security-engineer | claims check | homepage draft 29 Oct | FALSE "watches your wallets in real time" (no address watching, provider.ts) → content-marketer |
| qa-security-engineer | claims check | homepage draft 29 Oct | FALSE "posts to Xero automatically" (approval required; banned wording) → content-marketer |
| qa-security-engineer | claims check | homepage draft 29 Oct | FALSE "matches every … payment" (ambiguous waits for a person) → content-marketer |
| qa-security-engineer | claims check | homepage draft 29 Oct | FALSE "on Ethereum and Tron" (requests Ethereum only, types.ts:8) → content-marketer |
| qa-security-engineer | claims check | homepage draft 29 Oct | FALSE "bank-grade encryption … at rest" (plain JSON, 0644) → content-marketer |
| qa-security-engineer | claims check | homepage draft 29 Oct | FALSE "573 tests pass on every release" (main 562 passed/57 skipped tonight; no CI gate) → content-marketer |
| qa-security-engineer | claims check | homepage draft 29 Oct | FALSE "Our AI decides which invoice" (deterministic rules; AI off by default) → content-marketer |

## WOULD SEND: hand-off

**To content-marketer (via Log row + this note):**
> The homepage draft has 10 FALSE claims, so it can't ship as is. Three of them (50 finance teams,
> live with customers in SG/HK, SOC 2 in progress) are the kind that end a fintech's credibility. Each FALSE line in the table has
> exact replacement wording that's true at `main` fd9b992. Please send the revised draft back to me
> before it goes to a branch and I'll re-check it the same night. I haven't edited your copy. Wording
> choices are Aashmiin's.

**Top of tonight's email to Aashmiin:**
```
Claims: FALSE 10 in the homepage relaunch draft (content-marketer, 29 Oct) — incl. "Trusted by 50 finance teams", "live with customers in SG/HK", "SOC 2 Type II in progress", "posts to Xero automatically", "watches your wallets in real time", "573 tests on every release" (main is 562 passed tonight). True wording supplied; copy owner notified; not published. Decision for you: delete SOC 2 line unless you confirm it in writing.
```

## Notes
- The draft isn't on a branch yet, so I pinned the code commit only. When it lands on `website*`
  I'll re-pin and diff against this list.
- Not checked tonight: whether this draft replaces the still-FALSE "Free during the pilot" in
  `Partners.tsx` (pack §A). That's a separate component, not in this draft.
