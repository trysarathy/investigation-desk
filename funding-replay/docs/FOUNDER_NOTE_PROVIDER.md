# Founder note: the provider funding lifecycle (one page)

**Simulated prototype. No provider has agreed to fund anything, and no money moves.**

## What we know (reported by the advisor; one account)
- A cross-border payment provider had enterprise customers who wanted to pay overseas suppliers without depositing
  cash several days early.
- In some cases, after reviewing the customer, the provider paid the supplier first and collected from the customer
  later.
- That is a single reported deal. It shows the behaviour exists somewhere. It does not show how often it happens,
  who decides, or that anyone would pay for software to support it.

## What we assume (our hypothesis, unproven)
- Moving the date the importer's cash leaves does not remove the funding gap. Someone else must supply the cash and
  take the risk, and a faster rail does not make a late receivable arrive sooner.
- A provider's treasury or credit operator needs one place to do five things: evaluate the request, reserve
  capacity, follow delivery to the supplier, and reconcile repayment until the exposure ends.
- Today that work is probably spread across email, spreadsheets and a core banking or payments system. **Unknown:**
  which of these it is, and how well it already works.

## What we don't know
- Who owns the decision in practice (sales, credit, treasury, operations), and whether one person signs.
- Which evidence is mandatory: a fresh bank balance, invoices, receivable history, credit insurance?
- Whether the importer's funding date is negotiable at all, or fixed by the provider's terms.
- Whether the provider's existing core system already does reservation, draw and repayment matching well enough.

## The strongest reason a provider might not buy
They may already have this. A provider that lends against payments has a loan or credit system, a payments ledger
and a credit committee. The gap we're filling, linking "who funds the gap" to "was the supplier actually paid" to
"has the customer repaid", may be handled adequately by existing tools plus a spreadsheet. It may also be too rare
(a few deals a month) to justify a product. A second risk is that lending is the regulated, valuable part, and
software around it is a small add-on to whoever holds the balance sheet.

## What would change our mind
- **For:** a provider operator shows us a recent advance tracked across three or more systems, with a concrete
  failure: a duplicate payout, a reservation not released, or repayment matched late.
- **Against:** the decision sits inside an existing loan system with automated matching, or advances are rare
  exceptions approved by email.

## Three questions for the advisor (non-leading)
1. **"In the deal you described, who could authorise paying the supplier before the customer paid you, and what did
   that person need to see?"**
2. "After the supplier was paid, how did the provider know what the customer still owed and when, and who chased
   it?"
3. "What happened the last time a customer paid late, or a payment to a supplier came back?"
