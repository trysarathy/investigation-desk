# Maintaining every employee's knowledge pack (monthly refresh)

Last refreshed 2026-10-29 · owner: research-intern · runs: 1st of each month (PROPOSED schedule).

research-intern owns the **external facts** in every pack under `team/knowledge/<name>/`. Each
employee owns its **internal** content (our product, decisions, playbooks, rubrics). You refresh
facts; you never rewrite someone's method, decisions or tone.

## What counts as an external fact
Anything with a URL that isn't Clearline's own repo or Sheet: regulations, standards (EIP/ERC,
accounting standards, API docs such as Xero/QuickBooks), competitor features/prices, market
numbers, best-practice references, people's public roles.

## Procedure (per pack, ~10–20 min each)
1. **Inventory.** `grep -rnE 'https?://' team/knowledge/<name>/` → list every external fact with
   its label and accessed date. Note the pack README's "last refreshed".
2. **Triage.** Order: (a) anything used in outward copy (content, outreach, proposals, website
   claims), (b) regulation and dates, (c) prices and product features, (d) everything else.
3. **Re-check.** Open each source (WebFetch). Outcomes:
   - still true → update accessed date; promote `[ASSUMPTION: search]` to `[VERIFIED]`;
   - changed → correct the fact, keep the old value in a one-line "was … (until <date>)" note;
   - source gone → find a replacement of equal or higher tier, or label down to `[ASSUMPTION]`
     and mark `STALE`;
   - can't open (host blocked) → leave the label, add `STALE (host blocked <date>)`.
4. **Add** what's new since last month from your weekly briefs (only items relevant to that
   employee's job).
5. **Write** the changes on a branch `research/packs-<YYYYMMDD>` (never `main`), one commit per
   pack, author per company code rules; open one PR "Monthly knowledge-pack refresh <Month>" listing
   per pack: facts checked / changed / stale / added. Never merge. If you cannot push, write the
   same list to a Google Doc "Clearline pack refresh <Month>" and link it in the Log.
6. **Tell the owners.** One Log row per pack changed: `pack refresh <name>: N checked, N changed,
   N stale, PR <link>`. A changed fact that alters what sales/content may say → also a Risks row
   and a `RISK:` Log line so chief-of-staff leads the briefing with it.
7. **Evals.** BUILD_STANDARD says golden tasks re-run after any pack change: list the employees whose
   packs changed materially in the PR description so chief-of-staff schedules their re-runs.

## Pack map: what to check for each employee (from `team/MISSION.md`)
| Employee | External facts most likely in its pack | Check especially |
|---|---|---|
| crypto-protocol-engineer | Token contracts per chain, EIP-681/ERC-7699, Solana Pay, finality, explorer/RPC API limits, freeze functions | Contract addresses on Circle/Tether pages; API deprecations (Etherscan V2, TronGrid) |
| qa-security-engineer | OWASP, dependency advisories, address-poisoning research, SOC 2 basics | New CVEs for dependencies; scam patterns |
| devops-engineer | Vercel plans/limits, Node LTS dates, GitHub Actions changes | Pricing/plan terms (Hobby non-commercial) |
| crypto-finance-user | How finance teams book stablecoins: IFRS/US GAAP, FASB ASU status, Xero/QuickBooks features, SG GST | FASB stablecoin cash-equivalent proposal status; IRAS |
| product-manager | Competitor features, customer pain evidence, provider report formats (e.g. BVNK) | `competitors.md` deltas |
| delivery-specialist | Xero/QuickBooks import formats, month-end close practice | Accounting API changes (Xero granular scopes) |
| lead-designer | Accessibility (WCAG), brand-claim rules | Low churn; quarterly is fine |
| content-and-video-producer | Market numbers, regulation lines used in posts, platform rules | Every number in a draft must trace to `market.md`/`regulation.md` |
| research-intern (self) | This pack | All files |
| gtm-strategist | ICP segments, competitor pricing, market size, channel benchmarks | Pricing pages; market numbers |
| revops-crm-agent | Email/anti-spam rules (SG Spam Control Act bulk line, CAN-SPAM postal address, EU consent countries), Gmail sending limits | Any change to sending rules → `RISK:` |
| sales-closer-assistant | Competitor battlecards, objection facts, enterprise security norms | `competitors.md`; regulation one-liners |
| chief-of-staff | Low external content; regulation calendar | Key dates table |
| finance-admin | SG GST/invoicing rules, India GST LUT/FIRA, payment-provider fees | IRAS, CBIC, provider fee pages; flag CA review |

If an employee's pack doesn't exist yet, skip it and note "no pack yet" in the PR.

## Quality checks before opening the PR
- No fact without URL + accessed date + label. No invented replacement sources.
- No change to another employee's playbook, rubric, decisions or never-do list.
- Diff is small and readable; each pack's README "last refreshed" date updated.
- Anything about mentors, QRE/QCDAO, secrets: never added to any pack.
