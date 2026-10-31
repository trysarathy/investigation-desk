# Task 3: debits and credits for five receipts (for Aashmiin)

Org: Xero Demo Company, base currency USD, timezone `SINGAPORESTANDARDTIME` → `Asia/Singapore` (Windows→IANA via
CLDR) [VERIFIED: accounting-integrations-engineer 2026-11-01, CLDR windowsZones.xml]. Wallet account 090 (a USD bank
account), fee account 404.

**How I checked "code today":** I ran all five cases through the real `planPosting` and `xeroBody` on a scratch copy of
`origin/main` @ `0c7d9f1`, using a probe test `tests/zz-probe.test.ts` (to be deleted), and posted the "ready" plans
into the demo books adapter. Result: `npx vitest run tests/zz-probe.test.ts` → 1 passed. All "code today" lines below
are what it printed [VERIFIED: probe run 2026-11-01]. I converted the SGT dates with `Intl` (node 22.22.0).

Accounts: **WAL** = 090 USDC wallet (bank, USD) · **AR** = Accounts Receivable (Acme) · **FEE** = 404 Payment shortfalls / Bank
fees (expense) · **CRD** = customer overpayment credit on the contact · **RND** = Xero system Rounding account.

## The five cases

### (a) INV-3001, 5,000.00 due; 4,950.000000 USDC at 28 Oct 11:10 SGT; Mei Tan accepted as settled ("Exchange withdrawal fee"). Rule C3
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL 090 | 4,950.00 | |
| 2 | FEE 404 Payment shortfalls | 50.00 | |
| 3 | AR Acme (INV-3001) | | 5,000.00 |

Σ Dr 5,000.00 = Σ Cr 5,000.00.

Xero records:
- `PUT /Payments`: Amount 4950.00, Account 090, Date **2026-10-28**, Reference "USDC on Ethereum · tx … · @1.00 USD".
- `PUT /CreditNotes`: ACCRECCREDIT, NoTax, one line 50.00 to 404, Date 2026-10-28.
- `PUT /CreditNotes/{id}/Allocations`: 50.00 to INV-3001, Date 2026-10-28.

Rounding: the write-off is half-up to the cent, and is exact here.
**Invoice balance after: 0.00, PAID.**
Code today: **matches** (probe: `payment 4950.00 090 2026-10-28`, `fee_writeoff 50.00 404 2026-10-28`; demo books PAID,
due 0.00). The UTC date and the SGT date are the same day here (03:10Z = 11:10 SGT).

### (b) INV-3002, 1,000.00 due; 1,000.500000 USDC at 28 Oct 13:00 SGT; decision "refund excess". Rule C5
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL 090 | 1,000.50 | |
| 2 | AR Acme (INV-3002) | | 1,000.00 |
| 3 | CRD Acme overpayment, "To refund" | | 0.50 |

Σ 1,000.50 = 1,000.50.

Xero records: `PUT /Payments` 1000.00 to INV-3002 from 090, Date 2026-10-28; `PUT /BankTransactions` Type
`RECEIVE-OVERPAYMENT`, 0.50, BankAccount 090, Date 2026-10-28.
Rounding: overpayment rounded down (0.50 exact).
**Invoice balance after: 0.00, PAID.** Acme then has a 0.50 overpayment credit waiting to be refunded.
Code today: **matches** (probe: `payment 1000.00`, `overpayment 0.50`, both 090, 2026-10-28).

Two caveats:
- Clearline puts "To refund" in the bank transaction's `Reference`. Xero's spec says `Reference` is "only supported for
  SPEND and RECEIVE transactions", so the label may be dropped on a RECEIVE-OVERPAYMENT (D7)
  [VERIFIED: accounting-integrations-engineer 2026-11-01, Xero OpenAPI 19.1.0]. It survives in the line description.
  This needs checking in the Demo Company.
- The refund itself is later and by a person: Dr CRD 0.50 / Cr WAL 0.50, plus gas Dr Network fees / Cr ETH wallet
  (C13). Clearline never sends it and doesn't post it.

### (c) INV-3003, 1,000.00 due; 1,000.004000 USDC at 28 Oct 14:00 SGT; no decision. Rule C7 (over by less than a cent)
Proposed (C7, DRAFT):
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL 090 | 1,000.00 | |
| 2 | AR Acme (INV-3003) | | 1,000.00 |

Xero: one Payment 1000.00, Date 2026-10-28, reference noting "1,000.004 USDC received".
**Balance after: 0.00, PAID.** No decision needed. The 0.004 USDC stays in the on-chain wallet and gets booked by the
periodic wallet reconciliation (Dr WAL / Cr RND), not one line per payment.

**Code today: differs (D2).** Status `needs_decision`, lines `payment 1000.00` + **`overpayment 0.00`**. Nothing posts
until someone chooses refund or keep for 0.004 USDC. If they do, Clearline would send a 0.00 RECEIVE-OVERPAYMENT,
which Xero may reject [ASSUMPTION: zero-amount behaviour untested]. INV-3003 stays at 1,000.00 due in Xero until then.

### (d) INV-3004, 1,000.00 due; 999.995000 USDC at 28 Oct 15:00 SGT; no decision. Rule C7 (short by less than a cent)
Proposed (C7, **depends on your Q-C7**):

Option 1 (allow a one-cent rounding line):
| | Account | Dr | Cr |
|---|---|---|---|
| 1 | WAL 090 | 999.99 | |
| 2 | RND Rounding | 0.01 | |
| 3 | AR Acme | | 1,000.00 |

**Balance after: 0.00, PAID.** It still needs Approve. Xero record: Payment 999.99 + a 0.01 credit note to the rounding
account, allocated. Whether Xero lets a credit-note line use the system ROUNDING account is unverified; it must be
tried in the Demo Company [ASSUMPTION].

Option 2 (every shortfall goes to a person): Dr WAL 999.99 / Cr AR 999.99. **Balance after: 0.01 due, open.** A
person then requests the balance or accepts it (C3: a write-off of 0.01 to 404, because 0.005 rounds half-up to 0.01).

Rounding: the payment is floored (999.995 → 999.99) so the books never show more than arrived.

**Code today: differs (D3).** Status `ready`, `payment 999.99` + a history note saying "Short by 0.005". The plan's
reason says the invoice "stays open for **0.005**". The demo books (and Xero) show **0.01** due. Clearline and the books
disagree on the amount still owed.

### (e) INV-3005, 1,000.00 due; 333.333333 USDC at 28 Oct 16:00 SGT, then 666.666667 USDC at **30 Oct 01:30 SGT**. Rule C8
| | Account | Dr | Cr | Date |
|---|---|---|---|---|
| 1 | WAL 090 | 333.33 | | 2026-10-28 |
| 2 | AR Acme | | 333.33 | 2026-10-28 |
| 3 | WAL 090 | 666.67 | | **2026-10-30** |
| 4 | AR Acme | | 666.67 | **2026-10-30** |

Xero: two Payments on INV-3005, each with its own tx hash.

Rounding: running total floored. 333.333333 → 333.33. Then the cumulative 1,000.000000 equals the invoice, so the last
line closes it exactly: 1,000.00 − 333.33 = 666.67. Floored alone, 666.666667 would be 666.66, which would leave
0.01 open; the running total prevents that.

**Balance after:** 666.67 due after the first payment; **0.00, PAID** after the second.

**Code today: differs on the date (D1).** Probe: `payment 333.33 2026-10-28`, `payment 666.67 **2026-10-29**`. The second
transfer is 2026-10-29T17:30Z = 01:30 SGT 30 Oct, so the UTC date books it a day early (`rules.ts:137`). Amounts match.

## Every place today's code differs
| Case | Difference | Ref |
|---|---|---|
| e | Second payment dated 29 Oct instead of 30 Oct (UTC date) | D1, `rules.ts:137` |
| c | 0.00 overpayment line; blocks for a pointless refund/keep decision | D2 |
| d | Note and reason say short 0.005; Xero shows 0.01 due | D3 |
| all | Valued at par "no price feed connected"; the 0.5% depeg stop can't fire | D4 |
| all | No read of Organisation: timezone, base currency, lock dates, `IsDemoCompany` unchecked; scope `accounting.settings.read` missing | D6 |
| b | "To refund" label in a Reference Xero may ignore on RECEIVE-OVERPAYMENT | D7 |
| all | One wallet account 090 for every token/network/address | D8 |
| a | Matches. The credit note is NoTax to an expense account, which is a GST policy choice (below) | Q-C3 |

## What I need you to decide (each is a tick in `docs/POSTING_RULES.md` §9)
1. **Q-C7, case (d):** a shortfall under one cent. (A) Close it with a 0.01 rounding line (Dr RND 0.01), or (B) leave
   0.01 open and send it to a person like any shortfall? My suggestion is A, but it's your call.
2. **C7, case (c):** OK to ignore an excess under one cent (no line, no decision), leaving it to the wallet
   reconciliation? Yes / No.
3. **Q-C3, case (a):** is an accepted shortfall a **cost** (fee, no GST effect; today's NoTax credit note to 404) or a
   **price reduction** (a credit note that reduces output GST if the invoice carried GST)?
4. **Case (b):** refund 0.50 (it costs gas, recorded by a person) or keep it as credit? The fixture says refund. Confirm
   who sends it.
5. **R2 (case e):** date = block time in the org's timezone. Sign it so the D1 fix can be built.

All of these are DRAFT. Nothing gets built until you tick Approved, and each fix is an approval-only PR you merge.
Probe test deleted after the run (scratch copy only; the repo is untouched).
