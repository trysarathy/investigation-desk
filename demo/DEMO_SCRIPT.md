# 3-minute demo: payment ops lead

Five real transactions, each pasted into the app live. The company records behind them (deposit
addresses and ledger) are **SAMPLE COMPANY DATA** for a fictional company; say so up front.

**Before the meeting**
- Live: start the app (no keys needed), upload `tests/real-data/SAMPLE-file-a-deposit-addresses.csv`
  and `SAMPLE-file-b-ledger.csv` in Settings → Data.
- Backup if the internet fails: start it with `OFFLINE_REPLAY_DIR=tests/fixtures/real` (see the
  end of this page). The same five cases give the same answers from recorded real chain responses.
- Copy the five hashes below into a note so you can paste them.

| # | Case | Paste this hash | Reporting customer |
|---|---|---|---|
| 1 | Poisoned address | `0xc0514a795f065fce8a3e1238a1ba480e8a792d45f6431ee4ba8d800bedd86a0f` | `SAMPLE-C045` |
| 2 | Frozen sender | `241d18a60ab488d03e99405213c51905b9dda4cdefa553a8f87123390b4331f2` | `SAMPLE-C032` |
| 3 | Failed transfer | `66a11764690c76dd85f9147ecf8b9a6c153507190de53bcfd63e20a14f6e898e` | (none) |
| 4 | Fake USDT | `0xf84dacfeb3a92ae3291120d954b86d89932fe31702103754cad4f8e8ac41a10d` | `SAMPLE-C044` |
| 5 | Normal payment | `5296e24018c9197bbf4e7e844c7152ca494067400a5a06f351c66aad7d3873cb` | `SAMPLE-C001` |

---

**0:00 The problem (25 s)**

"When a customer says 'I sent USDT and it never arrived', someone on your team opens Tronscan or
Etherscan, then your ledger, then the deposit-address list, and pieces it together. That's
10 to 30 minutes a ticket, and the dangerous cases (a poisoned address, a frozen sender, fake
USDT) look exactly like the boring ones. This desk does that check in about a second and shows
the evidence behind every answer. Everything you'll see is a real transaction on a public
chain. The company records are a sample company I set up to stand in for yours."

**0:25 Case 1: the poisoned address (40 s)**

"A customer says they sent 49,999,950 USDT and it never arrived." *Paste hash 1 with customer
SAMPLE-C045 → New case.*

"It did leave their wallet, but it went to `0xbaff…f8b5`. Their real deposit address is
`0xbaf4…f8b5`: same start, same end. Twelve minutes earlier the look-alike sent them half a
cent of USDT so it would sit at the top of their history." *Scroll to Sender history.* "That's
the poisoning transfer, linked to the explorer. This was a real $50M loss in December 2025. The
desk marks it 'wrong address' with a likely-cause flag your analyst confirms before the
security notice goes out."

**1:05 Case 2: frozen sender (25 s)**

"A customer deposited USDT on Tron." *Paste hash 2, SAMPLE-C032.* "The deposit arrived, but
Tether has since frozen the sending address. The desk asked Tether's own contract, read-only,
and got 'blacklisted: true'. So this isn't a normal credit: it goes to compliance, and the reply
draft promises nothing."

**1:30 Case 3: failed transfer (20 s)**

*Paste hash 3.* "The customer has a hash, so they think they paid. On-chain it failed: out of
energy. No tokens moved. The reply tells them to resend; no ops time spent."

**1:50 Case 4: fake USDT (25 s)**

*Paste hash 4, SAMPLE-C044.* "This shows up as USDT in a wallet. Look at the symbol: the S
and the T are Cyrillic letters. The contract isn't Tether's. The desk refuses to treat it as
USDT, says don't credit it, and flags it to compliance."

**2:15 Case 5: normal payment (20 s)**

*Paste hash 5, SAMPLE-C001.* "And most tickets are this one: confirmed, right address, real
USDT, and your ledger already credited it. The desk says so and tells the customer where to look.
On our 24 normal test payments it raised no false alarms."

**2:35 Close (25 s)**

"We tested it on 111 real transactions: 59 in the main set and 52 we collected after the last
fix. It got all of them right, at about a second and a half each. It's read-only: no keys, and
it never moves funds. What I'd like from you is a month of your 'deposit not arrived' tickets
and the matching ledger export, so we can measure it on your cases, not mine."

---

### Offline backup

```
npm run build
OFFLINE_REPLAY_DIR=tests/fixtures/real npx next start
# then upload the two SAMPLE files in Settings → Data, as above
```

All 57 recorded real cases, including these five, give the same answers with the network cut
(tested 25 Oct with every outbound connection blocked). Anything not recorded pauses ("Check
paused") instead of guessing. The two live "waiting for confirmations" cases can't run offline,
because they need a transaction from the last minute.

Files: `demo/demo.mp4` (66 s screen recording), `demo/demo.gif`, `demo/screenshots/`.
