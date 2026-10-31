# research-intern playbooks

Every playbook starts with **SETUP**: read the "Read first" list in
`.claude/agents/research-intern.md`; check Settings PAUSE (research continues, note it; push no
branches); stop if the Google connection is hatch.sg. Every playbook ends with **LOG** rows
(timestamp SGT, agent `research-intern`, action, ids, details with links).
Global stop conditions: a never-do request (stop that task, `RISK:` row); a secret seen (stop,
don't copy it, `RISK:`); Sheet unreachable (write results to a Drive Doc "Clearline research
<date>" and say so); every source host blocked (deliver nothing as VERIFIED, report it).

---

## P1. Nightly Targets + LinkedIn list + Research watch (00:27 SGT daily)
**Trigger**: scheduled task. **Inputs**: Targets, Leads, LinkedIn list, Do-not-contact, Touches,
Calls; region rotation (nightly list in the definition); `lead-evidence.md`.

Steps
1. Pick tonight's 2–3 regions: next in rotation after last night's Log summary row.
2. **Targets (30–50)**. Per region and segment (PSPs; exchanges/OTC/custodians; Web3 and fintechs;
   global SaaS/online businesses taking USDC/USDT; crypto practices at audit/accounting firms →
   tier Partner; treasury teams holding stablecoins):
   a. search P2 pages first (`site:` + "USDT" / "USDC" / "stablecoin" + pricing/billing/FAQ);
   b. open the page; grade evidence E1–E4 / W1–W3 (`lead-evidence.md`); W-grade → skip or status
      "new" with note "weak evidence";
   c. size: staff count or listing from a page you opened (`size_source`); else "unknown";
   d. trigger (licence, stablecoin launch, funding, finance hiring, audit season) with URL, or "none";
   e. `outreach_rule`: "email OK with opt-out" / "LinkedIn first" (US until POSTAL_ADDRESS; DE, AT,
      IT, ES, NL and other strict-consent) / "intro first";
   f. dedupe by website domain against Targets and Leads; append.
3. **LinkedIn list (≤75)**. For Tier 1 targets (CFO, Financial Controller, Head of Finance/Finance
   Ops, Head of Payments Ops, Head of Treasury, Chief Accountant; founder/CEO at SMBs; crypto-practice
   leads at Partner firms), max 2 per company:
   a. WebSearch `"<company>" CFO OR controller site:linkedin.com/in` — read the **result** only;
   b. include only if the result shows name + role + company + linkedin.com/in URL together;
      never open the profile to collect more;
   c. dedupe by linkedin_url and name+company against the whole tab; skip DNC companies;
   d. write why_them (one line + source URL, labelled) and the facts a note could use (role, recent
      public activity, company evidence), status "to send", day_added, tier. **Leave connection_note
      and followup_dm empty**: revops-crm-agent writes them (research-intern never drafts outreach).
4. Rows with status "accepted" and no DM → "dm ready".
5. **Research watch** (max 5, last 7 days): competitors (launches, pricing, funding) and regulation
   (MAS, MiCA, HK, FCA, US federal/state, India, accounting standards). Each: date, one line,
   link opened, label, "so what" for Clearline.

Checks: every row has evidence_url opened tonight; no mentor/SMU/investor/QRE name (search the
batch against the list); no snippet-only facts marked VERIFIED; counts by region and tier add up.
Output: Targets rows, LinkedIn list rows, Log rows.
Log: `nightly: targets +N (SG a / HK b …; Ent x, Mid y, SMB z, Partner p), linkedin +M, dm ready k`;
`Research watch: 1) … [VERIFIED] <url> …`. Any watch item changing sales claims or email rules →
Risks row + `RISK:` Log line.
Stop: fewer than 10 real targets after a full pass → stop at what you have; never pad.

## P2. Daytime lead research (weekdays 11:13 / 15:13 / 19:13 SGT)
**Trigger**: scheduled task "Clearline lead research". **Inputs**: as P1 plus Settings; the
daytime rotation and segment order (definition); `gtm-os` code.

Steps
1. `git clone --depth 1 -b gtm-os …` (fallback `gtm` branch of closetrace); read RULES.md.
2. Weight toward segments/regions with replies in Touches/Calls this week.
3. Find 20–25 BUYERS: evidence (E1–E4) on a page opened now; **sendable** verified email seen on a
   page (named person or published role inbox; never support@/help@/dpo@/legal@/careers@, never a
   pattern guess) labelled VERIFIED-PUBLIC with URL; contact name/role if shown; first line ≤18
   words, true, last 12 months, with source and date; `check_before_sending` flags.
4. Skip: US/Canada and strict-consent countries (lean mode), government, charities, QRE/QCDAO,
   mentors/SMU/investors/warm network, anything already in Leads/Targets.
5. Save `work/new_leads.csv`, export Leads to `work/leads.csv`, run
   `python3 -m gtm.cli merge --dir work --incoming work/new_leads.csv`; append clean rows only.
Checks: re-read 3 random rows against their pages before appending; every Tier 1/2 row has E1–E3.
Log: one row per lead (`lead added`, evidence URL) + summary `leads run <time>: +N (T1 a, T2 b, T3 c;
by segment …; by region …); unsent T1/2 supply = S`.
Stop / escalate: unsent Tier 1/2 supply < 50 → message-worthy note for chief-of-staff in the Log.

## P3. Lead evidence verification (any lead, on request, or before a lead is queued)
**Trigger**: a new lead; revops/sdr evening re-check; a spot-check failure; a request "is X a fit?".
Steps
1. Open `evidence_url`. Does it still name USDC/USDT **as something they receive**? Quote ≤20 words.
2. Grade E1–E4 / W1–W3. Gateway? Does it settle in crypto or fiat (flag `converts`)?
3. Confirm on the company's own domain if the evidence is a third party.
4. Optional: published receiving address → read-only explorer check against official contracts.
5. Red flags (`lead-evidence.md` §4). Any → tier 3 or drop with reason.
6. Re-check first line fact and date; email still shown on a page.
Output: verdict line `QUALIFIED (E1) / WEAK (W1: directory only) / DROP (reason)` + updated
`check_before_sending`. Log: `evidence check <lead_id>: <verdict> <url>`.

## P4. Weekly "What changed in our market" brief (Sunday 15:47 SGT, PROPOSED)
**Trigger**: schedule (once confirmed) or request. **Inputs**: the week's `Research watch:` Log
rows; competitor/regulation searches for the last 7 days (`funding-news-sources.md`); Calls/Touches
for pipeline signals; last week's brief (for corrections).
Steps
1. Collect candidates dated Mon–Sun of this week. Drop items older than 7 days unless newly
   material (then say "older, newly relevant because …"). Drop duplicates and irrelevant items.
2. Open every source; label; prefer P1/P2; for each item ask "so what for Clearline?" If none, cut it.
3. Rank by impact on: what sales may say, where we may email, who to target, what to build.
4. Write the brief (≤1 page, ≤450 words) in this format:
   ```
   Clearline market brief, week of <Mon date>–<Sun date> (SGT). Sources opened <date>.
   TOP 3 (each: what happened, date, source, label → so what → owner + action)
   REGULATION  (US / EU / HK / SG / India / UK; "no change" is allowed)
   COMPETITORS (launches, pricing, funding; competitors.md: updated / proposed / no change — never "updated" unless you edited it this run)
   MARKET NUMBERS (only if a new measurement; figure, date, measurer, method)
   FUNDING (stablecoin payments/accounting rounds ≥ US$5m; lead investor; why it matters)
   FROM OUR PIPELINE (segments/regions replying, objections heard; n, or "too few to tell")
   WATCHING NEXT WEEK (dated events)
   CORRECTIONS (anything we said earlier that was wrong)
   ```
5. Save as Google Doc "Clearline market brief <date>"; update `competitors.md`/`regulation.md` on
   a branch if facts changed (P5).
Checks: every line that states a fact (including facts reused from the pack) has a label and a source ID;
every item has date + URL; no item without a "so what"; numbers carry method;
nothing stale presented as new; word limit.
Log: `weekly brief <date>: <Doc link>; top3: …`. Regulation change affecting outreach → `RISK:`.

**Call lines and talking points** (any procedure): write them as hedged statements she can say
today ("MiCA covers firms that provide crypto-asset services in the EU; receiving USDT for your own
invoice is generally not one of them, but check with EU counsel"). While customers = 0, never write
"we see…", "our customers…" or anything implying usage data. **Lead scores**: never quote a score you
worked out by hand; quote only what `gtm.cli merge`/`score` produced, or say "score: not run".

## P5. Competitor tracker update (weekly in P4; full re-check monthly)
Steps
1. For each tracked company: search the last 7 days (`"<name>" launch OR pricing OR raises OR
   acquires`) and open its newsroom/pricing page.
2. Changes → edit the row (what they do, who, pricing, latest, sources); keep "was … (until <date>)".
3. New entrant (stablecoin reconciliation, sub-ledger, invoice-led stablecoin AR, gateway adding
   reconciliation) → add to watch list; profile after a second sighting or a ≥US$5m round.
4. Re-assess "Where Clearline differs" only against `CLAIMS_AUDIT.md` product facts.
Output: branch `research/competitors-<YYYYMMDD>`, PR, never merge. Log: `competitors: N changed …`.
Stop: never fill pricing from S3 as fact; "not public" is a valid value.

## P6. Monthly knowledge-pack refresh for all employees (1st of month 09:43 SGT, PROPOSED)
Follow `team/knowledge/research-intern/how-to-maintain-other-packs.md` exactly: inventory →
triage → re-open → correct/promote/stale → branch `research/packs-<YYYYMMDD>` → one PR → Log row per
pack → `RISK:` for anything that changes outward claims → list employees needing eval re-runs.
Start with your own pack's "First refresh to-do" lists.
Log: `pack refresh <Month>: packs N, facts checked a, changed b, stale c, added d, PR <link>`.

## P7. Ad-hoc company/account research for sales (call brief)
**Trigger**: a call on the calendar (ae-assistant/sales-closer-assistant asks), or "research X".
**Inputs**: the lead/target row, Touches, Calls; the company's own site; news (last 12 months).
Steps
1. Check the name against mentors/SMU/investors/warm network/QRE. If matched → stop; tell the
   requester it's not a prospect brief (they just list the meeting).
2. Company: what they do (from their site), size (source), HQ/country, entities/licences (register
   pages), how they receive USDC/USDT (evidence grade, networks, gateway?), accounting system if
   visible (job ads, integrations pages, partner directories), recent news/funding (dated).
3. People: only business role from the company site or a search result (no LinkedIn scraping).
4. Fit: segment, tier, likely pains mapped to Clearline today (wrong network, short payment, no
   reference, fake token, month-end tie-out, getting it into Xero/QuickBooks).
5. Competitor in place? (their site, integrations) → the matching question from `competitors.md`.
6. Questions: the call script's, always including word for word "After a stablecoin payment is
   matched, how does it get into your accounting system today, and how long does that take?"
7. What Strong / Weak / None would sound like for this company.
Format (≤1 page): Snapshot · Evidence they receive stablecoins · Likely pains · Competitors/tools
seen · Regulation context (one line, labelled) · Questions · Strong/Weak/None · Unknowns ·
Sources. Output to the requester's Doc. Log: `call brief <company>: <link>`.

## P8. Fact check on request
**Trigger**: any employee asks "is this true?". Steps: find the original measurement (P1/S2), open
it, compare figure/date/scope; answer `TRUE / TRUE WITH CHANGES (use: "…") / NOT SUPPORTED / FALSE`,
with the source and the exact wording they may use. Never upgrade a label to please the requester.
Log: `fact check for <employee>: <verdict> <url>`.
