---
title: "Clearline"
author: "Aashmiin Kaur, founder"
date: "Working paper, version 0.2, 29 October 2026"
---

<!--
EDITING NOTES (not printed)
- This one file builds both PDFs. Run `python3 build.py` in this folder.
- Claim labels: {{V}} = verified (source in the footnote that follows), {{V:path}} = product claim
  proven by that file or test, {{A}} = assumption / hypothesis, {{G}} = guess.
  The clean copy hides the labels; the review copy prints them.
- Product claims are pinned to commits listed in CLAIMS_AUDIT.md. Keep them true of those commits.
-->

::: {.statusbox}
**Status, stated plainly.** This is a working paper about an early product built by one founder. Clearline works end to end in demo mode with a fictional company. It has no customers and no customer conversations yet; outreach began on 29 October 2026. In live mode it checks a real Ethereum transaction when someone pastes its ID; it does not yet watch wallets. The Xero connection is built and tested against recorded API shapes, but has not run on a live Xero organisation. Every market and regulatory figure has a source; guesses and assumptions are marked. Product claims refer to `main` at commit `9af0200` unless a footnote names an unmerged pull request.
:::

# Abstract {.unnumbered}

Stablecoins now carry real commerce: estimates of real-economy stablecoin payments in 2025 range from about US\$350 billion to US\$550 billion.{{V}}[^reap] Yet a blockchain transfer is not a completed business payment. A transfer says that a token balance changed. A payment means the right amount, of the genuine asset, on the agreed network, for a specific invoice, recorded correctly in the books. Between the two sits a layer nobody clearly owns: telling the payer exactly what to send, checking what arrived, matching it to the invoice, explaining what went wrong, and posting the result to the accounting system.

Clearline aims to be that layer for businesses paid directly into their own wallets. It issues a precise payment request per invoice, checks each incoming transfer with deterministic rules, matches it to its invoice with evidence, explains failures in plain English, and prepares accounting entries that post only after a person approves. It is read-only on-chain and never holds funds. This paper sets out the problem, the design, what works today and what does not, the competition, and the risks. It ends with the open questions that only customers can answer.

# 1. The problem: a transfer is not a payment

A blockchain records **transfers**: token *X* moved from address *A* to address *B* in block *n*. A business needs **payments**: customer *C* settled invoice *I* in full, in money the business can use. The second needs facts the chain does not hold:

- **Which invoice?** A USDC or USDT transfer on Ethereum has no field for an invoice reference.
- **Is it the genuine asset?** Anyone can deploy a token contract named "USDT". Only the issuer's contract makes it real.
- **Is it complete?** A transfer can be short (an exchange took its fee out), over, or sent twice.
- **Did it arrive where the business can use it?** The same `0x` address exists on every EVM network, so a payer can send on the wrong one.
- **Is it final?** It must be past the point where the chain can reorganise.

| Failure | Example | Consequence |
|----|---------|----------|
| **Short payment** | 4,950 USDC arrives for a 5,000 invoice | Invoice left open, or closed wrongly |
| **Wrong network** | USDC sent on Polygon or BNB Chain to the `0x` address issued for Ethereum | Recoverable if the business controls that address with an ordinary key, because the same key works on every EVM chain; often not recoverable if the address is a smart-contract wallet (such as a Safe) or an exchange deposit address |
| **Counterfeit token** | A token named "USDT" from a contract Tether does not control | Worthless tokens credited as payment |
| **Missing reference** | 2,180 USDC to a general treasury address | Unapplied cash; the customer is chased for money they paid |
| **Look-alike address** | Funds sent to an address that shares its first and last characters with the real one | Funds go to a scammer |
| **Duplicate** | The same amount arrives twice, minutes apart | Refund owed; books overstated |

These are real. In December 2025 a user sent 49,999,950 USDT to an address matching the intended one in its first three and last four characters, minutes after a small test payment to the right address.{{V}}[^poison] That loss came from the payer's own wallet history, not from a business invoice; a payee-side tool such as Clearline would only have helped if the payer had used the payee's payment page. Among real public transactions collected to test Clearline's checking engine, 13 were counterfeit tokens posing as USDT, one spelled with look-alike Cyrillic and accented letters ("ÚЅDТ").{{V:demo/REPORT.md}} That count reflects how the cases were chosen, not how common counterfeits are.

**How finance teams cope today.** We have not measured this with any customer. Our working picture, which the first customer calls are designed to test, is a block explorer, a spreadsheet and an email thread for each exception.{{A}} We guess 10 to 30 minutes per exception.{{G}} The larger cost is risk: a counterfeit credited as payment, or a weak audit trail for how each receipt was verified.

# 2. Market context

**Size, with care.** Total stablecoin market capitalisation was US\$308.0 billion on 13 August 2026, according to DefiLlama data reported by Reap; USDT holds about 59% of supply and USDC about 23%; by network, Ethereum carries about 49% of supply and Tron about 31%.{{V}}[^reap] Estimates of real-economy payments for goods and services in 2025 (US\$350–550 billion, BCG; about US\$390 billion, McKinsey/Artemis) are about 1% of gross stablecoin transfers (US\$28–62 trillion or more, depending on the method: about US\$28 trillion per the BIS, more than US\$62 trillion per BCG with Allium).{{V}}[^reap] Most transfer volume is not commerce. McKinsey puts the business-to-business payment base at about US\$226 billion a year.{{V}}[^reap] Bessemer estimates that 60% of 2025's real-world stablecoin payments were B2B.{{V}}[^bvp]

**Adoption is early.** In a mid-2025 EY-Parthenon survey of 350 corporate and financial-institution decision-makers, reported by Reap, only about 13% of organisations had used stablecoins (8% of corporates). Among the use cases, paying suppliers cross-border (62%) and accepting cross-border payments (53%) led.{{V}}[^reap] Reap calls these figures a directional snapshot taken before the GENIUS Act was signed.

**Regulation is arriving.** Clearline's first customers are expected to be in Singapore and Hong Kong;{{A}} US and EU rules matter because they shape the main stablecoins.

| Jurisdiction | Status (checked 29 October 2026) |
|---|------------|
| **Singapore** | On 1 September 2026, MAS consulted on draft Payment Services Act amendments for single-currency stablecoins, with a stand-alone issuance licence. Comments closed on 16 October 2026; no enactment date is set. Stablecoins not regulated by MAS stay lawful, and intermediating them falls under the existing digital payment token regime.{{V}}[^gd] |
| **Hong Kong** | The Stablecoins Ordinance came into operation on 1 August 2025.{{V}}[^hkord] The first issuer licences went to HSBC and Anchorpoint Financial on 10 April 2026.{{V}}[^hklic] |
| **United States** | The GENIUS Act became Public Law 119-27 on 18 July 2025{{V}}[^genius] and takes effect on 18 January 2027; the OCC finalised its issuer rule on 21 October 2026.{{V}}[^occ] |
| **European Union** | MiCA's rules for e-money tokens have applied since 30 June 2024;{{V}}[^eba] the transitional period for crypto-asset service providers ended on 1 July 2026.{{V}}[^fsma] |

These rules target issuers and intermediaries. A regulated stablecoin can still be sent short, on the wrong network or to a look-alike address. Our hypothesis is that clearer rules bring conventional businesses that expect bank-like controls on receipts.{{A}}

# 3. Competition and alternatives

**Processors.** Stripe accepts USDC, USDP and USDG (not USDT), caps each customer transaction at US\$10,000, settles to the Stripe balance in local currency, and lists businesses in the US with a private preview in the EU, Hong Kong, Mexico and Switzerland; Singapore is not listed.{{V}}[^stripe] Stripe also owns Bridge, a stablecoin infrastructure company, since February 2025.{{V}}[^bridge] HitPay lets Singapore merchants accept USDT, USDC and PYUSD across ERC-20, TRC-20, Solana, Polygon and Arbitrum; its MAS-licensed partner Triple-A handles and converts the stablecoins, and merchants receive fiat.{{V}}[^hitpay] BVNK and others offer similar infrastructure; we have not reviewed them in detail. **For a business happy to have a processor in the middle, HitPay already solves much of this problem in Singapore.** Clearline is for businesses whose customers pay them directly and who want to keep the stablecoins, or whose payers will not use a checkout.{{A}}

**Payer-side controls.** Safe{Wallet} with Blockaid warns a sender before they sign a transaction to a suspicious or look-alike address.{{V}}[^safe] Institutional payers using Fireblocks can send only to whitelisted destination addresses approved by an admin group.{{V}}[^fireblocks] These controls protect the payer well. They do not tell the payee which invoice a receipt pays.

**Invoicing and crypto accounting.** Request Finance lets a supplier send an invoice denominated in fiat and be paid in crypto or fiat to the supplier's wallet, with reconciliation and accounting export.{{V}}[^rfar] It syncs with QuickBooks Online, Xero and NetSuite.{{V}}[^request] Its underlying protocol, Request Network, solves the matching problem on-chain: the payer pays through a smart contract that logs a `paymentReference` derived from the request, and the balance is the sum of payment events with that reference, so partial payments are supported.{{V}}[^rnpn] Bitwave,{{V}}[^bitwave] TRES{{V}}[^tres] and Cryptio{{V}}[^cryptio] sync on-chain activity to ERPs. **"Nobody connects stablecoins to accounting" is false.**

**Where Clearline stands.** Request Network's approach works when the payer pays through its contract. Our hypothesis is that many B2B payers send a plain token transfer from an exchange, a treasury wallet or a custody platform, with no reference, and that the exceptions on that path are where the cost sits.{{A}} Clearline's design choice is to work with plain transfers: it needs no special contract on the payer's side. The price of that choice is that matching has to come from the address, the amount and the sender's history (section 4). Whether this beats Request Finance for any real customer is unproven and is the first thing the customer calls must test.

Bessemer's view is that Stripe, Circle and Coinbase are becoming one-stop shops, and that early-stage startups should "navigate outside the paths of Stripe, Circle, and Coinbase".{{V}}[^bvp]

# 4. Design

## 4.1 Principles

- **Read-only on-chain.** No wallet, no private keys, no signing code.{{V:src/lib/chain/}}
- **Deterministic first.** Rules decide verdicts from explicit evidence. AI may word an explanation; it never decides one.{{V:src/lib/ai/validate.ts}}
- **A person approves anything that changes the books.**{{V:src/lib/accounting/engine.ts}}
- **Keep history.** Decisions, activity, check snapshots and the posting audit are appended, never edited. Requests and transfer records are updated in place as facts arrive, but each transfer keeps its earlier attributions.{{V:src/lib/requests/lifecycle.ts}}

![Where Clearline sits. The chain records the transfer; Clearline supplies the layer between "money moved" and "invoice closed".](build/gap.pdf){width=100%}

## 4.2 The five steps

1. **Instruction.** Each invoice gets a payment page: exact amount, token, the issuer's token contract, network, receiving address and an EIP-681 QR code.{{V:src/lib/requests/present.ts}}[^eip681] An address checker *warns* the payer if an address they paste matches the real one at the start or end but differs in between; it helps only if the payer uses it.{{V:src/lib/requests/lifecycle.ts}}
2. **Verification.** Each transfer is checked: did it succeed, on which network, to which address, from the issuer's own contract, how many confirmations, and is the sender or the business's own address frozen by the issuer.{{V:src/lib/requests/lifecycle.ts}} If a data source does not answer, the check pauses and concludes nothing.{{V:src/lib/engine/run.ts}}
3. **Matching.** A transfer is attributed to a request only when exactly one open request uses its receiving address. Several candidates are never decided by amount alone; a person assigns the transfer with a written reason.{{V:src/lib/requests/lifecycle.ts}}
4. **Explanation.** Templates built from the records say what happened, the likely cause (labelled as an inference), the next step and a reply to the customer.{{V:src/lib/requests/present.ts}}
5. **Accounting.** Clearline prepares the entries and, after a person approves, posts them (Xero connection in testing). Counterfeit, failed and wrong-network transfers are never posted. Each line carries an idempotency key, and every approval, posting, failure and refusal goes into an audit log.{{V:src/lib/accounting/rules.ts}} Appendix A has the posting rules.

![Architecture today. One deployment serves one company. Clearline reads the chain and writes to the books only after approval.](build/architecture.pdf){width=100%}

## 4.3 Live today vs demo only

The demo is more complete than live mode. This table is the honest boundary.

| Capability | Demo (simulated transfers) | Live today |
|-----|-----|---------|
| Detecting a payment | Automatic | A person pastes the transaction ID; nothing watches addresses{{V:src/lib/requests/provider.ts}} |
| Confirmations | Advance automatically | No polling: a payment pasted before 12 confirmations stays "confirming" until someone pastes it again{{V:src/lib/requests/service.ts}} |
| Marking a correct payment paid | Automatic rule | A person marks it paid{{V:src/lib/requests/service.ts}} |
| Attributing a pasted payment | n/a | Pasting from a request's page does not tie the payment to that request; if several open requests share one wallet address, the payment is "ambiguous" and a person assigns it{{V:src/lib/requests/service.ts}} |
| Unidentified payment suggestions | Scored suggestions | Not reachable: a live lookup keeps only transfers to the request's own address{{V:src/lib/requests/provider.ts}} |
| Wrong-network payment | Recorded and explained | A hash found on another network returns a message; nothing is recorded{{V:src/lib/requests/provider.ts}} |
| Issuer-freeze check | n/a | Runs only when someone looks a hash up; never re-checked on its own{{V:src/lib/chain/investigate.ts}} |
| Counterfeit labelling | Shown | A fake token whose symbol does not contain the requested token's name is labelled "wrong token" rather than "counterfeit"; it is still never counted or posted{{V:src/lib/requests/lifecycle.ts}} |
| Payment pages | Ethereum, USDC and USDT | Ethereum, USDC and USDT. No Tron{{V:src/lib/requests/types.ts}} |
| Accounting | Fictional demo books | Xero built, not yet run live; QuickBooks built, not run on a sandbox; NetSuite designed only{{V:docs/ACCOUNTING_SYNC.md}} |

## 4.4 The matching premise

Matching is easy if every invoice has its own address. Most businesses do not create a new wallet per invoice; many publish one treasury address.{{A}} There are three known ways to tie a plain transfer to an invoice:

| Approach | How it works | Trade-off |
|----|-------|------|
| **Address per invoice** | Derive a fresh deposit address for each invoice from one HD wallet or a custody provider | Exact matching; needs custody tooling and sweeping funds, which Clearline must not do itself |
| **Unique amount** | Ask for 1,250.37 instead of 1,250.00 | Cheap; breaks when an exchange deducts a fee |
| **Payment reference** | The payer pays through a contract that logs a reference (Request Network) or a token that supports one (the ERC-7699 proposal){{V}}[^erc7699] | Exact; needs the payer's cooperation |

Clearline today accepts whatever address the business supplies, and matches by address, then by evidence (exact amount, a sender address this customer has used before, no other open request for that amount) for a person to confirm.{{V:src/lib/requests/lifecycle.ts}} **With one shared treasury address, most live payments would need a person to assign them.** The plan is to support addresses issued per invoice by the business's own custody provider (read-only on Clearline's side), and to test unique amounts with pilots.{{A}}

## 4.5 Finality and valuation

Clearline waits for 12 confirmations on Ethereum, a sample setting that cannot yet be changed, and does not handle chain reorganisations.{{V:src/lib/requests/check.ts}} Ethereum's `finalized` block tag, reached after about two epochs (12–13 minutes), is the better standard and is planned.{{V}}[^finality]

USDC and USDT are booked at par into a bank-type account, and every line says "no price feed connected"; a price more than 0.5% from par blocks automatic posting.{{V:src/lib/accounting/rules.ts}} Whether a stablecoin is cash, a cash equivalent, a financial asset or an intangible is an **open accounting question**. In the US, the FASB proposed on 18 August 2026 to show how some stablecoins can meet the existing cash-equivalent definition, depending on redemption rights and reserves; comments close on 19 November 2026 and nothing is final.{{V}}[^fasb] Under IFRS and SFRS(I) we have not found settled guidance specific to stablecoins.{{A}} Par valuation into a bank account is therefore a default each customer's accountant must accept, not a rule we can assert.

# 5. Trust, security and compliance

**Never holds funds.** If Clearline received, held or forwarded funds, it would become a party to the payment and in Singapore would likely need a licence for digital payment token services.{{A}} HitPay shows the boundary: its licensed partner handles the stablecoins and HitPay itself does not.{{V}}[^hitpay] We have not yet taken legal advice and will before the first paying customer.

**Sanctions.** Clearline does not screen counterparties against OFAC or UN lists or use blockchain-analytics providers such as Chainalysis or TRM. The issuer-freeze check is weak protection for receipts: a transfer from a frozen sender fails on-chain and never arrives.{{A}} The real risks are the business's own address being frozen, which Clearline checks only when a hash is looked up, and receiving tainted funds, which it does not detect. Our position: screening stays the business's responsibility for now; integrating an analytics provider is on the roadmap, and the paper does not claim compliance screening.

**Known gaps and planned fixes.**{{V:docs/enterprise/SECURITY_OVERVIEW.md}}[^pr30]

| Gap today | Planned fix |
|------|-----|
| No sign-in: the user types a name; the only gate is an optional shared password | Email sign-in with a one-time code, then SSO and roles |
| Xero tokens stored unencrypted on the server's disk | Encrypt with the host's secret manager; add "Disconnect" that revokes the token |
| Xero scopes: the code requests the older broad `accounting.transactions` scope, but Xero apps created on or after 2 March 2026 must use granular scopes{{V}}[^xero] | A separate pull request updates the scopes; the live Xero test must use them |
| The audit log is append-only in the application, not tamper-evident | Hash-chained entries, exported daily |
| JSON files, one process; deletion is manual | A managed, encrypted database; logged deletion. Until then, pilot data is deleted by hand within 10 business days of a request |
| The posting function accepts approval without the plan key; only the web route requires it | Make the key mandatory in the function itself{{V:src/lib/accounting/engine.ts}} |
| No penetration test or SOC 2 report | A penetration test before the first customer with real volume |

**Data and AI.** Clearline stores invoice and customer references, amounts, addresses, transfer records and typed user names; no keys or identity documents. AI explanations are optional and off in the Docker image, but the code switches them on whenever an Anthropic API key is present, and the verdict's evidence (with customer IDs removed) is then sent to Anthropic's API.{{V:src/lib/ai/anthropic.ts}} For pilots, AI stays off unless the customer agrees in writing; no zero-retention agreement is in place.

**Liability.** When Clearline is wrong, a person has still approved the posting, and no funds moved through Clearline. Our intended terms limit liability to fees paid and require the customer to approve every posting;{{A}} professional indemnity insurance is needed before real volume. This has not been reviewed by a lawyer.

# 6. Toward an open standard

The deeper fix is a payment instruction that the payer's wallet can verify and a receipt that the payee's auditor can verify. Prior art is mixed. EIP-681 encodes a token transfer as a URL, and Clearline uses it;{{V}}[^eip681] Solana Pay adds a `reference` key to a transfer so the payee can find it;{{V}}[^solpay] Request Network logs a reference on-chain.{{V}}[^rnpn] The cautionary case is Bitcoin's BIP70: signed payment requests tied to the web's certificate system, which "never saw widespread adoption", brought outside security dependencies, and were removed from Bitcoin Core in 2019.{{V}}[^bip70] The lesson we take is to start from what wallets already read (EIP-681), add a signature only where a wallet team will verify it, and publish nothing as a "standard" until real customers use the instruction.{{A}}

# 7. Evidence so far

**Clearline-specific evidence.** The payment-request and accounting code has 23 request-lifecycle tests and 23 accounting tests, of which 10 cover posting rules and 4 check the Xero and QuickBooks request shapes.{{V:tests/accounting.test.ts}} In the demo, all seven payment situations (routine, short, counterfeit, wrong network, unidentified, look-alike, duplicate) play through to the books in a browser, 113 of 113 checks, three runs in a row.{{V:demo/QA_REPORT.md}}[^pr31] Matching has been tested only on simulated data.

**Evidence from the earlier product.** Clearline grew out of a deposit-investigation tool for crypto businesses, whose checking engine Clearline reuses. That engine was tested on real public transactions on six networks against answers proven by sources outside the product, with fictional sample company records: 59 of 59 correct after fixes (43 before), and 52 of 52 on a set built afterwards; an independent reviewer re-checked 7 cases on-chain.{{V:demo/REPORT.md}} The full test suite, mostly that earlier product, has 573 passing tests.{{V:npm test on qa-polish}} This shows the rules behave as designed on a small, chosen sample. It does not show accuracy on a real business's payments.

**Customers.** None, and no customer calls have been held. The first outreach emails were sent on 29 October 2026.

# 8. Business model

**First buyer (hypothesis).** The founder or finance lead of a small or mid-sized business in Singapore or Hong Kong that invoices in USD and is paid in USDT or USDC directly to its own wallet: Web3 service firms, agencies, exporters.{{A}} Much of that B2B USDT is probably on Tron, which is why Tron payment pages are the first change on the roadmap.{{A}}

**Price (untested).** A founding pilot at US\$300 for 30 days, then US\$200 a month.{{A}}

**Size, bottom-up (all hypotheses).** If 500–2,000 businesses in Singapore and Hong Kong are paid directly in stablecoins often enough to care,{{G}} at US\$2,400 a year that is US\$1.2–4.8 million in annual revenue. That is a small business, not a venture-scale one. Scale would need more regions, a higher price for larger teams, payment-company partners paying per exception,{{G}} or the network and standard described above. We state this plainly rather than quote a top-down market size.

**Unit economics (guesses).** Chain data from a paid provider, perhaps US\$50–300 a month per deployment at pilot volumes;{{G}} hosting of one container per customer; support time per exception that we have not measured. Reaching customers at US\$200 a month cannot rely on a sales team; it needs founder-led outreach now and partners (accountants, payment companies) later.{{A}} The cost to win a customer is unknown.

# 9. Risks and open questions

| Risk | What we would do |
|-----|-----|
| **No demand**: exceptions are rare or cheap | Measure in the first 20 calls; change the wedge or stop |
| **Processors absorb it** (HitPay, Stripe) | Serve only businesses that keep custody; be useful to processors |
| **Request Finance or others already solve it** | Test their products against real cases before building more |
| **Live product is thin** (table 4.3) | Address watching, confirmation polling and Tron before the first live pilot |
| **Licensing** if a feature touches funds | Keep "never holds funds"; legal advice before charging |
| **Security maturity** | Fix sign-in, token encryption and Xero scopes first |
| **Accounting treatment** is unsettled | Let the customer's accountant set the policy; make account mapping configurable |
| **Single founder** | Narrow scope; partner for security and sales once there is revenue |

**Questions only customers can answer.** How many exceptions does a business see each month, and who handles them? Do payers use one treasury address or per-invoice addresses? Is Tron or Ethereum the main network? Would a finance team connect its books to a young product, and pay US\$200 a month to do so?

# 10. Roadmap (12 to 24 months)

| When | What | Gate to move on |
|--|--------|----|
| **Months 0–3** | Payment pages on Tron. Address watching and confirmation polling on Ethereum and Tron. Sign-in, encrypted tokens, granular Xero scopes; Xero Demo Company live test. 20 customer calls | 3 paying pilots; exceptions measured on real data |
| **Months 3–6** | Per-invoice addresses from the customer's custody provider. QuickBooks sandbox. Editable settings, `finalized` finality. Tamper-evident audit; database; month-end report | Pilots renew; matching accuracy published from real cases |
| **Months 6–12** | More networks; non-USD invoices; sanctions screening through an analytics provider; penetration test | 20 paying customers |
| **Months 12–24** | NetSuite. A draft instruction format, only if a wallet team will verify it | Revenue that supports a team |

# 11. Conclusion

Stablecoins already carry hundreds of billions of dollars of commerce, and regulation is making them more ordinary. The money moves well; what a business needs after the transfer does not yet work well. Clearline is a narrow attempt at that layer for businesses paid straight into their own wallets: precise instructions, deterministic checks, conservative matching, plain explanations and entries that post only with a person's approval, without ever holding funds. The product works in demo, live mode is thin, and the accounting connection has not run live. The next proof is not more code; it is whether real finance teams have this problem often enough to pay for it.

\clearpage

# Appendix A. Implementation detail {.unnumbered}

## A.1 Payment requests

A request fixes, at creation: the amount as an exact decimal string with at most six decimal places (the precision of USDC and USDT on Ethereum); the token and the issuer's official contract; the network (Ethereum); the receiving address, which is the business's own; and a random public identifier for the payer's link.{{V:src/lib/requests/lifecycle.ts}} The address checker returns *match*, *look-alike*, *different* or *invalid*. A look-alike shares the first four or last four hex characters with the real address. Only the verdict is kept, plus the pasted address when it is a look-alike; the last 20 checks are kept per request.{{V:src/lib/requests/lifecycle.ts}}

## A.2 Verification rules

Each transfer is stored once under `chain:hash:logIndex`, so a repeated event never creates a second payment, and confirmations never go backwards.{{V:src/lib/requests/lifecycle.ts}} A transfer counts toward a request only if all of these hold:{{V:src/lib/requests/lifecycle.ts}}

| Check | Rule | Can a person override it? |
|---|-------|------|
| Succeeded | The transaction did not revert | No |
| Network | Sent on the request's network | Only if it landed in the business's own wallet there; never posted automatically |
| Address | Sent to the request's receiving address | By assigning the payment, with a note |
| Genuine token | Contract equals the issuer's contract fixed on the request | No |
| Timing | Mined after the request was created | Yes, with a note |
| Engine findings | For example an issuer freeze | No |
| Confirmations | 12 on Ethereum (sample setting) | n/a |

## A.3 Matching and states

For a payment with no usable reference, Clearline suggests up to three open requests, scored out of 100: exact amount owed (40), a sender address this customer has paid from before (35), no other open request for the amount (15), paid after the invoice (10). *Strong* is 80 or more, *Possible* 50 or more. The score is not a probability, and a person confirms with a written reason.{{V:src/lib/requests/lifecycle.ts}} States are derived from the records every time: *awaiting payment*, *payment seen*, *confirming*, *matched*, *needs attention*, *paid*.{{V:src/lib/requests/types.ts}}

![Request states. "Paid" is reached only by a decision: a person's, or the automatic rule (demo only today).](build/states.pdf){width=96%}

## A.4 Explanation and AI

Explanations and replies come from templates over the records; a likely cause is labelled as an inference; replies state only facts from the records and promise no timing or credit.{{V:src/lib/requests/present.ts}} On the investigation pages, an optional language model (Claude) can word a verdict the rules already decided. Its output is rejected, and the template used, if a sentence cites no evidence ID, or if it contains a number, address, hash, date or token name not in the evidence, or words such as "guaranteed", "refund" or "fraud".{{V:src/lib/ai/validate.ts}} This path has not been tested on real data.{{V:demo/REPORT.md}}

## A.5 Posting rules

| Case | What posts | Invoice after |
|----|---------|----|
| Exact | One payment, with tx hash, token, network and USD value in the reference | Paid |
| Short | A partial payment and a note | Open for the shortfall |
| Short, accepted as settled | The payment plus a separate fee write-off line | Paid |
| Over, or paid twice | Nothing until a person decides; then the invoice amount once, and the excess as a separate overpayment line | Paid |
| Same transfer reported twice | Nothing new | Unchanged |
| Counterfeit, failed, wrong token or wrong network | **Never posted** | Unchanged |
| No reference | Nothing until a person confirms the invoice | |
| Non-USD invoice, or price more than 0.5% from par | Blocked; post by hand | |

Payment lines are rounded down to the cent, so the books never show more received than arrived. The approval is refused if the plan changed since the page loaded.{{V:tests/accounting.test.ts}}

![One payment, end to end. In live mode today, step 5 is a person pasting the transaction ID; in the demo it is automatic.](build/sequence.pdf){width=96%}

## A.6 Records

![Core records. Check snapshots, decisions and the posting audit are append-only; requests and transfers are updated as facts arrive.](build/datamodel.pdf){width=96%}

## A.7 Threat model

| Threat | Mitigation today | Residual risk |
|----|-------|------|
| Counterfeit tokens | Issuer's contract fixed at request creation; never counted or posted | Depends on the official contract list |
| Look-alike addresses | Checker on the payment page | Only if the payer uses it |
| Impersonation of the business | Random payment-link IDs | **Not solved**: a fake page or invoice is still possible |
| Replay and duplicates | One record per `chain:hash:logIndex`; one idempotency key per line | Low |
| Insider error | A written reason for every decision; approval before posting | **High until sign-in exists** |
| Data-source failure | Checks pause; a missing receipt is never read as a failure{{V:src/lib/chain/evm.ts}} | Free data sources are fragile |
| Server compromise | Secrets in environment variables | **High**: see section 5 |

# Appendix B. Worked examples {.unnumbered}

All use Clearline's demo: a **fictional** company, Northwind Pay Pte Ltd, its fictional customers and simulated transfers, through the same code as live transfers.{{V:src/lib/requests/demo.ts}}

| Case | What arrived | What Clearline concludes and does |
|---|-------|---------|
| **a. Routine** | Exact amount of genuine USDC to the invoice's address | Matched after 12 confirmations; marked paid by the demo's automatic rule; one payment line posts on approval |
| **b. Short** | 4,950.00 of 5,000.00 USDC from an exchange's withdrawal wallet | Short by 50.00 (1.0%); likely cause, labelled an inference: exchange fee. Drafts a request for the balance |
| **c. Counterfeit** | 7,500 "USDT" from a contract Tether does not control | Cannot be marked paid; never posted; drafts a non-accusing reply |
| **d. Wrong network** | 3,200 USDT on Tron to the business's old Tron wallet, for an Ethereum request | A person may count it after treasury confirms; never posted automatically |
| **e. Unidentified** | 2,180.00 USDC to the main address, no reference | Suggests INV-1045 with score 100 (*Strong*); a person confirms |
| **f. Look-alike** | Nothing yet: the payer pastes an address from their history | "Stop: don't send to this address" |
| **g. Duplicate** | 1,980.00 USDC twice, four minutes apart | One payment and one overpayment marked for refund; refund instruction drafted for treasury |

# Appendix C. Glossary {.unnumbered}

| Term | Plain meaning |
|---|---------|
| **Stablecoin** | A token designed to hold a steady value, usually US\$1. USDC (Circle) and USDT (Tether) are the largest |
| **Token contract** | The program on the blockchain that defines a token. Only the issuer's contract makes a token genuine |
| **Network (chain)** | A blockchain such as Ethereum or Tron. EVM networks share the same address format |
| **Transaction ID (hash)** | A unique identifier used to look up a transaction |
| **Confirmations / finality** | Blocks added after a transaction; "finalized" means validators have made it practically irreversible |
| **Address poisoning** | A scam that plants a look-alike address in a victim's history, hoping they copy it later |
| **Idempotency key** | A label on a write, so sending it twice has the same effect as once |
| **Read-only** | Able to look, not to act |

*Sources are given as footnotes. The full list, with every product claim mapped to a file or test, is in CLAIMS_AUDIT.md.*

[^bvp]: Bessemer Venture Partners, "Stablecoins: from DeFi primitive to global financial infrastructure", 22 April 2026. <https://www.bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure>
[^reap]: Reap, "Stablecoin Statistics & Data 2026", 14 August 2026, reporting BCG × Allium, McKinsey/Artemis, BIS, DefiLlama and EY-Parthenon. <https://reap.global/blog/stablecoin-statistics-2026>
[^poison]: Cointelegraph, 20 December 2025. <https://cointelegraph.com/news/address-poisoning-copy-paste-mistake-50m-usdt-loss>; transaction: <https://etherscan.io/tx/0xc0514a795f065fce8a3e1238a1ba480e8a792d45f6431ee4ba8d800bedd86a0f>
[^genius]: U.S. GPO, Public Law 119-27, 18 July 2025. <https://www.govinfo.gov/metadata/pkg/PLAW-119publ27/mods.xml>
[^occ]: Decrypt, 21 October 2026. <https://decrypt.co/381502/occ-finalizes-genius-act-stablecoin-rules-ahead-of-january-deadline>
[^eba]: European Banking Authority, "Asset-referenced and e-money tokens (MiCA)". <https://eba.europa.eu/regulation-and-policy/asset-referenced-and-e-money-tokens-mica>
[^fsma]: FSMA (Belgium), 25 June 2026. <https://www.fsma.be/en/news/crypto-assets-service-providers-end-transitional-period>
[^hkord]: Hong Kong Government News, 6 June 2025. <https://www.news.gov.hk/eng/2025/06/20250606/20250606_140750_137.html>
[^hklic]: Charltons, "HKMA Issues First Stablecoin Issuer Licences", April 2026. <https://www.charltonslaw.com/hkma-issues-first-stablecoin-issuer-licences/>
[^gd]: Gibson Dunn, September 2026. <https://www.gibsondunn.com/singapore-publishes-draft-legislation-to-implement-its-stablecoin-framework/>
[^stripe]: Stripe Docs, "Stablecoin payments". <https://docs.stripe.com/crypto/stablecoins>
[^bridge]: Stripe, "Stripe completes Bridge acquisition", 4 February 2025. <https://stripe.com/us/newsroom/news/stripe-completes-bridge-acquisition>
[^hitpay]: HitPay, "Accept Crypto". <https://hitpayapp.com/crypto-payment-gateway-hitpay>
[^safe]: Safe, Blockaid integration, 16 September 2024. <https://safe.global/blog/safe-wallet-gets-even-safer-introducing-blockaid-integration>
[^fireblocks]: Fireblocks Developers, "Manage Destination Addresses". <https://developers.fireblocks.com/docs/whitelist-addresses>
[^rfar]: Request Finance, "Accounts receivable". <https://www.request.finance/accounts-receivable>
[^request]: Request Finance Help Center, "Accounting integrations overview". <https://help.request.finance/en/articles/13038304-accounting-integrations-overview>
[^rnpn]: Request Network Docs, "How payment networks work". <https://docs.request.network/advanced/protocol-overview/how-payment-networks-work>
[^bitwave]: Bitwave, "Stablecoin B2B payments". <https://www.bitwave.io/request-a-demo-stablecoin-b2b-payments>
[^tres]: TRES Finance, "Crypto accounting". <https://tres.finance/lpp/crypto-accounting>
[^cryptio]: Cryptio, 15 January 2026. <https://blog.cryptio.co/cryptio-the-obvious-choice-for-netsuite-users>
[^eip681]: ERC-681, "URL Format for Transaction Requests". <https://ercs.ethereum.org/ERCS/erc-681>
[^erc7699]: ERC-7699, "ERC-20 Transfer Reference Extension" (a proposal). <https://ercs.ethereum.org/ERCS/erc-7699>
[^finality]: Tatum Docs, "EVM block finality and confidence". <https://docs.tatum.io/docs/evm-block-finality-and-confidence>
[^fasb]: Crowe, "FASB proposes cash equivalents guidance for stablecoins", 25 August 2026. <https://www.crowe.com/insights/take-into-account/fasb-proposes-cash-equivalents-guidance-for-stablecoins>
[^xero]: Xero Developer, "Granular scopes" FAQ. <https://developer.xero.com/faq/granular-scopes>
[^solpay]: Solana Pay specification, version 1. <https://solana.com/docs/tools/solana-pay/specification/version1>
[^bip70]: Bitcoin Optech, "BIP70 payment protocol". <https://bitcoinops.org/en/topics/bip70-payment-protocol/>
[^pr30]: `docs/enterprise/SECURITY_OVERVIEW.md` on branch `enterprise-pack` (pull request 30, commit `7c493e3`, not merged).
[^pr31]: `demo/QA_REPORT.md` and the 573-test run on branch `qa-polish` (pull request 31, commit `12abf33`, not merged), run on 29 October 2026.
