# Claims review: over-promising lines (31 Oct 2026)

Searched every branch (`main`, `ai-team`, `pitch-deck`, `website-fixes`, `whitepaper`, `gtm-os`,
`enterprise-pack`) for "audit-ready", "SOC 2", "compliant", "guarantee", "real-time", "fully
automated", "automatically", "free", "every", "zero", "100%", "trusted", "integrates", "instant" and
similar. Test fixtures, CSS widths and the "don't say this" rules in agent files were excluded.
Truth source: `company/PRODUCT_FACTS.md`. **Nothing outside `ai-team` was changed**; the rewrites
below are proposals for the branch owners (lead-designer for the website, content for the deck) to
apply via PRs once Aashmiin approves.

## A. Real lines that over-promise today

| # | File:line (branch) | Line today | Why it over-promises | True-today rewrite |
|---|---|---|---|---|
| 1 | `website/src/components/Partners.tsx:10` (website-fixes) | "Free during the pilot. No cost, no commitment." | The approved offer is US$300 for 30 days, then US$200/month [VERIFIED: gtm-os `gtm/offer.py` per QA claims audit; `docs/enterprise/OBJECTIONS.md`] | "Founding pilot: US$300 for 30 days, then US$200/month. First 10 businesses. Cancel any time." *(decided 31 Oct; PR #40)* |
| 2 | `website/src/components/HowItWorks.tsx:68` + `website/src/app/demo/page.tsx:9` (website-fixes); `pitch/src/build_deck.py:135`, `build_deck10.py:66`, `build_brief.py:82`, `build_brief6.py:105` (pitch-deck) | "Correct payments tick themselves off." / "Checked and marked paid automatically" | Auto-mark-paid is on **only in demo mode** (`autoMarkPaid: demo`, `src/lib/requests/service.ts:36`); no live address watching yet [VERIFIED: code] | "Correct payments are checked and ready to mark paid in one click, with the reasons written down." (or keep the line but label it "in the demo") |
| 3 | `website/src/components/HowItWorks.tsx:32` | "Every payment explains itself." | Only problems get an explanation, and only on supported chains/pages (payment pages are Ethereum-only) [VERIFIED: PRODUCT_FACTS] | "When a payment is wrong, Clearline says why in plain English." |
| 4 | `website/src/components/Hero.tsx:34` | "every payment matched to its invoice, every problem explained" | "Every" is not true: ambiguous payments go to a person; Tron payment pages aren't built [VERIFIED: docs/SPEC.md "Matching"; PRODUCT_FACTS] | "payments matched to their invoices, wrong ones explained, nothing posted to your books until a person approves." |
| 5 | `website/src/lib/site.ts:13,15` (website-fixes) | "…posts it to your accounting system when you approve." | Only Xero, and Xero is still in testing (no live customer connection yet) [VERIFIED: PRODUCT_FACTS] | "…and, once you approve, prepares the entry for Xero (in testing; QuickBooks next)." |
| 6 | `demo/WHAT_TO_SAY.md` vs `docs/enterprise/OBJECTIONS.md` (main) | "We haven't set pricing" vs "US$300 pilot" | Internal docs contradict each other, so sales can say either [VERIFIED: both files] | One approved line from Aashmiin, used in both |
| 7 | Whitepaper HARD_QUESTIONS vs `docs/enterprise/PILOT_PROPOSAL_TEMPLATE.md` | "connecting a customer's real Xero: not yet" vs a pilot Xero step | A pilot proposal could promise a step the product can't do yet [VERIFIED: both files] | Pilot step: "Xero connection once the live Demo Company test passes; until then, entries exported for you to import." *(her decision)* |

Honest already, no change needed (checked): `docs/enterprise/SECURITY_OVERVIEW.md` ("no SOC 2
report"), `SECURITY_QUESTIONNAIRE.md` A3 ("Not yet"), `ENTERPRISE_ONE_PAGER.md:49` ("no SOC 2, no
penetration test"), `DATA_PROCESSING_TERMS_TEMPLATE.md:52`, `whitepaper/Clearline_Whitepaper.md:150`,
`pitch/TALK_TRACK_5MIN.md:14` ("zero customers"), "Paid in seconds" (labelled general knowledge),
`website/src/components/Sections.tsx:68` ("52 of 52… in our own test", scoped correctly).
`docs/enterprise/PILOT_PROPOSAL_TEMPLATE.md:28` "[100%]" is a target placeholder: keep it bracketed.

### Status, 31 Oct 2026: Aashmiin decided; every row above now has an open PR (none merged)
| # | PR (base branch) |
|---|---|
| 1 Price on website | [#40](https://github.com/trysarathy/investigation-desk/pull/40) (`website-fixes`): Partners perk and FAQ now "Founding pilot: US$300 for 30 days, then US$200/month", first 10 businesses |
| 2 "Tick themselves off" | Website [#40](https://github.com/trysarathy/investigation-desk/pull/40): product-flow copy "ready to mark paid once you approve"; demo captions/alt text kept but labelled "in the demo". Deck/briefs [#41](https://github.com/trysarathy/investigation-desk/pull/41) (`pitch-deck`): cards and talk track rewritten, `.pptx`/`.pdf` regenerated |
| 3 "Every payment explains itself" | [#40](https://github.com/trysarathy/investigation-desk/pull/40) |
| 4 Hero "every payment… every problem" | [#40](https://github.com/trysarathy/investigation-desk/pull/40) |
| 5 site.ts "posts it to your accounting system" | [#40](https://github.com/trysarathy/investigation-desk/pull/40); same line in brief 6 fixed in [#41](https://github.com/trysarathy/investigation-desk/pull/41) |
| 6 WHAT_TO_SAY vs OBJECTIONS pricing | [#43](https://github.com/trysarathy/investigation-desk/pull/43) (`main`, also marks SPEC.md's old US$1,500 pricing superseded) and [#44](https://github.com/trysarathy/investigation-desk/pull/44) (`enterprise-pack`) |
| 7 Pilot Xero step | Decision: Xero-ready import file the customer's accountant reviews and imports; live posting only after sandbox tests pass and she approves. [#44](https://github.com/trysarathy/investigation-desk/pull/44) (proposal, action plan, one-pager, objections, security overview, DPA), [#45](https://github.com/trysarathy/investigation-desk/pull/45) (`whitepaper` HARD_QUESTIONS Q8), [#43](https://github.com/trysarathy/investigation-desk/pull/43) (ACCOUNTING_SYNC, WHAT_TO_SAY) |

## B. The 7 lines from crypto-finance-user's mock call

These were **not Aashmiin's real lines**: the hidden-test examiner wrote them as a FICTIONAL
talk track (`team/crypto-finance-user/holdout/fixtures/h3-founder-pitch-draft.md`). Several echo real
risks above, so the rewrites are kept here as the approved way to say each thing.

| # | Line (fictional test script) | Why it over-promises | True-today rewrite |
|---|---|---|---|
| 1 | "Posts every stablecoin payment to Xero automatically, so your team never touches it." | Posting happens only after a person approves; Xero is in testing (company rule 2 bans this phrase) | "Clearline prepares the Xero entry; it posts only after your approver clicks approve. Xero is in testing on the Demo Company." |
| 2 | "We integrate with Xero, QuickBooks and NetSuite today." | QuickBooks not yet run on a sandbox; NetSuite designed, not built | "Xero first, QuickBooks next. NetSuite is designed, not built, and I won't give you a date." |
| 3 | "Tested on 111 real transactions… every one right, so you'll get zero false alarms." | 111 mixes the tuned set with the held-out set; it tested deposit diagnosis, not invoice matching; "zero for you" is extrapolation | "On 52 real transfers we collected after the last fix, the check was right on all 52. It's a small set and ours, not yours; I'd like to measure it on a month of your payments." |
| 4 | "Our users save about 20 minutes on every exception." | 0 users; 20 min is an unmeasured demo estimate | "We haven't measured time saved yet. How long did your last wrong payment take, start to finish?" |
| 5 | "Enterprise-grade; SOC 2 is in progress." | No SOC 2 engagement exists; no SSO, no pen test | "We're pre-SOC 2: read-only, no custody, no keys, and nothing posts without your approval. Happy to fill in your security questionnaire; SOC 2 comes once paying customers need it." |
| 6 | "Teams like yours tell us this is the biggest headache in their close." | Invented social proof: 0 buyer interviews | Don't claim it. Ask: "When did a payment last arrive wrong, and what did it cost your team?" |
| 7 | "The pilot is free, so there's no risk to you." | Wrong price (US$300) and risk isn't only price | "The founding pilot is US$300 for 30 days. On risk: read-only on-chain, writes only after your approver clicks, and here are our gaps." |

## C. The rule now in revops-crm-agent, sales-closer-assistant and content-marketer
Never use "audit-ready", "SOC 2 (in progress/compliant)", "compliant", "guaranteed", "real-time",
"fully automated", "automatically posts", "every payment", "zero errors/false alarms", "integrates
with X", "trusted by", "free" or any similar claim unless the product does it today **and** a
`[VERIFIED]` source in the repo proves it (`company/PRODUCT_FACTS.md`, the code, or a test). Security
questions are answered from `team/knowledge/security-answers.md` only.
