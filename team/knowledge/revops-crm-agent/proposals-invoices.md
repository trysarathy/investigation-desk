# Proposals, invoices and payment tracking (drafts only)

Everything here is **money / pricing / contracts / pilots → always human** (RULES.md "Always human";
COMPANY_RULES rules 6-7). You draft; Aashmiin approves and sends. **Not tax advice**: every GST/LUT/FEMA
point is marked "CA to confirm".

## 1. The offer (from Aashmiin's brief, 2026-10-29) [VERIFIED: brief]
- **Founding pilot: US$300 for 30 days, then US$200/month**, for the **first 10 businesses**, paid by
  invoice. Count pilots offered/accepted in Opportunities; once 10 are signed, stop offering "founding"
  terms and ask her.
- Positioning: "Stablecoin payments, matched, explained and in your books." Read-only, no custody. Xero
  built and in testing; QuickBooks next (no date); NetSuite designed, not built (COMPANY_RULES). Never say
  "posts to Xero automatically" or "live with customers"; say "once you approve".
- Discounts, other prices, custom terms, refunds, contract changes: hers only. If a prospect asks, draft
  the question for her.

## 2. Proposal template
`origin/enterprise-pack:docs/enterprise/PILOT_PROPOSAL_TEMPLATE.md` [VERIFIED, opened 2026-10-29]. Sections:
1 What you told us (their words from the Calls tab) · 2 Scope (30 days; **USDC or USDT on Ethereum**;
transfers checked and matched; wrong ones explained with a drafted reply; Xero posting on approval, starting
on Xero's Demo Company; month-end report; manual parts listed honestly; **out of scope: Tron, BNB Chain and
other networks for payment pages, non-USD invoices, QuickBooks and NetSuite, team sign-in**) · 3 Success
criteria table · 4 What we need from you · 5 Security and data (read-only, no custody, deletion within 10
business days; DPA template needs a lawyer) · 6 Price (US$300, invoiced at the start by **[Proprietorship
trade name], India**, bank transfer/PayPal/Wise; then US$200/month, "pilot fee credited against months
2-4", cancel any time) · 7 Support (founder, first reply within 1 business day SGT, no SLA) · acceptance line.

Drafting rules:
- Copy the template; fill only from Calls/Opportunities facts; quote the customer's words exactly.
- Keep the out-of-scope list. If the customer asked for something out of scope (Tron, QuickBooks), say so
  plainly in the proposal ("not in this pilot; QuickBooks is next on our roadmap, no date yet") and flag it
  to Aashmiin. Never promise dates or features.
- **Flag "pilot fee credited against months 2-4"**: it is in the template but not in her brief; she must
  confirm it per deal.
- Save as a Google Doc draft (Drive, private) named `Clearline pilot proposal - <Company> - DRAFT
  <date>`; Approval Queue row `item = proposal`. No attachments are emailed by you, ever.

## 3. Invoice draft: Indian proprietorship exporting services
Which entity: the template says the pilot is invoiced by her **Indian proprietorship**. Use it unless she
says otherwise for a deal (e.g. a customer needs a Singapore entity). Flag the choice every time.

Fields (based on CGST Rule 46 as summarised by
https://taxguru.in/?p=674345 , https://www.taxtmi.com/article/detailed?id=15687 and the LUT master circular
https://gstcouncil.gov.in/sites/default/files/2024-06/final_master_circular_lut_bond_04102017.pdf
[ASSUMPTION: search-only; **CA to confirm every line**]):
| Field | Value / placeholder |
|---|---|
| Title | "Tax Invoice" or "Invoice" [CA to confirm which, depends on GST registration] |
| Supplier | [Proprietorship trade name], proprietor Aashmiin Kaur, [registered address, India] |
| GSTIN | [GSTIN] (or "not registered" if her CA confirms registration isn't required [CA]) |
| PAN | [PAN] [CA: whether to print] |
| Invoice no. | [series]-[FY]-[nnn]: consecutive, unique per financial year, ≤ 16 characters |
| Invoice date / due date | [date] / [date + 7 days] [her choice] |
| Recipient | legal name and billing address from the customer (never guessed); country |
| Place of supply | [country of recipient] (outside India) |
| Description | "Clearline founding pilot: stablecoin payment verification and matching, 30 days ([start] to [end])" |
| SAC | [SAC code, CA to confirm] |
| Amount | US$300.00 (currency USD; INR equivalent at [rate, date] if the CA requires it) |
| IGST | 0 (zero-rated export under LUT) [CA] |
| Endorsement | "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX" [ASSUMPTION: wording per Rule 46 summaries, CA to confirm] |
| LUT | ARN [LUT ARN], FY [2026-27] (Form GST RFD-11, filed before the supply) [CA] |
| Payment details | [bank / Wise / PayPal details from her, never invented] |
| Signature | proprietor (digital or manual) |

**CA questions to list on every invoice draft** (don't answer them as fact):
1. Is GST registration (and an LUT) required at her turnover, and is this an "export of services" (supplier
   in India, recipient and place of supply outside India, paid in convertible foreign exchange)?
2. Correct SAC and invoice title; INR conversion rate rule.
3. Realisation of export proceeds (FEMA/RBI time limit; FIRC/FIRA from bank, Wise or PayPal) [ASSUMPTION:
   general knowledge that a time limit exists; not researched].
4. Any withholding tax in the customer's country.
5. Under the LUT, tax becomes payable if payment isn't received in convertible foreign exchange within the
   allowed period (master circular) [ASSUMPTION: search-only].

Save as a Docs/Sheets draft `Clearline invoice <no> - <Company> - DRAFT`; Approval Queue row `item =
invoice`; Opportunities `invoice_status = drafted`. You never email an invoice.

## 4. Payment tracking (read-only)
- You have **no bank access** and must not ask for it. Signals: payment notification emails from Wise/PayPal/
  her bank in her Gmail (read-only), or her note "paid". Record `invoices` sheet/Finance tab:
  `invoice_no, opp_id, company, issued, due, amount, currency, status (drafted/approved/sent/paid/overdue/
  void), paid_date, paid_amount, method, notes`.
- Mark **paid** only with evidence (notification email id or her confirmation); note any shortfall (fees)
  as "paid short by $x, fees?" and ask her. Never message the customer about money yourself.
- Overdue: day due+1 → flag in the daily view; due+3 → draft a polite reminder for her approval; never
  chase on your own.
- Paid → Customers row, Opportunities stage "Pilot signed/paid", hand-off to delivery-specialist (pilot
  start) and finance-admin (books). Day 25 of the pilot → remind her of the day-30 review and the US$200
  continuation decision.
