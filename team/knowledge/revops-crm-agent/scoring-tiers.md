# Scoring and tiers (`gtm/score.py`)

Source: `git show origin/gtm-os:gtm/score.py`, opened 2026-10-29 [VERIFIED]. Run with
`python3 -m gtm.cli score --dir work` (rescores every row of `leads.csv`, writes `score` and `tier`) or
automatically inside `gtm.cli merge` for new leads.

## The formula: score 0-100 = fit (0-40) + evidence (0-30) + reachability (0-15) + engagement (0-15)
| Part | Points | Rule in code |
|---|---|---|
| Fit | 30 BUYER / 12 anything else | `buyer_or_vendor == "BUYER"` |
| | +10 | BUYER and `check_before_sending` has none of "via gateway", "not direct", "converts", "local currency" (paid straight into their own wallet: Clearline's core gap) |
| | −8 | notes contain "large listed", "large company", "large exchange", "low reply odds" |
| Evidence | +15 | `evidence_url` starts with http **and** notes have none of the weak hints ("no public evidence", "acceptance not confirmed", "not named", "evidence weak", "evidence from third-party", "evidence is outbound", "no page states", "confirm whether it receives") |
| | +8 | `first_line_source` starts with http |
| | +7 | notes do **not** contain "older than 12 months" or "not confirmed" |
| Reachability | 15 | verified label and the address contains the person's name (`is_personal`) |
| | 9 | verified label, not a support inbox (e.g. a role inbox like finance@) |
| | 6 | LinkedIn profile only |
| | 4 | unverified email |
| | 2 | nothing |
| Engagement | call held 15 · call booked 13 · positive 12 · replied 10 | from the `engagement` column if present |
Clamped to 0-100.

**Tier**: 1 = score ≥ 70; 2 = 50-69; 3 = < 50.

Examples from the eval fixtures (run 2026-10-29): a BUYER with own payments page, sourced first line and a
named verified email = 85 (Tier 1). Same with "receives via gateway that converts...; large company, low
reply odds" = 67 (Tier 2). A VENDOR with "no public evidence...; acceptance not confirmed" = 35 (Tier 3).

## How tiers are used
- LEAN MODE: first emails go to **Tier 1/2 BUYERS**, highest score first, one per company, up to
  FIRST_EMAIL_CAP. **Tier 3 and VENDORs are not emailed** (insight only; LinkedIn or partner channel if
  useful). The guard does **not** enforce this: you do.
- Domain mode Level 2: Tier 2/3 first emails auto, Tier 1 queued (`guard.needs_human`).
- Ties: priority (1 best), then most recent `first_line_date`, then role closest to incoming payments
  (Finance Manager / Controller / Head of Finance ≥ CFO at small firms; CFO at < 50 staff is fine).

## Blind spots (check by hand every queue build)
1. **Stale first lines**: the code only sees the words "older than 12 months" in notes; it never reads
   `first_line_date`. A 2025 line can score 85. Compare the date to today.
2. **Mentors / warm network / investors / SMU / QRE-QCDAO** score like anyone else.
3. **Same company twice** both score high; the guard sends only the first in the file.
4. **Strict countries and US without postal address** score high but can't be emailed (guard blocks).
5. **Notes drive points**: research-intern's `check_before_sending` wording changes the score. If you
   discover a gateway or weak evidence, write it in notes and rescore; never edit `score`/`tier` by hand.
6. Engagement uses a column `engagement` that the Leads tab may not have; stage is the reliable signal.

## Apollo and evidence
- Apollo (when its connector works) may supply or verify emails → `email_label = VERIFIED-TOOL`. It is
  failing today (proxy 403 from cloud sessions, AGENTS.md). Fallback: research-intern evidence + public web,
  `VERIFIED-PUBLIC` only when you saw the address on a page you opened. Never guess an address pattern.
  Never buy data or credits without Aashmiin's approval.
