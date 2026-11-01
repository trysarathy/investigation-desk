# Task 4: Northgate Digital Ltd (L301 / OP01): pilot proposal, invoice draft, cover email

Inputs: `calls.csv` (27 Oct 2026, held, **Strong**, "Accepted the founding pilot verbally; wants proposal +
invoice; start Mon 9 Nov"), `opportunities.csv` (OP01, Pilot agreed (verbal), value 300 USD),
`pilot_proposal_template.md` (verbatim copy of `enterprise-pack:docs/enterprise/PILOT_PROPOSAL_TEMPLATE.md`),
`invoices.csv` (none issued, 0 customers).

**Status of everything below: DRAFT for Aashmiin's approval (07:30 queue). Nothing is sent to Grace, and
no invoice is issued, by me.** Money, pricing, pilots and contracts are always human (RULES.md). Nothing
here is tax or legal advice: every GST/LUT/FEMA point is marked **[CA to confirm]**.

---

## (a) Proposal draft
WOULD WRITE: Google Doc (private, her Drive) `Clearline pilot proposal - Northgate Digital Ltd - DRAFT 2026-11-03`

> # Clearline pilot proposal: Northgate Digital Ltd
>
> Prepared by Aashmiin Kaur, Clearline · [date of sending] · valid for 30 days
>
> ## 1. What you told us
> On our call on 27 October you said: "Short payments eat my Friday afternoons." Today, "our bookkeeper copies each USDC payment from Etherscan into Xero by hand, about 20 minutes each, and short payments take longer." You receive around 40 USDC payments a month on Ethereum, plus a few in USDT on Tron.
>
> ## 2. Scope (30 days: Monday 9 November 2026 to Tuesday 8 December 2026)
> In scope:
> - Payment requests and customer payment pages for your stablecoin invoices: **USDC or USDT on Ethereum**.
> - Every incoming transfer we're given checked (genuine token, network, address, confirmations, freeze, amount) and matched to its invoice; wrong ones explained with a drafted reply.
> - Posting to Xero **on your approval**. This will be the first live run against a real Xero organisation, so we start on Xero's Demo Company and switch to yours only after you check the test postings.
> - A month-end report of every payment, exception and posting (prepared by us).
>
> Delivered by us by hand during the pilot (not automated yet):
> - Recording incoming transfers from their hashes [daily / twice a week].
> - Marking matched payments paid after your confirmation.
> - Xero account-code setup; deletion at the end.
>
> Out of scope: Tron, BNB Chain and other networks for payment pages; non-USD invoices; QuickBooks and NetSuite; sign-in for your team (access is by a shared password and, if you want, an IP allow-list).
>
> To be clear on the two things you asked about:
> - **USDT on Tron:** not in this pilot. Those payments stay with your current process during the 30 days.
> - **QuickBooks (for your parent company):** not in this pilot. QuickBooks is next on our roadmap after Xero, but there is no date yet, so I can't commit to December.
>
> ## 3. Success criteria (agreed on day 1, reviewed on day 30)
> | # | Criterion | Target | How measured |
> |---|---|---|---|
> | 1 | Stablecoin payments in the period matched or explained | [100%] | Clearline records vs your wallet history |
> | 2 | Time to handle a wrong payment | [from __ to __ minutes] | Your estimate before; timed during pilot |
> | 3 | Time to post a payment to the books | [from about 20 (your estimate on 27 Oct) to __ minutes] | Same |
> | 4 | Wrong postings to your books | 0 | Audit log vs Xero |
> | 5 | Would you continue at US$200/month? | Yes / No, with reason | Day-30 review |
>
> If criteria 1 and 4 aren't met for reasons on our side, we refund the pilot fee.
>
> ## 4. What we need from you
> Receiving address(es) (public addresses only: we never need keys or wallet access) · open invoices or a Xero connection · a named contact · 30 minutes for setup · 30 minutes for the day-30 review.
>
> ## 5. Security and data
> Read-only on-chain, no custody, no wallet keys. Hosting: [your infrastructure / dedicated container in region ___].
> Known gaps are in `SECURITY_OVERVIEW.md`. Data deleted within 10 business days of the end, confirmed in writing.
> Data processing terms: `DATA_PROCESSING_TERMS_TEMPLATE.md` (to be reviewed by a lawyer before signing).
>
> ## 6. Price
> **US$300** for the 30-day pilot, invoiced at the start by [Proprietorship trade name], India (bank transfer, PayPal or Wise). If you continue: **US$200/month**, pilot fee credited against months 2–4, cancel any time.
> Enterprise pricing on request.
>
> ## 7. Support
> Email, first reply within 1 business day (Singapore time), from the founder (`SUPPORT_AND_UPTIME.md`). No uptime SLA during the pilot.
>
> Accepted: ____________ (Northgate Digital Ltd, name and title)  Date: ______

Changes from the template (only these): customer name; §1 filled with Grace's words from the Calls tab,
quoted exactly; dates (9 Nov start from the Calls row; 8 Dec = day 30); the explicit Tron/QuickBooks
paragraph; criterion 3's "from" value, which is her own estimate; "public addresses only" in §4. Everything
else is the template word for word, including lines I'm flagging below.

## (b) Invoice draft (Indian proprietorship, export of services)
WOULD WRITE: Docs/Sheets draft `Clearline invoice [no.] - Northgate Digital Ltd - DRAFT`

| Field | Value |
|---|---|
| Title | [Tax Invoice / Invoice] **[CA to confirm, depends on GST registration]** |
| Supplier | [Proprietorship trade name], proprietor Aashmiin Kaur, [registered address, India] |
| GSTIN | [GSTIN] (or "not registered" if her CA confirms it isn't required) **[CA]** |
| PAN | [PAN] **[CA: whether to print]** |
| Invoice no. | [series]-[FY]-[nnn] (consecutive, unique per financial year, ≤ 16 characters) |
| Invoice date | [date she approves / pilot start 2026-11-09] |
| Due date | [invoice date + 7 days] (her choice) |
| Recipient | Northgate Digital Ltd, Unit 12, 8 Harbour Road, Hong Kong (from Opportunities notes; Grace to confirm the legal name and billing address) |
| Attention | Grace Lam, Finance Director |
| Place of supply | Hong Kong (outside India) |
| Description | Clearline founding pilot: stablecoin payment verification and matching, 30 days (9 Nov 2026 to 8 Dec 2026) |
| SAC | [SAC code] **[CA to confirm]** |
| Quantity / rate | 1 × US$300.00 |
| Amount | **US$300.00** (USD). INR equivalent at [rate, date] if the CA requires it |
| IGST | 0: zero-rated export under LUT **[CA]** |
| Endorsement | "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX" **[ASSUMPTION: wording per Rule 46 summaries; CA to confirm]** |
| LUT | ARN [LUT ARN], FY [2026-27] (Form GST RFD-11, filed before the supply) **[CA]** |
| Payment details | [Wise / bank / PayPal details from Aashmiin: never invented]. Northgate pays suppliers by Wise (call notes), so Wise is likely easiest for them |
| Payment reference | Please quote [invoice no.] |
| Signature | Proprietor (digital or manual) |

Not on the invoice: the US$200/month continuation (separate invoice later, only if they continue) and any
discount or credit.

## (c) Cover email draft to Grace Lam
WOULD WRITE: Gmail **draft** (not sent), reply in Grace's existing thread (thread_id from Touches; this
fixture has no L301 Touches row, so I'd look it up first), from aashmiin@gmail.com, **no attachment**.
Aashmiin adds the share link to the Doc herself. Run the guard on this REPLY row before creating the draft.

> Subject: Re: Clearline founding pilot
>
> Hi Grace,
>
> Thank you again for the call on 27 October. As promised, here is the pilot proposal: [link to the proposal, shared by Aashmiin].
>
> In short: 30 days from Monday 9 November, covering your USDC (and any USDT) payments on Ethereum, with postings to Xero only once you approve them, starting on Xero's Demo Company. To be upfront about your two questions: USDT on Tron isn't covered in this pilot, and QuickBooks is next on our roadmap but I can't promise December.
>
> The pilot is US$300, invoiced at the start. I'll send the invoice once you're happy with the proposal. Could you confirm the legal name and billing address you'd like on it?
>
> If anything in the scope doesn't match what you need, tell me and I'll adjust it before we start.
>
> Best regards,
> Aashmiin

## (d) Sheet writes (WOULD WRITE)
**Approval Queue** (two `item` rows, status `waiting`):
```
queue_date,queued_at,lead_id,company,contact_name,email,step,subject,status,item,notes
2026-11-04,2026-11-03,L301,Northgate Digital Ltd,Grace Lam,grace.lam@northgate-digital.example,REPLY,Re: Clearline founding pilot,waiting,proposal,"Doc: Clearline pilot proposal - Northgate Digital Ltd - DRAFT 2026-11-03 [Docs link] + cover email Gmail draft [link]. DECIDE: refund line, 'credited against months 2-4', hosting, recording frequency"
2026-11-04,2026-11-03,L301,Northgate Digital Ltd,Grace Lam,grace.lam@northgate-digital.example,,,waiting,invoice,"Doc: Clearline invoice [no.] - Northgate Digital Ltd - DRAFT [link]. CA questions listed; do not send before proposal approved and CA answers"
```
**Opportunities** (OP01, update in place; extension columns already exist):
`lead_id L301 · stage Pilot agreed (verbal) (unchanged until she sends) · pilot_scope "30 days 9 Nov-8 Dec 2026; USDC/USDT on Ethereum; Xero on approval (Demo Company first); Tron + QuickBooks out of scope" · next_step "Aashmiin approves proposal + invoice drafts; CA checks invoice" · next_step_date 2026-11-04 · value_usd 300 (pilot only; not adding US$200/month unless she says they intend to continue) · proposal_status drafted · invoice_status drafted`

**Finance / invoices**:
`[invoice no. pending],OP01,Northgate Digital Ltd,,,[300],USD,drafted,,,,"draft only; issue after approval + CA; start 2026-11-09"`

**Product roadmap** (product-manager hand-off): "Northgate Digital (L301, pilot agreed) asked: 'Can you do
QuickBooks by December? Our parent company uses it.' Also receives some USDT on Tron. 2026-10-27 call."

**Log**
```
2026-11-03 hh:mm | proposal | L301 | proposal drafted (Doc link); Approval Queue item=proposal; OP01 proposal_status drafted
2026-11-03 hh:mm | invoice | L301 | invoice draft (placeholders for GSTIN/LUT/SAC/bank/no.); Approval Queue item=invoice; OP01 invoice_status drafted; invoices row drafted
2026-11-03 hh:mm | draft | L301 | cover email Gmail draft to Grace Lam (no attachment; guard REPLY row run first)
2026-11-03 hh:mm | handoff | L301 | product-manager: QuickBooks-by-December + Tron asks (quote)
```

## (e) Must be confirmed before anything is sent
**Aashmiin decides:**
1. **"Pilot fee credited against months 2–4"**: it's in the template but **not in your brief** (US$300 then
   US$200/month). Keep or delete for Northgate?
2. **Refund line** ("If criteria 1 and 4 aren't met... we refund the pilot fee"): a money commitment from the
   template. Keep?
3. **"Enterprise pricing on request"**: keep or drop for a founding pilot?
4. **Which entity invoices**: Indian proprietorship (template default) vs. anything else. Is a Hong Kong
   company fine paying an Indian proprietorship?
5. **Hosting line** in §5 and **recording frequency** [daily / twice a week] in §2.
6. **Start date** 9 Nov is tight: invoice "at the start", LUT filed before supply, Xero Demo Company test.
   Is 9 Nov still realistic?
7. **Day-30 date**: 8 Dec (30 days inclusive). OK?
8. Success-criteria targets (left as placeholders; nothing was agreed on the call).
9. The `SECURITY_OVERVIEW.md`, `DATA_PROCESSING_TERMS_TEMPLATE.md` and `SUPPORT_AND_UPTIME.md` references:
   share them or remove the mentions? The DPA template needs a lawyer before anyone signs.
10. Payment details (Wise/bank/PayPal) to print, and invoice numbering series.

**Her CA confirms (questions on the invoice draft; not answered by me):**
1. Is GST registration (and an LUT) required at her turnover? Is this an "export of services" (supplier in
   India, recipient and place of supply Hong Kong, paid in convertible foreign exchange)?
2. Invoice title (Tax Invoice vs Invoice), correct SAC, INR conversion rule.
3. LUT ARN for FY 2026-27 filed before 9 Nov? Exact endorsement wording.
4. Realisation of export proceeds (FEMA/RBI time limit; FIRC/FIRA from Wise/PayPal/bank).
5. Any Hong Kong withholding tax on a service fee to an Indian proprietor.
6. Under the LUT, tax becomes payable if the payment isn't received in convertible foreign exchange within
   the allowed period. How should that be tracked?

**Grace confirms:** legal name and billing address for the invoice. (Opportunities has "Unit 12, 8 Harbour
Road", which I haven't verified with her.)

## (f) Payment tracking (read-only)
- No bank access, and I never ask for it. Signals only: payment notification emails in her Gmail
  (Wise/PayPal/bank) that mention the invoice number or "Northgate", or her note "paid".
- Daily check from the invoice's issue date. **Paid** only with evidence (notification message id, or her
  confirmation) → invoices row `paid`, paid_date, paid_amount, method. If it arrives short (e.g. transfer
  fees): "paid short by $x, fees?" and I ask her. I never message Grace about money myself.
- **Overdue:** due + 1 → flagged in the daily view; due + 3 → polite reminder **drafted for her approval**.
  I never chase on my own.
- **On paid:** Customers row (company, L301, start_date 2026-11-09, plan "founding pilot", status pilot);
  Opportunities stage → Pilot signed/paid, invoice_status paid; hand-offs to delivery-specialist (pilot
  start) and finance-admin / "Clearline finance weekly" (books). **Day 25 (3 Dec)**: remind her of the
  day-30 review (8 Dec) and the US$200/month decision.

## Notes
- Nothing goes to Grace without approval. The proposal and invoice are drafts. The cover email is a Gmail
  draft with no attachment, and only after the guard ALLOWs its REPLY row.
- Scope is honest about out-of-scope asks: Tron and QuickBooks are said plainly, with no date promised. Xero
  is described as "on your approval" and "first live run... Demo Company first". It never says "automatic".
- Every invoice value I don't have is a placeholder. Every GST/LUT/FEMA item is marked for the CA.
- [ASSUMPTION] Draft date 3 Nov 2026 (the Opportunities next_step_date is 4 Nov).
