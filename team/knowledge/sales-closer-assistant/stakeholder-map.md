# Stakeholder map: who buys at a firm that receives stablecoins

Clearline's targets are businesses paid in USDC/USDT (Web3 firms, exporters, agencies, OTC desks, payment
firms) in Singapore/Hong Kong first [ASSUMPTION: whitepaper A6; SPEC "Company type"]. Roles below are our
working map [ASSUMPTION: practitioner judgement, not sourced research; refine from real calls]. The SPEC
names the buyer as "COO, controller or head of payment operations" and the user as "the payment ops
analyst" [VERIFIED: docs/SPEC.md].

| Role | What they own | What they likely care about | MEDDPICC role (typical) | Questions to ask / evidence to bring |
|---|---|---|---|---|
| **Founder / CEO** (firms < 30 people) | Everything; often signs | Time, cash, not looking foolish to customers | Economic Buyer, often Champion | Q7 worth; who else signs; is US$300 a card decision |
| **CFO / Head of Finance** | Close, audit, cash, controls | Clean books, audit trail, fewer surprises at month end | Economic Buyer | Q5 (accounting); what the auditor asks; approval threshold for a vendor |
| **Financial controller / accountant (in-house)** | Posting, reconciliation, month end | How tx hash, fees, short payments are recorded; Xero/QuickBooks fit | Champion (often), Decision Criteria owner | Q5 follow-ups verbatim; walk through a short payment posting; demo the "In your books" plan |
| **Payments ops / finance ops analyst** | Daily matching, customer "where's my payment" tickets | Time per wrong payment, explorer hunting, reply writing | User; Champion candidate; Metrics source | Q3, Q4; how many tickets; demo short payment + unidentified |
| **External accountant / bookkeeper** | Month-end, filings | Evidence per payment, consistency | Partner / influencer (can veto by "too complicated") | Who is their accountant; would they look at the posting audit |
| **External auditor** | Year-end audit | Existence and completeness of receipts, audit trail | Influencer on Decision Criteria (rarely in the deal) | What they asked last year about stablecoin receipts |
| **IT / security** (larger firms) | Vendor security review | Access scopes, data location, SOC 2, sign-in | Decision Criteria / blocker | Send SECURITY_OVERVIEW; state gaps; "not ready" if SOC 2 required |
| **Compliance / MLRO** (payment firms, OTC) | Sanctions, freezes, tipping-off | No "suspicion" language in replies; freeze handling | Influencer / blocker | D09/D14 neutral replies; legal review flagged |
| **Treasury** | Wallets, refunds, conversions | Refund instructions, wrong-network recovery | User of exception outcomes | Who holds keys on other chains (D04) |

**Using the map.**
- In prep, list who's on the invite and which role each most likely plays, marked [ASSUMPTION] until the
  call confirms it. Unknown roles stay Unknown.
- After the call, fill MEDDPICC E (Economic Buyer) and C (Champion) only with what she heard. "Seems like
  the decision maker" is "Partly known: ask 'who else needs to say yes?'".
- Champion test (GitLab): influence, sway on the decision, can remove barriers, puts their credibility on
  the line [VERIFIED: GitLab handbook]. Most first callers are **advocates** until tested.
- Never research or include personal data beyond their public professional role. No LinkedIn scraping:
  she looks people up by hand; the brief can list "Aashmiin: check X's LinkedIn" as a task.
