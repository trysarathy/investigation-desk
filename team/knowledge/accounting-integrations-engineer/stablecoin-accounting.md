# How accountants record stablecoin receipts (IFRS, US GAAP, practice)

**Source situation on 2026-11-01:** ifrs.org, fasb.org, aicpa-cima.com, kpmg.com, iasplus.com and the Big-4
sites are **blocked** in this session. **No primary accounting source was opened.** Everything below is
`[ASSUMPTION: secondary, <source>]` (search-engine summaries of the named pages) or my own reasoning marked
[ASSUMPTION]. Do not quote any of it to a customer as settled. Aashmiin (accountancy student) and the
customer's accountant decide the policy; Clearline only posts what the signed spec says.

## The question
When a customer pays a USD invoice with 5,000 USDC, the receivable is settled. What is the asset we debit?
Cash? A cash equivalent? A financial asset? An intangible asset? The answer decides the account type in Xero,
whether there are fair-value movements, and how the cash-flow statement shows it.

## IFRS (Singapore's SFRS(I) is word-for-word IFRS [ASSUMPTION: not opened])
- **IFRS Interpretations Committee agenda decision, June 2019, "Holdings of cryptocurrencies":** IAS 2
  Inventories applies if held for sale in the ordinary course of business; otherwise IAS 38 Intangible
  Assets. The Committee concluded such holdings are **not cash and not financial assets**. Scope was a
  cryptocurrency with **no contract** between holder and another party
  [ASSUMPTION: secondary, search summary of ifrs.org TAD page and EY "Holdings of cryptocurrencies" 2019].
  Primary to open: `https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2019/holdings-of-cryptocurrencies-june-2019.pdf`.
- **Why stablecoins may differ:** a fiat-backed stablecoin whose holder has a **contractual right to redeem
  for cash** from the issuer may meet IAS 32's financial-asset definition (→ IFRS 9), not IAS 38. Whether the
  *particular holder* has that right matters (e.g. only onboarded customers can redeem with the issuer), so two
  holdings of the same token can be classified differently [ASSUMPTION: secondary, search summaries of
  kpmg.com/be "Stablecoins" IFRS insight and ICAEW Nov 2025]. A 2025 SEC staff comment to an IFRS filer
  (Bitdeer) objected to a conclusion that USDC is **not** a financial asset under IAS 32
  [ASSUMPTION: secondary, search summary of bitdeer.gcs-web.com filing correspondence].
- **Cash equivalent (IAS 7)?** Some commentators argue fiat-backed, regulated, redeemable-at-par stablecoins
  could qualify; others say no because redemption depends on the issuer and the token is not a deposit
  [ASSUMPTION: secondary, search summaries; no consensus found]. Treat "cash equivalent" as a policy choice the
  accountant must justify, not the default.
- Taiwan's exchange guidance: a stablecoin can fail the financial-asset test if the issuer may delay or refuse
  redemption; a licensed issuer bound to redeem at par on demand points to a financial asset
  [ASSUMPTION: secondary, twse.com.tw guidance PDF, search summary].

## US GAAP
- **ASU 2023-08 (ASC 350-60)** puts in-scope crypto assets at fair value through net income. Scope requires all
  criteria, including that the asset is an intangible and gives **no enforceable right to underlying goods,
  services or other assets**. A stablecoin redeemable for its collateral generally **fails** that criterion,
  and stablecoins that are financial instruments are outside the ASU
  [ASSUMPTION: secondary, search summaries of Deloitte DART FAQ on ASU 2023-08 §2.3 and Crowe]. So most
  fiat-backed stablecoins are *out of scope* and fall back on other GAAP (often treated as a financial asset or
  indefinite-lived intangible, depending on rights) [ASSUMPTION].
- **AICPA practice aid "Accounting for and Auditing of Digital Assets"** (non-authoritative) has a Q&A
  "Accounting for Stablecoin Holdings"; an August 2026 update added a chapter on **issuers**
  [ASSUMPTION: secondary, search summaries of aicpa-cima.com news and Deloitte DART news Aug 2026]. Its holder
  conclusion was not retrieved.

## What this means for Clearline's entries (my reasoning, for Aashmiin to confirm)
1. **The receivable is settled at the invoice amount** whichever classification applies: the customer owed
   5,000.00 USD and delivered tokens the business accepts at par. Dr <stablecoin asset> / Cr Accounts
   Receivable. This part is classification-neutral [ASSUMPTION].
2. **The debit account is a policy choice**, so Clearline must let the accountant pick the code and must name
   it honestly ("USDC wallet – Ethereum 0x…"), never "Cash at bank" by default.
3. **Xero mechanics push toward a BANK-type account** (payments and overpayments are received into a bank
   account) [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01, `EnablePaymentsToAccount`, BankTransaction
   `BankAccount`]. A BANK account in Xero is a *bookkeeping container*; how it is presented in the financial
   statements (cash equivalent vs. other current asset) is set by the accountant's report layout and notes.
   Say this to customers plainly.
4. **One account per wallet** (token + network + address) so the Xero balance can be reconciled to the
   on-chain balance. Today the code has one `walletAccountCode` for everything (codebase-map D8).
5. **Measurement after receipt** (fair value moves, depeg, impairment) is outside what Clearline posts. The
   0.5% depeg stop exists so that a receipt is never posted at par when par is false (but no price feed is wired
   today: D4).
6. **Gas and fees**: inbound ERC-20/TRC-20 gas is paid by the sender in the native coin and never reaches our
   books. Gas *we* pay (refunds, moving funds) is an expense paid from a native-coin holding (ETH/TRX), which is
   an IAS 38-type crypto asset, not a stablecoin [ASSUMPTION].
